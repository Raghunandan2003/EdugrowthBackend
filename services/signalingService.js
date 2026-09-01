const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const Mentor = require("../models/Mentor");
const Student = require("../models/Student");
const Admin = require("../models/Admin");
const Schedule = require("../models/Schedule");
const { COOKIE_NAME, MENTOR_COOKIE_NAME, STUDENT_COOKIE_NAME } = require("../utils/cookie");
const { getJoinWindow } = require("../utils/liveClassAccess");

/**
 * Signaling only — this server never touches audio/video itself. Peers
 * exchange SDP offers/answers and ICE candidates through it, then talk
 * directly to each other over WebRTC (mesh: every participant connects to
 * every other participant). That's fine at tutoring-class scale (a
 * handful to a couple dozen peers); if class sizes grow much past that,
 * this is the place a future SFU (mediasoup/LiveKit) would slot in
 * instead, without the frontend's signaling contract needing to change.
 *
 * A "room" is one Schedule entry's id — i.e. one class slot, not a whole
 * course — so a course with a Mon/Wed/Fri recurring slot has three rooms
 * that just happen to share a course, mirroring how `lastReminderSentOn`
 * already treats each schedule entry as its own occurrence.
 *
 * Waiting room: a student who joins doesn't enter the mesh straight away
 * — they sit in the room's `waiting` map until a mentor (or admin, who
 * can also host/monitor) admits them. This is also what gives the class
 * list pages a real "call started" signal (see getLiveScheduleIds): a
 * room only counts as live once an actual mentor is present in `peers`.
 */

// roomId -> { peers: Map<socketId,{role,id,name}>, waiting: Map<socketId,{role,id,name,courseTitle}> }.
// In-memory and per-process on purpose (same tradeoff as
// classReminderService's setInterval) — fine for a single Node instance;
// a multi-instance deployment would need this moved to Redis
// (socket.io-redis) alongside a shared adapter.
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { peers: new Map(), waiting: new Map() });
  return rooms.get(roomId);
}

function dropRoomIfEmpty(roomId) {
  const room = rooms.get(roomId);
  if (room && room.peers.size === 0 && room.waiting.size === 0) rooms.delete(roomId);
}

function toArray(map) {
  return Array.from(map.entries()).map(([socketId, info]) => ({ socketId, ...info }));
}

// Mentors and admins are both treated as "hosts" for admission purposes —
// an admin previewing/monitoring a class can let people in just as well
// as the mentor who owns it.
function hostEntries(room) {
  return toArray(room.peers).filter((p) => p.role === "mentor" || p.role === "admin");
}

// A schedule slot only counts as "live" once an actual mentor (not just
// an admin passing through) is present — this is what the class-list
// pages poll to show "Live now" instead of a static Join button.
function getLiveScheduleIds() {
  const live = new Set();
  for (const [roomId, room] of rooms.entries()) {
    for (const info of room.peers.values()) {
      if (info.role === "mentor") {
        live.add(roomId);
        break;
      }
    }
  }
  return live;
}

function roomPeers(roomId) {
  const room = rooms.get(roomId);
  return room ? toArray(room.peers) : [];
}

function notifyHostsWaitingLeft(room, socketId, io) {
  hostEntries(room).forEach((host) => {
    io.to(host.socketId).emit("waiting-left", { socketId });
  });
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  });
  return out;
}

// Resolves whichever of the three session cookies (see utils/cookie.js)
// is present and valid into a {role, id, name} identity. Mirrors
// middleware/auth.js / mentorAuth.js / studentAuth.js, just adapted to
// read from a socket handshake instead of an Express request — sockets
// don't get httpOnly cookies for free the way `req.cookies` does, so we
// parse the raw `Cookie` header ourselves.
async function identifyFromHandshake(handshake) {
  const cookies = parseCookies(handshake.headers.cookie);

  const mentorToken = cookies[MENTOR_COOKIE_NAME];
  if (mentorToken) {
    try {
      const decoded = jwt.verify(mentorToken, process.env.JWT_SECRET);
      if (decoded.role === "mentor") {
        const mentor = await Mentor.findById(decoded.id);
        if (mentor && mentor.status === "active") {
          return { role: "mentor", id: String(mentor._id), name: mentor.name };
        }
      }
    } catch {
      /* fall through and try the other cookies */
    }
  }

  const studentToken = cookies[STUDENT_COOKIE_NAME];
  if (studentToken) {
    try {
      const decoded = jwt.verify(studentToken, process.env.JWT_SECRET);
      if (decoded.role === "student") {
        const student = await Student.findById(decoded.id);
        if (student && student.portalStatus === "active") {
          return { role: "student", id: String(student._id), name: student.name };
        }
      }
    } catch {
      /* fall through */
    }
  }

  const adminToken = cookies[COOKIE_NAME];
  if (adminToken) {
    try {
      const decoded = jwt.verify(adminToken, process.env.JWT_SECRET);
      const admin = await Admin.findById(decoded.id);
      if (admin) {
        return { role: "admin", id: String(admin._id), name: admin.name };
      }
    } catch {
      /* fall through */
    }
  }

  return null;
}

// Confirms `user` is actually allowed into the room for `scheduleId` right
// now: the mentor must own the course that schedule belongs to; a student
// must be enrolled in that course; an admin (previewing/monitoring) is
// always allowed on enrollment grounds. On top of that, a mentor or
// student (never admin — staff keep override access for support) must
// also be inside that slot's own join window (see utils/liveClassAccess.js)
// — the actual "only at the scheduled time, not before or after" rule.
//
// Returns { schedule } on success, or { error: <user-facing message> } on
// failure — the error string is sent straight back as the join-room ack's
// error field, so it needs to already be something worth showing someone.
async function authorizeRoom(scheduleId, user) {
  const schedule = await Schedule.findById(scheduleId).populate({
    path: "course",
    select: "title mentor",
  });
  if (!schedule || !schedule.course) return { error: "Not authorized for this class" };

  if (user.role === "admin") return { schedule };

  if (user.role === "mentor") {
    if (String(schedule.course.mentor) !== user.id) return { error: "Not authorized for this class" };
  } else if (user.role === "student") {
    const student = await Student.findById(user.id).select("course");
    if (!student || String(student.course) !== String(schedule.course._id)) {
      return { error: "Not authorized for this class" };
    }
  } else {
    return { error: "Not authorized for this class" };
  }

  const window = getJoinWindow(schedule);
  if (!window.allowed) return { error: window.message };

  return { schedule };
}

function initSignaling(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
      credentials: true,
    },
  });

  // Tells every host (mentor/admin) currently in the room that a new
  // person is waiting to be let in.
  function notifyHostsOfWaiting(room, waitingSocketId, info) {
    hostEntries(room).forEach((host) => {
      io.to(host.socketId).emit("waiting-participant", {
        socketId: waitingSocketId,
        name: info.name,
        role: info.role,
      });
    });
  }

  io.on("connection", (socket) => {
    let currentRoom = null;

    // join-room: the client sends the scheduleId for the class slot it
    // wants to enter. Auth + enrollment, plus the slot's own join-time
    // window, are re-checked here (not trusted from anything the client
    // claims) on every join.
    socket.on("join-room", async ({ scheduleId }, ack) => {
      try {
        if (!scheduleId) return ack?.({ error: "scheduleId is required" });

        const user = await identifyFromHandshake(socket.handshake);
        if (!user) return ack?.({ error: "Not authorized" });

        const { schedule, error: authError } = await authorizeRoom(scheduleId, user);
        if (!schedule) return ack?.({ error: authError || "Not authorized for this class" });

        currentRoom = scheduleId;
        const room = getRoom(scheduleId);

        // Students sit in a waiting room until a host lets them in —
        // mirrors the standard "waiting room" pattern of Zoom/Meet, and
        // is also what gives the mentor a real signal that someone is
        // trying to join, instead of people silently appearing.
        if (user.role === "student") {
          const info = { role: user.role, id: user.id, name: user.name, courseTitle: schedule.course.title };
          room.waiting.set(socket.id, info);

          ack?.({ ok: true, waiting: true, courseTitle: schedule.course.title });
          notifyHostsOfWaiting(room, socket.id, info);
          return;
        }

        // Mentor / admin: join the room straight away.
        socket.join(scheduleId);
        const existingPeers = toArray(room.peers);
        room.peers.set(socket.id, { role: user.role, id: user.id, name: user.name });

        ack?.({
          ok: true,
          courseTitle: schedule.course.title,
          self: { socketId: socket.id, role: user.role, name: user.name },
          peers: existingPeers,
          // Anyone already queued up before this host joined (e.g. a
          // student got there first) — so the mentor sees them
          // immediately instead of only after their next action.
          waitingList: toArray(room.waiting).map((w) => ({ socketId: w.socketId, name: w.name, role: w.role })),
        });
        socket.to(scheduleId).emit("peer-joined", {
          socketId: socket.id,
          role: user.role,
          name: user.name,
        });
      } catch (err) {
        console.error("[signaling] join-room failed:", err);
        ack?.({ error: "Failed to join room" });
      }
    });

    // Host-only: let a specific waiting participant into the room. The
    // sender's role is re-checked from the room's own peer map (never
    // trusted from the client), same pattern as mute-all below.
    socket.on("admit-participant", ({ socketId: targetId } = {}) => {
      if (!currentRoom || !targetId) return;
      const room = rooms.get(currentRoom);
      if (!room) return;
      const me = room.peers.get(socket.id);
      if (!me || (me.role !== "mentor" && me.role !== "admin")) return;

      const waitingInfo = room.waiting.get(targetId);
      if (!waitingInfo) return;

      const targetSocket = io.sockets.sockets.get(targetId);
      room.waiting.delete(targetId);
      if (!targetSocket) return; // they gave up / disconnected before being let in

      const existingPeers = toArray(room.peers);
      room.peers.set(targetId, { role: waitingInfo.role, id: waitingInfo.id, name: waitingInfo.name });
      targetSocket.join(currentRoom);

      targetSocket.emit("admitted", {
        ok: true,
        courseTitle: waitingInfo.courseTitle,
        self: { socketId: targetId, role: waitingInfo.role, name: waitingInfo.name },
        peers: existingPeers,
      });
      socket.to(currentRoom).emit("peer-joined", {
        socketId: targetId,
        role: waitingInfo.role,
        name: waitingInfo.name,
      });
    });

    // Host-only: turn a waiting participant away without letting them in.
    socket.on("deny-participant", ({ socketId: targetId } = {}) => {
      if (!currentRoom || !targetId) return;
      const room = rooms.get(currentRoom);
      if (!room) return;
      const me = room.peers.get(socket.id);
      if (!me || (me.role !== "mentor" && me.role !== "admin")) return;
      if (!room.waiting.has(targetId)) return;

      room.waiting.delete(targetId);
      io.sockets.sockets.get(targetId)?.emit("join-denied", {
        message: "The mentor didn't admit you to this class.",
      });
      dropRoomIfEmpty(currentRoom);
    });

    // Pure relay — offers, answers, and ICE candidates all pass through
    // this one event, addressed to a specific peer's socket id. The
    // signaling server never inspects the SDP/ICE payload itself, but it
    // does check `to` is actually a peer in the sender's own current
    // room before relaying — every other handler here (admit/deny/
    // mute-all) re-derives the sender's authorization from the room's
    // own state rather than trusting client input, and this one was the
    // odd one out: without this check, any authenticated socket could
    // address a signal at any other connected socket id anywhere on the
    // server, not just one it's actually in a room with. Socket ids
    // aren't normally exposed outside a room's own peer/waiting lists,
    // so this wasn't reachable through the normal client, but it's worth
    // closing as defense in depth rather than relying on that alone.
    socket.on("signal", ({ to, data }) => {
      if (!to || !currentRoom) return;
      const room = rooms.get(currentRoom);
      if (!room || !room.peers.has(socket.id) || !room.peers.has(to)) return;
      io.to(to).emit("signal", { from: socket.id, data });
    });

    // Host control: "mute everyone else". Re-checks the sender's role from
    // the room's own peer map (never trusts a client-claimed role), so
    // only the mentor who actually authorized into this room as "mentor"
    // can trigger it. This is a request, not an enforced lock — each
    // client mutes its own mic on receipt and can unmute itself again
    // afterwards, same as the "mute all" pattern in Zoom/Meet.
    socket.on("mute-all", () => {
      if (!currentRoom) return;
      const room = rooms.get(currentRoom);
      const me = room?.peers.get(socket.id);
      if (!me || me.role !== "mentor") return;
      socket.to(currentRoom).emit("force-mute");
    });

    // Lightweight relay so every client knows who currently has their
    // mic/camera on and who is presenting their screen — purely a UI
    // signal (badges/muted icons), never used for authorization. The
    // media itself never touches this server either way.
    socket.on("media-state", ({ micOn, camOn }) => {
      if (!currentRoom) return;
      socket.to(currentRoom).emit("peer-media-state", { socketId: socket.id, micOn, camOn });
    });

    socket.on("screen-share", ({ sharing }) => {
      if (!currentRoom) return;
      socket.to(currentRoom).emit("peer-screen-share", { socketId: socket.id, sharing: !!sharing });
    });

    socket.on("leave-room", () => leaveCurrentRoom(socket, currentRoom, io));

    socket.on("disconnect", () => leaveCurrentRoom(socket, currentRoom, io));
  });

  return io;
}

function leaveCurrentRoom(socket, roomId, io) {
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.peers.has(socket.id)) {
    const info = room.peers.get(socket.id);
    room.peers.delete(socket.id);
    socket.leave(roomId);
    socket.to(roomId).emit("peer-left", { socketId: socket.id });

    // The mentor leaving — whether via "End class", in-app navigation, or
    // a dropped connection — ends the class for everyone else too. Without
    // this, students (and any admin still in the room) are left in a call
    // with no instructor: their mesh, camera, and mic just keep running,
    // with only a "peer-left" removing the mentor's tile.
    if (info.role === "mentor") {
      socket.to(roomId).emit("class-ended");
      toArray(room.waiting).forEach((w) => {
        io.sockets.sockets.get(w.socketId)?.emit("class-ended");
      });
      room.peers.clear();
      room.waiting.clear();
    }
  } else if (room.waiting.has(socket.id)) {
    // A student who disconnected (or gave up) while still waiting —
    // tell any hosts so their waiting-room list doesn't show a stale
    // entry they'd otherwise try to admit into an empty socket.
    room.waiting.delete(socket.id);
    notifyHostsWaitingLeft(room, socket.id, io);
  }

  dropRoomIfEmpty(roomId);
}

module.exports = { initSignaling, roomPeers, getLiveScheduleIds };
