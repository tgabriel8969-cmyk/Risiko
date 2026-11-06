// Balance-Messung der Missionen (§12). Spielt viele Partien mit dem Missions-Bot
// und gibt je Spielerzahl Kennzahlen aus. Start:
//   node scripts/balance.js [PartienJeSpielerzahl]   (Standard 120)
// Reine Node-Auswertung, kein Teil von `npm test` (zu langlaufend).
import { TERRITORIES } from '../js/map.js';
import { createGame, applyAction, currentPlayerId, countTerritories, missionGoalMet, missionType } from '../js/rules.js';
import { missionBotAction } from '../tests/bots.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `S${i + 1}` }));

// Gruppierung für die „Siegquote je Mission": Kontinent-/Gebiets-Missionen einzeln,
// Vernichtung (v_<pid>) zusammengefasst.
function missionKey(mission) {
  if (!mission) return 'keine';
  return missionType(mission) === 'vernichtung' ? 'vernichtung' : mission.id;
}

function playGame(seed, n) {
  const rng = seeded(seed);
  let s = createGame(players(n), rng, { missions: true, general: true, ordenMode: seed % 2 ? 'dynamic' : 'static' });
  const assigned = {}; // pid -> Missions-Key (zum Zeitpunkt der Wahl, vor Ausfallregel)
  let firstStager = null; // wer zuerst eine Etappe erreicht hat (Schneeball-Check)
  for (let i = 0; i < 60000 && s.phase !== 'gameover'; i++) {
    const action = missionBotAction(s, rng);
    const r = applyAction(s, action, currentPlayerId(s), rng);
    if (r.error) throw new Error(`Bot-Aktion abgelehnt (${JSON.stringify(action)}): ${r.error}`);
    s = r.state;
    for (const p of s.players) {
      if (!assigned[p.id] && p.mission) assigned[p.id] = missionKey(p.mission);
      if (!firstStager && p.stagesDone?.some(Boolean)) firstStager = p.id;
    }
  }
  if (s.phase !== 'gameover') return { finished: false };
  const winner = s.winner;
  const fullMap = countTerritories(s, winner) === TERRITORIES.length;
  const byMission = !fullMap && missionGoalMet(s, winner);
  return {
    finished: true,
    winner,
    winKey: assigned[winner] || 'keine',
    assigned,
    winTurn: s.turn,
    winBy: byMission ? 'mission' : 'conquest',
    firstStager,
    snowball: firstStager != null && winner === firstStager,
    hadStager: firstStager != null,
  };
}

function runCount(n, games, seedBase) {
  const assignedCounts = {}; // key -> wie oft zugeteilt
  const winCounts = {}; // key -> wie oft gewonnen
  let turns = 0;
  let byMission = 0;
  let snowballWins = 0;
  let snowballGames = 0;
  let finished = 0;
  for (let g = 0; g < games; g++) {
    const res = playGame(seedBase + g, n);
    if (!res.finished) continue;
    finished++;
    for (const key of Object.values(res.assigned)) assignedCounts[key] = (assignedCounts[key] || 0) + 1;
    winCounts[res.winKey] = (winCounts[res.winKey] || 0) + 1;
    turns += res.winTurn;
    if (res.winBy === 'mission') byMission++;
    if (res.hadStager) { snowballGames++; if (res.snowball) snowballWins++; }
  }
  return { n, games, finished, assignedCounts, winCounts, turns, byMission, snowballWins, snowballGames };
}

function pct(x, total) { return total ? `${((100 * x) / total).toFixed(1)}%` : '—'; }

function report(r) {
  console.log(`\n=== ${r.n} Spieler · ${r.finished}/${r.games} Partien beendet ===`);
  console.log(`Ø Siegrunde: ${(r.turns / r.finished).toFixed(1)} · Sieg durch Mission: ${pct(r.byMission, r.finished)} · durch Komplett-Eroberung: ${pct(r.finished - r.byMission, r.finished)}`);
  console.log(`Schneeball (wer zuerst eine Etappe erreicht, gewinnt): ${pct(r.snowballWins, r.snowballGames)} von ${r.snowballGames} Partien`);
  console.log('Mission                 zugeteilt   Siege   Siegquote');
  const keys = Object.keys(r.assignedCounts).sort();
  for (const k of keys) {
    const a = r.assignedCounts[k] || 0;
    const w = r.winCounts[k] || 0;
    console.log(`  ${k.padEnd(22)} ${String(a).padStart(6)}  ${String(w).padStart(6)}   ${pct(w, a)}`);
  }
}

const perCount = Math.max(1, Number(process.argv[2]) || 120);
const counts = [3, 4, 5, 7];
console.log(`Balance-Messung: ${perCount} Partien je Spielerzahl (${counts.join(', ')}) mit dem Missions-Bot …`);
const t0 = Date.now();
for (const n of counts) report(runCount(n, perCount, 10000 + n * 100000));
console.log(`\nFertig in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
