import { useEffect, useRef, useState } from 'react';
import YouTube from 'react-youtube';

export default function WatchRoom({ socket, roomId, myRole, participants, setParticipants, setMyRole }) {
  const playerRef                   = useRef(null);
  const chatEndRef                  = useRef(null);
  const [videoId, setVideoId]       = useState('dQw4w9WgXcQ');
  const [videoInput, setVideoInput] = useState('');
  const [messages, setMessages]     = useState([]);
  const [chatInput, setChatInput]   = useState('');
  const [reactions, setReactions]   = useState([]);

  const canControl = myRole === 'Host' || myRole === 'Moderator';
  const isHost     = myRole === 'Host';

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // ── Socket listeners ────────────────────────────────────────────
  useEffect(() => {
    socket.on('user_joined',         ({ participants: p }) => setParticipants(p));
    socket.on('user_left',           ({ participants: p }) => setParticipants(p));
    socket.on('participant_removed', ({ participants: p }) => setParticipants(p));

    socket.on('role_assigned', ({ participants: p, myNewRole }) => {
      setParticipants(p);
      if (myNewRole) setMyRole(myNewRole);
    });

    socket.on('kicked', () => {
      alert('You were removed from the room by the Host.');
      window.location.reload();
    });

    socket.on('sync_state', ({ videoId: vid, currentTime, isPlaying }) => {
      if (vid) setVideoId(vid);
      setTimeout(() => {
        if (!playerRef.current) return;
        playerRef.current.seekTo(currentTime, true);
        if (isPlaying) playerRef.current.playVideo();
        else           playerRef.current.pauseVideo();
      }, 1000);
    });

    socket.on('play_video',    ()    => playerRef.current?.playVideo());
    socket.on('pause_video',   ()    => playerRef.current?.pauseVideo());
    socket.on('seek_video',    (t)   => playerRef.current?.seekTo(t, true));
    socket.on('video_changed', (vid) => setVideoId(vid));

    // Chat
    socket.on('chat_history', (msgs) => setMessages(msgs));
    socket.on('new_message',  (msg)  => setMessages(prev => [...prev, msg]));

    // ✅ Fix: store random position ONCE when reaction arrives, not during render
    socket.on('new_reaction', (reaction) => {
      const positioned = {
        ...reaction,
        bottom: 20 + Math.random() * 40,
        left:   10 + Math.random() * 80,
      };
      setReactions(prev => [...prev, positioned]);
      setTimeout(() => {
        setReactions(prev => prev.filter(r => r.id !== positioned.id));
      }, 3000);
    });

    return () => {
      socket.off('user_joined');
      socket.off('user_left');
      socket.off('participant_removed');
      socket.off('role_assigned');
      socket.off('kicked');
      socket.off('sync_state');
      socket.off('play_video');
      socket.off('pause_video');
      socket.off('seek_video');
      socket.off('video_changed');
      socket.off('chat_history');
      socket.off('new_message');
      socket.off('new_reaction');
    };
  }, [socket, setMyRole, setParticipants]);

  // ── Playback controls ───────────────────────────────────────────
  function onPlay()  { if (!canControl) return; socket.emit('play',  { roomId }); }
  function onPause() { if (!canControl) return; socket.emit('pause', { roomId }); }
  function onSeek()  {
    if (!canControl) return;
    const t = playerRef.current?.getCurrentTime() || 0;
    socket.emit('seek', { roomId, time: t });
  }

  function changeVideo() {
    if (!canControl) return;
    const match = videoInput.match(/(?:v=|youtu\.be\/)([\w-]{11})/);
    const id    = match ? match[1] : videoInput.trim();
    if (id.length === 11) { socket.emit('change_video', { roomId, videoId: id }); setVideoInput(''); }
    else alert('Paste a valid YouTube URL or 11-character video ID.');
  }

  // ── Chat ────────────────────────────────────────────────────────
  function sendMessage() {
    if (!chatInput.trim()) return;
    socket.emit('send_message', { roomId, message: chatInput });
    setChatInput('');
  }

  // ── Emoji reactions ─────────────────────────────────────────────
  function sendReaction(emoji) {
    socket.emit('send_reaction', { roomId, emoji });
  }

  // ── Host actions ────────────────────────────────────────────────
  function assignRole(userId, newRole) { if (isHost) socket.emit('assign_role', { roomId, userId, role: newRole }); }
  function transferHost(userId)        { if (isHost && window.confirm('Transfer Host?')) socket.emit('transfer_host', { roomId, userId }); }
  function removeParticipant(userId)   { if (isHost && window.confirm('Remove participant?')) socket.emit('remove_participant', { roomId, userId }); }

  function roleColor(r) {
    if (r === 'Host')      return '#7C3AED';
    if (r === 'Moderator') return '#2563EB';
    return '#6B7280';
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const EMOJIS = ['👍', '❤️', '😂', '😮', '🔥', '👏', '🎉', '😢'];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#111827', color: '#F9FAFB', fontFamily: 'sans-serif' }}>

      {/* ── Left: Player ── */}
      <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 20 }}>
            Room: <code style={{ background: '#1F2937', padding: '2px 8px', borderRadius: 4 }}>{roomId}</code>
          </h2>
          <span style={{ background: roleColor(myRole), color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: 13, fontWeight: 600 }}>
            {myRole}
          </span>
        </div>

        {/* Player with reaction overlay */}
        <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', border: '2px solid #374151' }}>
          <YouTube
            videoId={videoId}
            opts={{ width: '100%', height: '420', playerVars: { autoplay: 0 } }}
            onReady={e => (playerRef.current = e.target)}
            onPlay={onPlay}
            onPause={onPause}
            onStateChange={onSeek}
          />

          {/* Block participant clicks on player */}
          {!canControl && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, cursor: 'not-allowed', zIndex: 10 }} />
          )}

          {/* ✅ Fixed: use pre-computed bottom/left from state, no Math.random() in render */}
          {reactions.map(r => (
            <div key={r.id} style={{
              position:      'absolute',
              bottom:        `${r.bottom}%`,
              left:          `${r.left}%`,
              fontSize:      36,
              zIndex:        20,
              animation:     'floatUp 3s ease-out forwards',
              pointerEvents: 'none',
            }}>
              {r.emoji}
            </div>
          ))}
        </div>

        <style>{`
          @keyframes floatUp {
            0%   { opacity: 1; transform: translateY(0) scale(1); }
            100% { opacity: 0; transform: translateY(-120px) scale(1.5); }
          }
        `}</style>

        {/* Emoji bar — everyone can react */}
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {EMOJIS.map(emoji => (
            <button key={emoji} onClick={() => sendReaction(emoji)}
              style={{ fontSize: 22, background: '#1F2937', border: '1px solid #374151', borderRadius: 8, padding: '4px 10px', cursor: 'pointer' }}
              onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.85)')}
              onMouseUp={e   => (e.currentTarget.style.transform = 'scale(1)')}
            >
              {emoji}
            </button>
          ))}
        </div>

        {/* Change video — Host/Moderator only */}
        {canControl ? (
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <input
              value={videoInput}
              onChange={e => setVideoInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && changeVideo()}
              placeholder="Paste YouTube URL or video ID"
              style={{ flex: 1, padding: '8px 12px', fontSize: 14, borderRadius: 6, border: '1px solid #374151', background: '#1F2937', color: '#F9FAFB' }}
            />
            <button onClick={changeVideo} style={btnStyle('#2563EB')}>Change Video</button>
          </div>
        ) : (
          <p style={{ color: '#6B7280', marginTop: 8, fontSize: 13 }}>
            🔒 Only the Host or Moderator can control playback.
          </p>
        )}
      </div>

      {/* ── Middle: Chat ── */}
      <div style={{ width: 300, borderLeft: '1px solid #374151', display: 'flex', flexDirection: 'column', background: '#1F2937' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid #374151', fontWeight: 700, fontSize: 15 }}>
          💬 Chat
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 140px)' }}>
          {messages.length === 0 && (
            <p style={{ color: '#6B7280', fontSize: 13, textAlign: 'center', marginTop: 20 }}>No messages yet. Say hi!</p>
          )}
          {messages.map(msg => (
            <div key={msg.id} style={{
              background: msg.userId === socket.id ? '#1D4ED8' : '#111827',
              padding: '8px 10px', borderRadius: 8,
              alignSelf: msg.userId === socket.id ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
            }}>
              <div style={{ fontSize: 11, color: msg.userId === socket.id ? '#BFDBFE' : roleColor(msg.role), marginBottom: 3, fontWeight: 600 }}>
                {msg.username} <span style={{ color: '#6B7280', fontWeight: 400 }}>[{msg.role}]</span>
              </div>
              <div style={{ fontSize: 14, wordBreak: 'break-word' }}>{msg.text}</div>
              <div style={{ fontSize: 10, color: '#6B7280', marginTop: 3, textAlign: 'right' }}>{formatTime(msg.timestamp)}</div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div style={{ padding: 10, borderTop: '1px solid #374151', display: 'flex', gap: 6 }}>
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendMessage()}
            placeholder="Type a message..."
            style={{ flex: 1, padding: '7px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #374151', background: '#111827', color: '#F9FAFB' }}
          />
          <button onClick={sendMessage} style={btnStyle('#2563EB')}>Send</button>
        </div>
      </div>

      {/* ── Right: Participants ── */}
      <div style={{ width: 240, borderLeft: '1px solid #374151', padding: 16, background: '#1F2937', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 14px', fontSize: 15, color: '#E5E7EB' }}>
          👥 Participants ({participants.length})
        </h3>

        {participants.map(p => (
          <div key={p.id} style={{ marginBottom: 10, padding: 10, background: '#111827', borderRadius: 8, border: '1px solid #374151' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: isHost && p.role !== 'Host' ? 6 : 0 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {p.username}
                {p.id === socket.id && <span style={{ color: '#6B7280', fontSize: 10 }}> (you)</span>}
              </span>
              <span style={{ background: roleColor(p.role), color: '#fff', padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 600 }}>
                {p.role}
              </span>
            </div>

            {isHost && p.role !== 'Host' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {p.role !== 'Moderator' && (
                    <button onClick={() => assignRole(p.id, 'Moderator')} style={btnStyle('#1D4ED8')}>Make Mod</button>
                  )}
                  {p.role === 'Moderator' && (
                    <button onClick={() => assignRole(p.id, 'Participant')} style={btnStyle('#4B5563')}>Demote</button>
                  )}
                  <button onClick={() => transferHost(p.id)} style={btnStyle('#7C3AED')}>Transfer Host</button>
                </div>
                <button onClick={() => removeParticipant(p.id)}
                  style={{ fontSize: 10, padding: '2px 6px', cursor: 'pointer', background: '#FEE2E2', color: '#991B1B', border: '1px solid #FCA5A5', borderRadius: 4, fontWeight: 600, marginTop: 2 }}>
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function btnStyle(bg) {
  return { fontSize: 11, padding: '4px 10px', cursor: 'pointer', background: bg, color: '#fff', border: 'none', borderRadius: 4, fontWeight: 600 };
}
