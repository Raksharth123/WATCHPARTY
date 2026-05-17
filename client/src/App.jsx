import { useRef, useState } from 'react';
import { io } from 'socket.io-client';
import WatchRoom from './WatchRoom';

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

export default function App() {
  const socketRef = useRef(null);
  const [username, setUsername]         = useState('');
  const [roomId, setRoomId]             = useState('');
  const [joined, setJoined]             = useState(false);
  const [participants, setParticipants] = useState([]);
  const [myRole, setMyRole]             = useState('Participant');
  const [error, setError]               = useState('');
  const [socket, setSocket]             = useState(null);

  function connect() {
    if (!username.trim() || !roomId.trim()) {
      setError('Enter both a username and a room code.');
      return;
    }

    setError('');

    const newSocket = io(SERVER);
    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      newSocket.emit('join_room', {
        roomId: roomId.trim(),
        username: username.trim(),
      });
    });

    newSocket.on('room_joined', ({ role, participants: p }) => {
      setMyRole(role);
      setParticipants(p);
      setSocket(newSocket);   // ← triggers re-render AFTER socket is ready
      setJoined(true);
    });

    newSocket.on('user_joined',           ({ participants: p }) => setParticipants(p));
    newSocket.on('user_left',             ({ participants: p }) => setParticipants(p));
    newSocket.on('role_assigned',         ({ participants: p }) => setParticipants(p));
    newSocket.on('participant_removed',   ({ participants: p }) => setParticipants(p));
    newSocket.on('error_msg',             ({ message }) => setError(message));

    newSocket.on('connect_error', () => {
      setError('Could not connect to server. Is it running?');
    });
  }

  if (joined && socket) {
    return (
      <WatchRoom
        socket={socket}
        roomId={roomId}
        myRole={myRole}
        participants={participants}
        setParticipants={setParticipants}
        setMyRole={setMyRole}
      />
    );
  }

  return (
    <div style={{ maxWidth: 420, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1 style={{ fontSize: '2rem', whiteSpace: 'nowrap' }}>
        YouTube Watch Party
      </h1>

      <input
        placeholder="Your name"
        value={username}
        onChange={e => setUsername(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && connect()}
        style={{ display:'block', width:'100%', marginBottom:8, padding:8, fontSize:16, boxSizing:'border-box' }}
      />
      <input
        placeholder="Room code (e.g. abc123)"
        value={roomId}
        onChange={e => setRoomId(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && connect()}
        style={{ display:'block', width:'100%', marginBottom:8, padding:8, fontSize:16, boxSizing:'border-box' }}
      />

      {error && <p style={{ color:'red', margin:'4px 0 8px' }}>{error}</p>}

      <button
        onClick={connect}
        style={{ width:'100%', padding:10, fontSize:16, background:'#2563EB', color:'#fff', border:'none', borderRadius:6, cursor:'pointer' }}
      >
        Create / Join Room
      </button>

      <p style={{ color:'#6B7280', fontSize:13, marginTop:8 }}>
        First person to enter a room code becomes the Host.
      </p>
    </div>
  );
}
