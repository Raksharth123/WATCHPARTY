require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT       || 3001;
const CLIENT = process.env.CLIENT_URL || 'http://localhost:5173';

app.use(cors({ origin: CLIENT }));
app.get('/health', (_, res) => res.json({ ok: true }));

const io = new Server(server, {
  cors: { origin: CLIENT, methods: ['GET', 'POST'] }
});

// ── In-memory state ──────────────────────────────────────────────
const rooms     = {};
const userRooms = {};

// ── Helpers ───────────────────────────────────────────────────────
function getRoom(roomId)             { return rooms[roomId]; }
function getParticipant(roomId, sid) { return rooms[roomId]?.participants.find(p => p.id === sid); }
function canControl(roomId, sid) {
  const p = getParticipant(roomId, sid);
  return p && (p.role === 'Host' || p.role === 'Moderator');
}

io.on('connection', (socket) => {
  console.log('Connected:', socket.id);

  // ── JOIN ROOM ─────────────────────────────────────────────────
  socket.on('join_room', ({ roomId, username }) => {
    if (!roomId || !username) return;
    socket.join(roomId);
    userRooms[socket.id] = roomId;

    if (!rooms[roomId]) {
      rooms[roomId] = {
        host:         socket.id,
        participants: [],
        videoId:      'dQw4w9WgXcQ',
        currentTime:  0,
        isPlaying:    false,
        messages:     [],   // chat history
      };
    }

    const isHost = rooms[roomId].host === socket.id;
    const role   = isHost ? 'Host' : 'Participant';
    rooms[roomId].participants.push({ id: socket.id, username, role });

    socket.emit('room_joined', { role, participants: rooms[roomId].participants });
    socket.emit('sync_state', {
      videoId:     rooms[roomId].videoId,
      currentTime: rooms[roomId].currentTime,
      isPlaying:   rooms[roomId].isPlaying,
    });

    // Send chat history to new joiner
    if (rooms[roomId].messages.length > 0) {
      socket.emit('chat_history', rooms[roomId].messages);
    }

    io.to(roomId).emit('user_joined', {
      username, userId: socket.id,
      participants: rooms[roomId].participants,
    });
  });

  // ── PLAY ──────────────────────────────────────────────────────
  socket.on('play', ({ roomId }) => {
    if (!canControl(roomId, socket.id)) return;
    rooms[roomId].isPlaying = true;
    io.to(roomId).emit('play_video');
  });

  // ── PAUSE ─────────────────────────────────────────────────────
  socket.on('pause', ({ roomId }) => {
    if (!canControl(roomId, socket.id)) return;
    rooms[roomId].isPlaying = false;
    io.to(roomId).emit('pause_video');
  });

  // ── SEEK ──────────────────────────────────────────────────────
  socket.on('seek', ({ roomId, time }) => {
    if (!canControl(roomId, socket.id)) return;
    rooms[roomId].currentTime = time;
    socket.to(roomId).emit('seek_video', time);
  });

  // ── CHANGE VIDEO ──────────────────────────────────────────────
  socket.on('change_video', ({ roomId, videoId }) => {
    if (!canControl(roomId, socket.id)) return;
    rooms[roomId].videoId     = videoId;
    rooms[roomId].currentTime = 0;
    rooms[roomId].isPlaying   = false;
    io.to(roomId).emit('video_changed', videoId);
  });

  // ── CHAT MESSAGE ──────────────────────────────────────────────
  socket.on('send_message', ({ roomId, message }) => {
    const sender = getParticipant(roomId, socket.id);
    if (!sender || !message?.trim()) return;

    const msg = {
      id:        Date.now(),
      userId:    socket.id,
      username:  sender.username,
      role:      sender.role,
      text:      message.trim().slice(0, 500), // max 500 chars
      timestamp: new Date().toISOString(),
    };

    // Keep last 100 messages in memory
    rooms[roomId].messages.push(msg);
    if (rooms[roomId].messages.length > 100) rooms[roomId].messages.shift();

    io.to(roomId).emit('new_message', msg);
  });

  // ── EMOJI REACTION ────────────────────────────────────────────
  socket.on('send_reaction', ({ roomId, emoji }) => {
    const sender = getParticipant(roomId, socket.id);
    if (!sender) return;

    const allowed = ['👍','❤️','😂','😮','🔥','👏','🎉','😢'];
    if (!allowed.includes(emoji)) return;

    io.to(roomId).emit('new_reaction', {
      emoji,
      username: sender.username,
      id:       Date.now() + Math.random(),
    });
  });

  // ── ASSIGN ROLE ───────────────────────────────────────────────
  socket.on('assign_role', ({ roomId, userId, role }) => {
    const requester = getParticipant(roomId, socket.id);
    if (!requester || requester.role !== 'Host') return;
    const target = getParticipant(roomId, userId);
    if (!target || target.role === 'Host') return;
    const validRoles = ['Moderator', 'Participant', 'Viewer'];
    if (!validRoles.includes(role)) return;
    target.role = role;
    io.to(userId).emit('role_assigned', { participants: rooms[roomId].participants, myNewRole: role });
    io.to(roomId).emit('role_assigned', { participants: rooms[roomId].participants });
  });

  // ── TRANSFER HOST ─────────────────────────────────────────────
  socket.on('transfer_host', ({ roomId, userId }) => {
    const requester = getParticipant(roomId, socket.id);
    if (!requester || requester.role !== 'Host') return;
    const newHost = getParticipant(roomId, userId);
    if (!newHost) return;
    requester.role     = 'Participant';
    newHost.role       = 'Host';
    rooms[roomId].host = userId;
    io.to(userId).emit('role_assigned', { participants: rooms[roomId].participants, myNewRole: 'Host' });
    socket.emit('role_assigned',        { participants: rooms[roomId].participants, myNewRole: 'Participant' });
    io.to(roomId).emit('role_assigned', { participants: rooms[roomId].participants });
  });

  // ── REMOVE PARTICIPANT ────────────────────────────────────────
  socket.on('remove_participant', ({ roomId, userId }) => {
    const requester = getParticipant(roomId, socket.id);
    if (!requester || requester.role !== 'Host') return;
    const target = getParticipant(roomId, userId);
    if (!target || target.role === 'Host') return;
    rooms[roomId].participants = rooms[roomId].participants.filter(p => p.id !== userId);
    io.to(userId).emit('kicked');
    io.to(roomId).emit('participant_removed', { userId, participants: rooms[roomId].participants });
  });

  // ── DISCONNECT ────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const roomId = userRooms[socket.id];
    if (roomId) handleLeave(socket, roomId);
  });

  socket.on('leave_room', ({ roomId }) => handleLeave(socket, roomId));
});

function handleLeave(socket, roomId) {
  const room = getRoom(roomId);
  if (!room) return;
  const leaving = getParticipant(roomId, socket.id);
  if (!leaving) return;

  room.participants = room.participants.filter(p => p.id !== socket.id);
  delete userRooms[socket.id];
  socket.leave(roomId);

  if (room.participants.length === 0) { delete rooms[roomId]; return; }

  if (room.host === socket.id) {
    const newHost = room.participants[0];
    newHost.role  = 'Host';
    room.host     = newHost.id;
    io.to(newHost.id).emit('role_assigned', { participants: room.participants, myNewRole: 'Host' });
  }

  io.to(roomId).emit('user_left', {
    username:     leaving.username,
    userId:       socket.id,
    participants: room.participants,
  });
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
