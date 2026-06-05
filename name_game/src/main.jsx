import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ref, set, update, onValue, get, remove } from 'firebase/database';
import { db } from './firebase';
import './style.css';

const CATEGORIES = ['Name', 'Animal', 'Capital', 'Fruit or Vegetable', 'Celebrity', 'Country', 'Brand', 'Thing'];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l => !['Q','X','Z'].includes(l));
const ROUND_SECONDS = 60;
const TOTAL_ROUNDS = 10;

function randomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}
function randomLetter() {
  return LETTERS[Math.floor(Math.random() * LETTERS.length)];
}
function playerId() {
  let id = localStorage.getItem('letterRushPlayerId');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('letterRushPlayerId', id);
  }
  return id;
}

function App() {
  const [roomCode, setRoomCode] = useState('');
  const [name, setName] = useState(localStorage.getItem('letterRushName') || '');
  const [game, setGame] = useState(null);
  const [joinedRoom, setJoinedRoom] = useState(localStorage.getItem('letterRushRoom') || '');
  const [answers, setAnswers] = useState({});
  const [now, setNow] = useState(Date.now());
  const id = useMemo(() => playerId(), []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!joinedRoom) return;
    const gameRef = ref(db, `rooms/${joinedRoom}`);
    const unsub = onValue(gameRef, snap => {
      setGame(snap.val());
    });
    return () => unsub();
  }, [joinedRoom]);

  const players = game?.players || {};
  const me = players[id];
  const isMaster = me?.role === 'master';
  const currentRound = game?.currentRound || 0;
  const round = game?.rounds?.[currentRound];
  const secondsLeft = round?.startedAt ? Math.max(0, Math.ceil((round.startedAt + ROUND_SECONDS * 1000 - now) / 1000)) : ROUND_SECONDS;
  const isAnswering = game?.status === 'playing' && secondsLeft > 0;
  const isJudging = game?.status === 'judging';
  const isFinished = game?.status === 'finished';

  async function createRoom() {
    const cleanName = name.trim();
    if (!cleanName) return alert('Enter your name first.');
    localStorage.setItem('letterRushName', cleanName);
    const code = randomCode();
    await set(ref(db, `rooms/${code}`), {
      createdAt: Date.now(),
      status: 'lobby',
      currentRound: 0,
      categories: CATEGORIES,
      totalRounds: TOTAL_ROUNDS,
      players: {
        [id]: { name: cleanName, role: 'master', score: 0 }
      }
    });
    localStorage.setItem('letterRushRoom', code);
    setJoinedRoom(code);
  }

  async function joinRoom() {
    const code = roomCode.trim().toUpperCase();
    const cleanName = name.trim();
    if (!cleanName || !code) return alert('Enter your name and room code.');
    const snap = await get(ref(db, `rooms/${code}`));
    if (!snap.exists()) return alert('Room not found.');
    localStorage.setItem('letterRushName', cleanName);
    await update(ref(db, `rooms/${code}/players/${id}`), { name: cleanName, role: 'player', score: 0 });
    localStorage.setItem('letterRushRoom', code);
    setJoinedRoom(code);
  }

  async function assignMaster(targetId) {
    if (!isMaster) return;
    const updates = {};
    Object.keys(players).forEach(pid => updates[`rooms/${joinedRoom}/players/${pid}/role`] = pid === targetId ? 'master' : 'player');
    await update(ref(db), updates);
  }

  async function startRound() {
    if (!isMaster) return;
    const nextRound = game.status === 'lobby' ? 1 : currentRound + 1;
    if (nextRound > TOTAL_ROUNDS) {
      await update(ref(db, `rooms/${joinedRoom}`), { status: 'finished' });
      return;
    }
    setAnswers({});
    await update(ref(db, `rooms/${joinedRoom}`), {
      status: 'playing',
      currentRound: nextRound,
      [`rounds/${nextRound}`]: {
        letter: randomLetter(),
        startedAt: Date.now(),
        answers: {},
        judged: {}
      }
    });
  }

  async function submitAnswers() {
    if (!round) return;
    await set(ref(db, `rooms/${joinedRoom}/rounds/${currentRound}/answers/${id}`), answers);
    alert('Answers submitted.');
  }

  async function endRoundForJudging() {
    if (!isMaster) return;
    await update(ref(db, `rooms/${joinedRoom}`), { status: 'judging' });
  }

  useEffect(() => {
    if (game?.status === 'playing' && secondsLeft <= 0 && isMaster) {
      endRoundForJudging();
    }
  }, [secondsLeft, game?.status, isMaster]);

  async function judgeAnswer(pid, category, value, accepted) {
    if (!isMaster) return;
    await set(ref(db, `rooms/${joinedRoom}/rounds/${currentRound}/judged/${pid}/${category}`), {
      value: value || '',
      accepted,
      points: accepted ? 10 : 0
    });
  }

  async function finishJudging() {
    if (!isMaster) return;
    const judged = game.rounds?.[currentRound]?.judged || {};
    const updates = { [`rooms/${joinedRoom}/status`]: currentRound >= TOTAL_ROUNDS ? 'finished' : 'between' };
    Object.keys(players).forEach(pid => {
      const roundScore = Object.values(judged[pid] || {}).reduce((sum, item) => sum + (item.points || 0), 0);
      updates[`rooms/${joinedRoom}/players/${pid}/score`] = (players[pid].score || 0) + roundScore;
    });
    await update(ref(db), updates);
  }

  async function leaveRoom() {
    if (joinedRoom) await remove(ref(db, `rooms/${joinedRoom}/players/${id}`));
    localStorage.removeItem('letterRushRoom');
    setJoinedRoom('');
    setGame(null);
  }

  if (!joinedRoom) {
    return <main className="container narrow">
      <h1>Letter Rush</h1>
      <p className="muted">A multiplayer 10-round category game with a game master.</p>
      <input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
      <button onClick={createRoom}>Create Game</button>
      <div className="divider">or</div>
      <input placeholder="Room code" value={roomCode} onChange={e => setRoomCode(e.target.value.toUpperCase())} />
      <button className="secondary" onClick={joinRoom}>Join Game</button>
    </main>;
  }

  return <main className="container">
    <header className="topbar">
      <div>
        <h1>Letter Rush</h1>
        <p>Room: <strong>{joinedRoom}</strong> · Round {currentRound || 0}/{TOTAL_ROUNDS}</p>
      </div>
      <button className="danger" onClick={leaveRoom}>Leave</button>
    </header>

    <section className="grid two">
      <div className="card">
        <h2>Players</h2>
        {Object.entries(players).map(([pid, p]) => <div className="player" key={pid}>
          <span>{p.name} {p.role === 'master' ? '👑 Game Master' : ''}</span>
          <strong>{p.score || 0}</strong>
          {isMaster && pid !== id && <button className="small" onClick={() => assignMaster(pid)}>Make Master</button>}
        </div>)}
      </div>

      <div className="card center">
        <h2>Status: {game?.status}</h2>
        {round && <><div className="letter">{round.letter}</div><p className="timer">{secondsLeft}s</p></>}
        {isMaster && (game?.status === 'lobby' || game?.status === 'between') && <button onClick={startRound}>Start Next Round</button>}
        {isMaster && game?.status === 'playing' && <button className="secondary" onClick={endRoundForJudging}>End Round Now</button>}
        {isMaster && isJudging && <button onClick={finishJudging}>Finish Judging</button>}
      </div>
    </section>

    {isAnswering && <section className="card">
      <h2>Your Answers</h2>
      <p>Letter: <strong>{round.letter}</strong>. Submit before the timer ends.</p>
      <div className="answerGrid">
        {game.categories.map(cat => <label key={cat}>{cat}
          <input value={answers[cat] || ''} onChange={e => setAnswers({ ...answers, [cat]: e.target.value })} />
        </label>)}
      </div>
      <button onClick={submitAnswers}>Submit Answers</button>
    </section>}

    {isJudging && <section className="card">
      <h2>Game Master Judging</h2>
      {!isMaster && <p className="muted">Waiting for the game master to approve answers.</p>}
      {isMaster && Object.entries(players).map(([pid, p]) => <div className="judgeBlock" key={pid}>
        <h3>{p.name}</h3>
        <table>
          <thead><tr><th>Category</th><th>Answer</th><th>Judge</th></tr></thead>
          <tbody>{game.categories.map(cat => {
            const value = round.answers?.[pid]?.[cat] || '';
            const judged = round.judged?.[pid]?.[cat];
            return <tr key={cat}>
              <td>{cat}</td><td>{value || <em>Blank</em>}</td>
              <td>
                <button className={judged?.accepted === true ? 'good small' : 'small'} onClick={() => judgeAnswer(pid, cat, value, true)}>Correct</button>
                <button className={judged?.accepted === false ? 'bad small' : 'small'} onClick={() => judgeAnswer(pid, cat, value, false)}>Wrong</button>
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>)}
    </section>}

    {isFinished && <section className="card center">
      <h2>Game Finished</h2>
      <h3>Final Leaderboard</h3>
      {Object.values(players).sort((a,b)=>(b.score||0)-(a.score||0)).map((p, i) => <p key={p.name}>{i+1}. {p.name} — <strong>{p.score || 0}</strong></p>)}
    </section>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
