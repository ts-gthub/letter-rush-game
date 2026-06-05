import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ref, set, update, onValue, get, remove } from 'firebase/database';
import { db } from './firebase';
import './style.css';

const DEFAULT_CATEGORIES = ['Name', 'Animal', 'Capital', 'Fruit or Vegetable', 'Celebrity', 'Country', 'Brand', 'Thing'];
const DEFAULT_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l => !['Q', 'X', 'Z'].includes(l));
const DEFAULT_TIMER_SECONDS = 60;
const DEFAULT_TOTAL_ROUNDS = 10;

function randomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function pickRandomLetter(allowedLetters, usedLetters) {
  const remaining = allowedLetters.filter(letter => !usedLetters.includes(letter));
  if (!remaining.length) return null;
  return remaining[Math.floor(Math.random() * remaining.length)];
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
  const [showRules, setShowRules] = useState(false);
  const id = useMemo(() => playerId(), []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!joinedRoom) return;
    const gameRef = ref(db, `rooms/${joinedRoom}`);
    const unsub = onValue(gameRef, snap => setGame(snap.val()));
    return () => unsub();
  }, [joinedRoom]);

  const players = game?.players || {};
  const me = players[id];
  const isMaster = me?.role === 'master';
  const currentRound = game?.currentRound || 0;
  const round = game?.rounds?.[currentRound];
  const settings = game?.settings || {};
  const categories = game?.categories || DEFAULT_CATEGORIES;
  const allowedLetters = game?.allowedLetters || DEFAULT_LETTERS;
  const totalRounds = Number(game?.totalRounds || DEFAULT_TOTAL_ROUNDS);
  const timerSeconds = Number(settings.timerSeconds || DEFAULT_TIMER_SECONDS);
  const gameMode = settings.mode || 'timer';
  const secondsLeft = round?.startedAt && gameMode !== 'done_only'
    ? Math.max(0, Math.ceil((round.startedAt + timerSeconds * 1000 - now) / 1000))
    : null;
  const hasSubmitted = !!round?.answers?.[id];
  const isAnswering = game?.status === 'playing' && !hasSubmitted && (gameMode === 'done_only' || secondsLeft > 0);
  const isJudging = game?.status === 'judging';
  const isFinished = game?.status === 'finished';
  const allFilled = categories.every(cat => (answers[cat] || '').trim());

  async function createRoom() {
    const cleanName = name.trim();
    if (!cleanName) return alert('Enter your name first.');
    localStorage.setItem('letterRushName', cleanName);
    const code = randomCode();
    await set(ref(db, `rooms/${code}`), {
      createdAt: Date.now(),
      status: 'lobby',
      currentRound: 0,
      categories: DEFAULT_CATEGORIES,
      allowedLetters: DEFAULT_LETTERS,
      usedLetters: [],
      totalRounds: DEFAULT_TOTAL_ROUNDS,
      settings: {
        mode: 'timer',
        timerSeconds: DEFAULT_TIMER_SECONDS
      },
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

  async function updateSettings(patch) {
    if (!isMaster || game?.status !== 'lobby') return;
    await update(ref(db, `rooms/${joinedRoom}`), patch);
  }

  async function toggleCategory(category) {
    const next = categories.includes(category)
      ? categories.filter(c => c !== category)
      : [...categories, category];
    if (!next.length) return alert('You need at least one category.');
    await updateSettings({ categories: next });
  }

  async function toggleLetter(letter) {
    const next = allowedLetters.includes(letter)
      ? allowedLetters.filter(l => l !== letter)
      : [...allowedLetters, letter].sort();
    if (!next.length) return alert('You need at least one letter.');
    await updateSettings({ allowedLetters: next });
  }

  async function startRound() {
    if (!isMaster) return;
    if (!categories.length) return alert('Choose at least one category.');
    if (totalRounds > allowedLetters.length) return alert('Rounds cannot be more than the number of selected letters, because letters cannot repeat.');

    const nextRound = game.status === 'lobby' ? 1 : currentRound + 1;
    if (nextRound > totalRounds) {
      await update(ref(db, `rooms/${joinedRoom}`), { status: 'finished' });
      return;
    }

    const usedLetters = game.usedLetters || [];
    const letter = pickRandomLetter(allowedLetters, usedLetters);
    if (!letter) return alert('No letters left. Add more letters or reduce rounds.');

    setAnswers({});
    await update(ref(db, `rooms/${joinedRoom}`), {
      status: 'playing',
      currentRound: nextRound,
      usedLetters: [...usedLetters, letter],
      [`rounds/${nextRound}`]: {
        letter,
        startedAt: Date.now(),
        answers: {},
        judged: {},
        doneBy: ''
      }
    });
  }

  async function submitAnswers(doneClicked = false) {
    if (!round || hasSubmitted) return;
    const cleanAnswers = {};
    categories.forEach(cat => cleanAnswers[cat] = (answers[cat] || '').trim());
    await set(ref(db, `rooms/${joinedRoom}/rounds/${currentRound}/answers/${id}`), cleanAnswers);

    if (doneClicked && (gameMode === 'timer_done' || gameMode === 'done_only')) {
      await update(ref(db, `rooms/${joinedRoom}`), {
        status: 'judging',
        [`rounds/${currentRound}/doneBy`]: id,
        [`rounds/${currentRound}/endedAt`]: Date.now()
      });
    }
  }

  async function clickDone() {
    if (!allFilled) return alert('Fill every category before clicking Done.');
    await submitAnswers(true);
  }

  async function endRoundForJudging() {
    if (!isMaster) return;
    await update(ref(db, `rooms/${joinedRoom}`), {
      status: 'judging',
      [`rounds/${currentRound}/endedAt`]: Date.now()
    });
  }

  useEffect(() => {
    if (game?.status === 'playing' && gameMode !== 'done_only' && secondsLeft <= 0 && !hasSubmitted) {
      submitAnswers(false);
    }
  }, [secondsLeft, game?.status, hasSubmitted, gameMode]);

  useEffect(() => {
    if (game?.status === 'playing' && gameMode !== 'done_only' && secondsLeft <= 0 && isMaster) {
      endRoundForJudging();
    }
  }, [secondsLeft, game?.status, isMaster, gameMode]);

  async function judgeAnswer(pid, category, value, accepted) {
    if (!isMaster) return;
    const isDonePlayer = round.doneBy === pid;
    const points = accepted ? 10 : (isDonePlayer && value ? -20 : 0);
    await set(ref(db, `rooms/${joinedRoom}/rounds/${currentRound}/judged/${pid}/${category}`), {
      value: value || '',
      accepted,
      points
    });
  }

  async function finishJudging() {
    if (!isMaster) return;
    const judged = game.rounds?.[currentRound]?.judged || {};
    const updates = { [`rooms/${joinedRoom}/status`]: currentRound >= totalRounds ? 'finished' : 'between' };
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
      <p className="muted">A multiplayer category game with a game master.</p>
      <button className="secondary" onClick={() => setShowRules(!showRules)}>Rules</button>
      {showRules && <Rules />}
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
        <p>Room: <strong>{joinedRoom}</strong> · Round {currentRound || 0}/{totalRounds}</p>
      </div>
      <div>
        <button className="secondary" onClick={() => setShowRules(!showRules)}>Rules</button>
        <button className="danger" onClick={leaveRoom}>Leave</button>
      </div>
    </header>

    {showRules && <Rules />}

    {isMaster && game?.status === 'lobby' && <section className="card">
      <h2>Game Master Settings</h2>
      <div className="grid two">
        <label>Rounds
          <input type="number" min="1" max={allowedLetters.length} value={totalRounds}
            onChange={e => updateSettings({ totalRounds: Math.max(1, Number(e.target.value || 1)) })} />
        </label>
        <label>Timer seconds
          <input type="number" min="10" value={timerSeconds}
            onChange={e => updateSettings({ 'settings/timerSeconds': Math.max(10, Number(e.target.value || 10)) })} />
        </label>
      </div>

      <label>Game mode
        <select value={gameMode} onChange={e => updateSettings({ 'settings/mode': e.target.value })}>
          <option value="timer">Timer only</option>
          <option value="timer_done">Timer + Done button</option>
          <option value="done_only">Unlimited time until someone clicks Done</option>
        </select>
      </label>

      <h3>Categories</h3>
      <div className="checks">
        {DEFAULT_CATEGORIES.map(cat => <label key={cat} className="check"><input type="checkbox" checked={categories.includes(cat)} onChange={() => toggleCategory(cat)} /> {cat}</label>)}
      </div>

      <h3>Letters</h3>
      <p className="muted">Uncheck letters you do not want. Letters will not repeat in the same game.</p>
      <div className="letters">
        {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => <label key={letter} className="letterCheck"><input type="checkbox" checked={allowedLetters.includes(letter)} onChange={() => toggleLetter(letter)} /> {letter}</label>)}
      </div>
    </section>}

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
        {round && <><div className="letter">{round.letter}</div>{gameMode !== 'done_only' ? <p className="timer">{secondsLeft}s</p> : <p className="timer">No timer</p>}</>}
        {round?.doneBy && <p><strong>{players[round.doneBy]?.name}</strong> clicked Done.</p>}
        {isMaster && (game?.status === 'lobby' || game?.status === 'between') && <button onClick={startRound}>{game?.status === 'lobby' ? 'Start Game' : 'Start Next Round'}</button>}
        {isMaster && game?.status === 'playing' && <button className="secondary" onClick={endRoundForJudging}>End Round Now</button>}
        {isMaster && isJudging && <button onClick={finishJudging}>Finish Judging</button>}
      </div>
    </section>

    {game?.status === 'playing' && <section className="card">
      <h2>Your Answers</h2>
      <p>Letter: <strong>{round.letter}</strong>. {gameMode === 'done_only' ? 'There is no timer.' : 'Your answers auto-submit when the timer ends.'}</p>
      <div className="answerGrid">
        {categories.map(cat => <label key={cat}>{cat}
          <input disabled={hasSubmitted} value={answers[cat] || ''} onChange={e => setAnswers({ ...answers, [cat]: e.target.value })} />
        </label>)}
      </div>
      {!hasSubmitted && <button onClick={() => submitAnswers(false)}>Submit Answers</button>}
      {!hasSubmitted && gameMode !== 'timer' && <button className="secondary" disabled={!allFilled} onClick={clickDone}>Done</button>}
      {hasSubmitted && <p className="muted">Submitted. Waiting for the round to end.</p>}
    </section>}

    {(isJudging || game?.status === 'between') && round && <AllAnswers players={players} categories={categories} round={round} />}

    {isJudging && <section className="card">
      <h2>Game Master Judging</h2>
      {!isMaster && <p className="muted">Waiting for the game master to approve answers.</p>}
      {isMaster && Object.entries(players).map(([pid, p]) => <div className="judgeBlock" key={pid}>
        <h3>{p.name} {round.doneBy === pid ? '(clicked Done — wrong answers are -20)' : ''}</h3>
        <table>
          <thead><tr><th>Category</th><th>Answer</th><th>Points</th><th>Judge</th></tr></thead>
          <tbody>{categories.map(cat => {
            const value = round.answers?.[pid]?.[cat] || '';
            const judged = round.judged?.[pid]?.[cat];
            return <tr key={cat}>
              <td>{cat}</td><td>{value || <em>Blank</em>}</td><td>{judged ? judged.points : '-'}</td>
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
      {Object.values(players).sort((a, b) => (b.score || 0) - (a.score || 0)).map((p, i) => <p key={p.name}>{i + 1}. {p.name} — <strong>{p.score || 0}</strong></p>)}
    </section>}
  </main>;
}

function AllAnswers({ players, categories, round }) {
  return <section className="card">
    <h2>All Answers</h2>
    <div className="tableWrap">
      <table>
        <thead><tr><th>Player</th>{categories.map(cat => <th key={cat}>{cat}</th>)}</tr></thead>
        <tbody>{Object.entries(players).map(([pid, p]) => <tr key={pid}>
          <td>{p.name}</td>
          {categories.map(cat => <td key={cat}>{round.answers?.[pid]?.[cat] || <em>Blank</em>}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function Rules() {
  return <section className="card rules">
    <h2>Rules</h2>
    <ul>
      <li>The game master chooses categories, letters, timer, mode, and number of rounds.</li>
      <li>Each round gets one random letter. The same letter cannot appear twice in the same game.</li>
      <li>Write an answer for each category using the round letter.</li>
      <li>Correct answers are worth 10 points.</li>
      <li>In Done modes, the Done button only works when every category is filled.</li>
      <li>If someone clicks Done, their answers auto-submit and the round moves to judging.</li>
      <li>If the Done player has a wrong answer, that wrong answer is -20 points.</li>
      <li>When the timer ends, answers automatically submit.</li>
      <li>At the end of each round, all players can see everyone’s answers.</li>
    </ul>
  </section>;
}

createRoot(document.getElementById('root')).render(<App />);
