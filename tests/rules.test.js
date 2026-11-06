// Ausführen mit: npm test   (bzw. node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERRITORIES, ADJACENCY, EDGES, CONTINENTS, CONTINENT_TERRITORIES, TERRITORY_BY_ID } from '../js/map.js';
import {
  createGame, applyAction, currentPlayerId, countTerritories, calcReinforcements,
  validAttackTargets, reachableOwn, START_ARMIES, SETUP_BATCH, MAX_PLAYERS,
  ordenSets, ordenReward, ORDEN_STATIC_BONUS, ORDEN_FORCE_AT, viewFor,
  missionGoalMet, missionProgress, buildMissionPool, MISSION_STAGE_BONUS,
  DEPESCHE_CARDS, DEPESCHE_HAND_LIMIT, missionType, PILLORY_LABEL,
} from '../js/rules.js';

// Deterministischer Zufall (mulberry32), damit Tests reproduzierbar sind
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Liefert eine feste Würfelfolge (Werte 1–6)
function diceSeq(values) {
  let i = 0;
  return () => (values[i++ % values.length] - 1) / 6 + 0.01;
}

const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Spieler ${i + 1}` }));
const act = (s, action, actor = currentPlayerId(s), rng) => {
  const r = applyAction(s, action, actor, rng);
  if (r.error) throw new Error(r.error);
  return r.state;
};

function finishSetup(s) {
  let guard = 0;
  while (s.phase === 'setup' && guard++ < 1000) {
    const pid = currentPlayerId(s);
    const own = Object.keys(s.territories).find((id) => s.territories[id].owner === pid);
    s = act(s, { type: 'place', territory: own, count: 1 });
  }
  return s;
}

// ------------------------------------------------------------------ Karte

test('Karte: Kanten verweisen nur auf existierende Gebiete, keine Duplikate', () => {
  const seen = new Set();
  for (const [a, b] of EDGES) {
    assert.ok(TERRITORY_BY_ID[a], `unbekannt: ${a}`);
    assert.ok(TERRITORY_BY_ID[b], `unbekannt: ${b}`);
    const key = [a, b].sort().join('|');
    assert.ok(!seen.has(key), `doppelte Kante: ${key}`);
    seen.add(key);
  }
});

test('Karte: Nachbarschaften symmetrisch, Graph zusammenhängend, Kontinente gültig', () => {
  for (const t of TERRITORIES) {
    assert.ok(CONTINENTS[t.continent], `Kontinent fehlt: ${t.id}`);
    for (const n of ADJACENCY[t.id]) assert.ok(ADJACENCY[n].includes(t.id));
  }
  const seen = new Set([TERRITORIES[0].id]);
  const q = [TERRITORIES[0].id];
  while (q.length) for (const n of ADJACENCY[q.shift()]) if (!seen.has(n)) { seen.add(n); q.push(n); }
  assert.equal(seen.size, TERRITORIES.length);
});

// ------------------------------------------------------------------ Start

test('createGame: alle Gebiete verteilt, Start-Truppen korrekt (2–7 Spieler)', () => {
  for (let n = 2; n <= MAX_PLAYERS; n++) {
    const s = createGame(players(n), seeded(n));
    assert.equal(Object.keys(s.territories).length, TERRITORIES.length);
    for (const pid of s.order) {
      assert.equal(countTerritories(s, pid) + s.setupRemaining[pid], START_ARMIES[n]);
    }
    assert.equal(s.phase, 'setup');
  }
});

test('Aufstellung: max. 3 Truppen pro Durchgang, danach erster Zug mit Verstärkung', () => {
  let s = createGame(players(3), seeded(1));
  const pid = currentPlayerId(s);
  const own = Object.keys(s.territories).find((id) => s.territories[id].owner === pid);
  assert.ok(applyAction(s, { type: 'place', territory: own, count: SETUP_BATCH + 1 }, pid).error);
  s = act(s, { type: 'place', territory: own, count: SETUP_BATCH });
  assert.notEqual(currentPlayerId(s), pid, 'nach 3 Truppen ist der Nächste dran');
  s = finishSetup(s);
  assert.equal(s.phase, 'reinforce');
  assert.equal(s.reinforcements, calcReinforcements(s, currentPlayerId(s)).total);
});

test('Falscher Spieler und ungültige Aktionen werden abgelehnt', () => {
  const s = createGame(players(2), seeded(2));
  const other = s.order[1];
  const own = Object.keys(s.territories).find((id) => s.territories[id].owner === other);
  assert.match(applyAction(s, { type: 'place', territory: own, count: 1 }, other).error, /nicht am Zug/);
  assert.ok(applyAction(s, { type: 'gibtsnicht' }, s.order[0]).error);
  assert.ok(applyAction(s, { type: 'toString' }, s.order[0]).error);
  assert.ok(applyAction(s, null, s.order[0]).error);
});

// ------------------------------------------------------------------ Kampf

function attackSetup() {
  let s = finishSetup(createGame(players(2), seeded(3)));
  const pid = currentPlayerId(s);
  // Ein eigenes Gebiet mit feindlichem Nachbarn suchen
  const from = Object.keys(s.territories).find(
    (id) => s.territories[id].owner === pid && ADJACENCY[id].some((n) => s.territories[n].owner !== pid),
  );
  const to = ADJACENCY[from].find((n) => s.territories[n].owner !== pid);
  s = act(s, { type: 'place', territory: from, count: s.reinforcements });
  return { s, pid, from, to };
}

test('Angriff: Würfelvergleich, Gleichstand gewinnt Verteidiger', () => {
  const { s, from, to } = attackSetup();
  s.territories[to].troops = 2;
  const before = s.territories[from].troops;
  // Angreifer würfelt 6,3,1 – Verteidiger 5,3 -> 6>5 (Def -1), 3=3 (Att -1)
  const r = applyAction(s, { type: 'attack', from, to, dice: 3 }, currentPlayerId(s), diceSeq([6, 3, 1, 5, 3]));
  assert.ifError(r.error);
  assert.equal(r.state.territories[from].troops, before - 1);
  assert.equal(r.state.territories[to].troops, 1);
});

test('Eroberung: Besitzerwechsel und Nachrücken zwischen min und max', () => {
  const { s, pid, from, to } = attackSetup();
  s.territories[to].troops = 1;
  s.territories[from].troops = 6;
  let r = applyAction(s, { type: 'attack', from, to, dice: 3 }, pid, diceSeq([6, 6, 6, 1]));
  assert.ifError(r.error);
  assert.equal(r.state.territories[to].owner, pid);
  assert.deepEqual(r.state.pendingMove, { from, to, min: 3, max: 5 });
  assert.ok(applyAction(r.state, { type: 'endAttack' }, pid).error, 'erst nachrücken');
  assert.ok(applyAction(r.state, { type: 'occupy', count: 2 }, pid).error);
  const s2 = act(r.state, { type: 'occupy', count: 4 }, pid);
  assert.equal(s2.territories[to].troops, 4);
  assert.equal(s2.territories[from].troops, 2);
});

test('Angriff auf Nicht-Nachbarn und mit zu vielen Würfeln wird abgelehnt', () => {
  const { s, pid, from } = attackSetup();
  const far = Object.keys(s.territories).find((id) => s.territories[id].owner !== pid && !ADJACENCY[from].includes(id));
  assert.match(applyAction(s, { type: 'attack', from, to: far }, pid).error, /grenzen nicht/);
  const to = [...validAttackTargets(s, from)][0];
  s.territories[from].troops = 2;
  assert.ok(applyAction(s, { type: 'attack', from, to, dice: 2 }, pid).error);
});

test('Verschieben nur über verbundene eigene Gebiete, beendet den Zug', () => {
  let { s, pid, from } = attackSetup();
  s = act(s, { type: 'endAttack' });
  const target = ADJACENCY[from].find((n) => s.territories[n].owner === pid);
  if (target) {
    const s2 = act(s, { type: 'fortify', from, to: target, count: 1 });
    assert.notEqual(currentPlayerId(s2), pid);
    assert.equal(s2.phase, 'reinforce');
  }
  const enemy = Object.keys(s.territories).find((id) => s.territories[id].owner !== pid);
  assert.ok(applyAction(s, { type: 'fortify', from, to: enemy, count: 1 }, pid).error);
});

test('forceSkip überspringt den aktuellen Spieler', () => {
  const { s, pid } = attackSetup();
  const r = applyAction(s, { type: 'forceSkip' }, 'host');
  assert.notEqual(currentPlayerId(r.state), pid);
});

// ------------------------------------------------------------------ Orden

test('Orden: Eroberung bringt beim Zugende einen Orden, sonst nicht', () => {
  let s = finishSetup(createGame(players(2), seeded(11)));
  const pid = currentPlayerId(s);
  s.phase = 'fortify';
  s.conqueredThisTurn = true;
  const r = act(s, { type: 'endTurn' });
  assert.equal(r.players.find((p) => p.id === pid).orden.length, 1);

  let s2 = finishSetup(createGame(players(2), seeded(12)));
  const pid2 = currentPlayerId(s2);
  s2.phase = 'fortify';
  s2.conqueredThisTurn = false;
  const r2 = act(s2, { type: 'endTurn' });
  assert.equal(r2.players.find((p) => p.id === pid2).orden.length, 0);
});

test('Orden: Satz einlösen – statisch +5, dynamisch gestaffelt, ungültige abgelehnt', () => {
  let s = finishSetup(createGame(players(3), seeded(13), { ordenMode: 'static' }));
  const pid = currentPlayerId(s);
  s.players.find((p) => p.id === pid).orden = ['kreuz', 'kreuz', 'kreuz'];
  const before = s.reinforcements;
  const r = act(s, { type: 'redeemOrden', set: ['kreuz', 'kreuz', 'kreuz'] });
  assert.equal(r.reinforcements, before + ORDEN_STATIC_BONUS);
  assert.equal(r.players.find((p) => p.id === pid).orden.length, 0);
  assert.equal(r.setsRedeemed, 1);

  let s2 = finishSetup(createGame(players(3), seeded(14), { ordenMode: 'static' }));
  const pid2 = currentPlayerId(s2);
  s2.players.find((p) => p.id === pid2).orden = ['kreuz', 'kreuz', 'krone'];
  assert.ok(applyAction(s2, { type: 'redeemOrden', set: ['kreuz', 'kreuz', 'krone'] }, pid2).error, 'ungültiger Satz');
  assert.ok(applyAction(s2, { type: 'redeemOrden', set: ['medaille', 'medaille', 'medaille'] }, pid2).error, 'nicht besessen');

  let s3 = finishSetup(createGame(players(3), seeded(15), { ordenMode: 'dynamic' }));
  const pid3 = currentPlayerId(s3);
  s3.players.find((p) => p.id === pid3).orden = ['kreuz', 'krone', 'medaille'];
  const exp = ordenReward(s3);
  const r3 = act(s3, { type: 'redeemOrden', set: ['kreuz', 'krone', 'medaille'] });
  assert.equal(r3.reinforcements, s3.reinforcements + exp);
});

test(`Orden: ab ${ORDEN_FORCE_AT} Orden erzwingt Einlösen vor der Angriffsphase`, () => {
  let s = finishSetup(createGame(players(3), seeded(16), { ordenMode: 'static' }));
  const pid = currentPlayerId(s);
  s.players.find((x) => x.id === pid).orden = ['kreuz', 'kreuz', 'krone', 'krone', 'medaille'];
  const own = Object.keys(s.territories).find((id) => s.territories[id].owner === pid);
  const r = act(s, { type: 'place', territory: own, count: s.reinforcements });
  assert.equal(r.reinforcements, 0);
  assert.equal(r.phase, 'reinforce', 'Zwang: bleibt in Verstärken, bis eingelöst');
  assert.ok(ordenSets(r.players.find((x) => x.id === pid).orden).length > 0);
});

// ------------------------------------------------------------------ Sichtbarkeit (viewFor)

test('viewFor: fremde Geheimnisse (Mission, Depeschen, Wahl, stats, private Logs) sind entfernt', () => {
  const s = createGame(players(3), seeded(21));
  const [p0, p1] = s.players;
  // künstlich Geheimfelder setzen (entstehen erst in späteren Schritten)
  p0.mission = { id: 'g_weltmacht' };
  p0.stats = { generalConquests: 2 };
  p0.depeschen = ['a', 'b'];
  p0.depeschenChoice = ['x', 'y'];
  p1.mission = { id: 'k_na_af' };
  p1.depeschen = ['c'];
  s.log.push({ turn: s.turn, text: 'privat für p0', visibleTo: [p0.id] });
  s.log.push({ turn: s.turn, text: 'öffentlich' });

  const v0 = viewFor(s, p0.id);
  // eigene Infos bleiben vollständig
  assert.deepEqual(v0.players[0].mission, { id: 'g_weltmacht' });
  assert.deepEqual(v0.players[0].depeschen, ['a', 'b']);
  // fremder Spieler p1: Geheimnisse weg, nur Anzahl
  assert.equal(v0.players[1].mission, undefined);
  assert.equal(v0.players[1].depeschen, undefined);
  assert.equal(v0.players[1].depeschenCount, 1);
  // eigenes privates Log + öffentliches Log sichtbar
  assert.ok(v0.log.some((e) => e.text === 'privat für p0'));
  assert.ok(v0.log.some((e) => e.text === 'öffentlich'));

  const v1 = viewFor(s, p1.id);
  // p1 sieht p0s Geheimnisse nicht und das private Log nicht
  assert.equal(v1.players[0].mission, undefined);
  assert.equal(v1.players[0].stats, undefined);
  assert.equal(v1.players[0].depeschenChoice, undefined);
  assert.equal(v1.players[0].depeschenCount, 2);
  assert.ok(!v1.log.some((e) => e.text === 'privat für p0'));
  assert.ok(v1.log.some((e) => e.text === 'öffentlich'));

  // reine Funktion: Original unverändert
  assert.deepEqual(s.players[1].mission, { id: 'k_na_af' });
  assert.equal(s.players[0].depeschen.length, 2);
  assert.equal(s.log.filter((e) => e.text === 'privat für p0').length, 1);
});

// ------------------------------------------------------------------ Missionen

const giveContinents = (s, pid, cids) => {
  for (const cid of cids) for (const tid of CONTINENT_TERRITORIES[cid]) s.territories[tid] = { owner: pid, troops: 1 };
};

test('Missionen: Auswahl – 2 Optionen je Spieler, keine Selbst-Vernichtung, eindeutig', () => {
  for (let n = 3; n <= MAX_PLAYERS; n++) {
    const s = createGame(players(n), seeded(100 + n), { missions: true });
    assert.equal(s.missions, true);
    const all = [];
    for (const p of s.players) {
      assert.equal(p.mission, null, 'noch nicht gewählt');
      assert.equal(p.missionOptions.length, 2, '2 Optionen zur Wahl');
      for (const m of p.missionOptions) {
        assert.notEqual(m.id, `v_${p.id}`, 'keine Vernichtung gegen sich selbst');
        all.push(m.id);
      }
    }
    assert.equal(new Set(all).size, all.length, 'Optionen ohne Zurücklegen (keine Duplikate)');
  }
  // Pool-Größe (ohne General): 6 Kontinent + 2 Gebiet + n Vernichtung
  assert.equal(buildMissionPool(['p1', 'p2', 'p3']).length, 6 + 2 + 3);
  // 2 Spieler -> keine Missionen
  const s2 = createGame(players(2), seeded(7), { missions: true });
  assert.equal(s2.missions, false);
  assert.ok(!s2.players[0].missionOptions);
});

test('Missionen: chooseMission – gültige Wahl, unabhängig vom Zug, Fehlerfälle', () => {
  const s = createGame(players(3), seeded(101), { missions: true });
  // ein Nicht-aktueller Spieler darf trotzdem wählen
  const other = s.order[(s.order.indexOf(currentPlayerId(s)) + 1) % 3];
  const opt = s.players.find((p) => p.id === other).missionOptions;
  // ungültige id (steht nicht zur Wahl)
  assert.match(applyAction(s, { type: 'chooseMission', id: 'gibtsnicht' }, other).error, /zur Wahl/);
  // gültige Wahl
  const r = act(s, { type: 'chooseMission', id: opt[0].id }, other);
  const p = r.players.find((x) => x.id === other);
  assert.equal(p.mission.id, opt[0].id);
  assert.equal(p.missionOptions, null);
  // kein zweites Mal
  assert.match(applyAction(r, { type: 'chooseMission', id: opt[1].id }, other).error, /bereits/);
  // fremde Optionen sind in viewFor nicht sichtbar
  const v = viewFor(s, currentPlayerId(s));
  assert.equal(v.players.find((x) => x.id === other).missionOptions, undefined);
});

test('Missionen: Endziel Kontinent & Weltmacht lösen Sieg aus', () => {
  // Kontinent k_na_af: Nordamerika + Afrika komplett -> met
  let s = createGame(players(3), seeded(110), { missions: true });
  const pid = s.players[0].id;
  s.players[0].mission = { id: 'k_na_af' };
  assert.equal(missionGoalMet(s, pid), false);
  giveContinents(s, pid, ['nordamerika', 'afrika']);
  assert.equal(missionGoalMet(s, pid), true);
  assert.equal(missionProgress(s, pid).goal.met, true);

  // Weltmacht end-to-end: 28 Gebiete (3 Spieler) -> Sieg nach einer Aktion
  let s2 = createGame(players(3), seeded(111), { missions: true });
  const wid = s2.players[0].id;
  s2.players[0].mission = { id: 'g_weltmacht' };
  const terr = Object.keys(s2.territories);
  terr.forEach((t, i) => { s2.territories[t] = { owner: i < 28 ? wid : s2.players[1].id, troops: 1 }; });
  s2.phase = 'reinforce';
  s2.current = s2.order.indexOf(wid);
  s2.reinforcements = 1;
  const own = terr.find((t) => s2.territories[t].owner === wid);
  const r = applyAction(s2, { type: 'place', territory: own, count: 1 }, wid);
  assert.ifError(r.error);
  assert.equal(r.state.phase, 'gameover');
  assert.equal(r.state.winner, wid);
});

test('Vernichtung: Ausfallregel bei Fremd-Ausschaltung wechselt privat auf Weltmacht', () => {
  let s = createGame(players(3), seeded(112), { missions: true });
  const [p0, p1, p2] = s.players;
  p0.mission = { id: `v_${p2.id}`, target: p2.id };
  p1.mission = { id: 'g_bollwerk' };
  p2.mission = { id: 'k_na_af' };
  const terr = Object.keys(s.territories);
  const x = terr[0];
  const y = ADJACENCY[x][0];
  const z = terr.find((t) => t !== x && t !== y);
  for (const t of terr) s.territories[t] = { owner: p1.id, troops: 1 };
  s.territories[x] = { owner: p2.id, troops: 1 };
  s.territories[y] = { owner: p1.id, troops: 5 };
  s.territories[z] = { owner: p0.id, troops: 1 };
  s.phase = 'attack';
  s.current = s.order.indexOf(p1.id);
  s.pendingMove = null;
  s.conqueredThisTurn = false;
  const r = applyAction(s, { type: 'blitz', from: y, to: x }, p1.id, diceSeq([6, 6, 6, 1, 1]));
  assert.ifError(r.error);
  assert.equal(r.state.players.find((p) => p.id === p2.id).alive, false);
  assert.equal(r.state.players.find((p) => p.id === p0.id).mission.id, 'g_weltmacht');
  // privates Log ist für andere nicht sichtbar
  assert.ok(!viewFor(r.state, p1.id).log.some((e) => e.text.includes('Vernichtungs-Mission ist hinfällig')));
  assert.ok(viewFor(r.state, p0.id).log.some((e) => e.text.includes('Vernichtungs-Mission ist hinfällig')));
});

// ------------------------------------------------------------------ Missions-Etappen (Schritt 3)

// Hilfen: Mission setzen + Zählfelder initialisieren
function setMission(s, pid, mission) {
  const p = s.players.find((x) => x.id === pid);
  p.mission = mission;
  p.missionOptions = null;
  p.stagesDone = [false, false];
  p.stageBonus = 0;
  p.stats = { defendedSinceOwnTurn: 0 };
  return p;
}

test('Etappe 1 wird nicht durch die Startverteilung ausgelöst', () => {
  for (let g = 0; g < 50; g++) {
    const s = createGame(players(3 + (g % 5)), seeded(900 + g), { missions: true });
    for (const p of s.players) assert.deepEqual(p.stagesDone, [false, false]);
  }
});

test('Etappe 1 (Weltmacht): 3 Eroberungen im Zug → Haken + 2 Truppen, Bonus fließt genau einmal', () => {
  let s = createGame(players(3), seeded(130), { missions: true });
  const pid = currentPlayerId(s);
  setMission(s, pid, { id: 'g_weltmacht' });
  const other = s.order.find((id) => id !== pid);
  const hub = 'ontario';
  const neigh = ADJACENCY[hub].slice(0, 3);
  for (const t of Object.keys(s.territories)) s.territories[t] = { owner: other, troops: 1 };
  s.territories[hub] = { owner: pid, troops: 30 };
  for (const t of neigh) s.territories[t] = { owner: other, troops: 1 };
  s.phase = 'attack'; s.current = s.order.indexOf(pid);
  s.pendingMove = null; s.conqueredThisTurn = false;
  s.turnStats = { conquered: 0, conqueredFrom: {}, conqueredIn: {} };

  let st = s;
  for (const t of neigh) {
    let r = applyAction(st, { type: 'blitz', from: hub, to: t }, pid, diceSeq([6, 6, 6, 1]));
    assert.ifError(r.error); st = r.state;
    if (st.pendingMove) { r = applyAction(st, { type: 'occupy', count: st.pendingMove.min }, pid); assert.ifError(r.error); st = r.state; }
  }
  const p = st.players.find((x) => x.id === pid);
  assert.equal(p.stagesDone[0], true, 'Etappe 1 erreicht');
  assert.equal(p.stageBonus, MISSION_STAGE_BONUS);

  // Zug beenden und reihum zurück zu pid – der Bonus muss genau einmal in die Verstärkung fließen
  st = applyAction(st, { type: 'endAttack' }, pid).state;
  st = applyAction(st, { type: 'endTurn' }, pid).state;
  while (currentPlayerId(st) !== pid) st = applyAction(st, { type: 'forceSkip' }, 'host').state;
  const pp = st.players.find((x) => x.id === pid);
  assert.equal(pp.stageBonus, 0, 'Bonus verbraucht');
  assert.equal(st.reinforcements, calcReinforcements(st, pid).total + MISSION_STAGE_BONUS, 'die +2 steckten in dieser Verstärkung');
});

test('Etappe 2 (Weltmacht, Zustand): am Zugende erreicht → Haken + 2 Truppen', () => {
  let s = createGame(players(4), seeded(132), { missions: true });
  const pid = currentPlayerId(s);
  setMission(s, pid, { id: 'g_weltmacht' });
  const other = s.order.find((id) => id !== pid);
  const terr = Object.keys(s.territories);
  terr.forEach((t, i) => { s.territories[t] = { owner: i < 18 ? pid : other, troops: 1 }; }); // 18 = Stufe 2 bei 4 Spielern
  s.phase = 'fortify'; s.current = s.order.indexOf(pid);
  s.pendingMove = null; s.conqueredThisTurn = false;
  s.turnStats = { conquered: 0, conqueredFrom: {}, conqueredIn: {} };
  const r = applyAction(s, { type: 'endTurn' }, pid);
  assert.ifError(r.error);
  const p = r.state.players.find((x) => x.id === pid);
  assert.equal(p.stagesDone[1], true);
  assert.equal(p.stageBonus, MISSION_STAGE_BONUS);
  assert.notEqual(r.state.phase, 'gameover', 'Stufe 2 ist noch kein Sieg');
});

test('Bollwerk: Abwehr zählt pro Aktion; Etappe 1 greift zu Zugbeginn', () => {
  let s = createGame(players(3), seeded(140), { missions: true });
  const def = s.order[0];
  const att = s.order[1];
  setMission(s, def, { id: 'g_bollwerk' });
  const x = 'ontario', y = ADJACENCY['ontario'][0];
  for (const t of Object.keys(s.territories)) s.territories[t] = { owner: att, troops: 1 };
  s.territories[x] = { owner: def, troops: 10 };
  s.territories[y] = { owner: att, troops: 8 };
  s.phase = 'attack'; s.current = s.order.indexOf(att);
  s.pendingMove = null; s.conqueredThisTurn = false;
  s.turnStats = { conquered: 0, conqueredFrom: {}, conqueredIn: {} };

  // Verteidiger gewinnt – Gebiet bleibt bei def → genau eine Abwehr
  let r = applyAction(s, { type: 'attack', from: y, to: x, dice: 1 }, att, diceSeq([1, 6, 6]));
  assert.ifError(r.error); let st = r.state;
  assert.equal(st.players.find((p) => p.id === def).stats.defendedSinceOwnTurn, 1);
  // Blitz, der nicht erobert, zählt ebenfalls nur +1 (pro Aktion)
  r = applyAction(st, { type: 'blitz', from: y, to: x }, att, diceSeq([1, 6, 6]));
  assert.ifError(r.error); st = r.state;
  assert.equal(st.players.find((p) => p.id === def).stats.defendedSinceOwnTurn, 2);

  // att beendet den Zug, reihum bis def wieder dran ist → Etappe 1 (2 Abwehren) zu Zugbeginn
  st = applyAction(st, { type: 'endAttack' }, att).state;
  st = applyAction(st, { type: 'endTurn' }, att).state;
  while (currentPlayerId(st) !== def) st = applyAction(st, { type: 'forceSkip' }, 'host').state;
  const dp = st.players.find((p) => p.id === def);
  assert.equal(dp.stagesDone[0], true, 'Bollwerk-Etappe 1 bei Zugbeginn erreicht');
  assert.equal(dp.stats.defendedSinceOwnTurn, 0, 'Abwehrzähler ab eigenem Zugbeginn zurückgesetzt');
});

// ------------------------------------------------------------------ Depeschen (Schritt 4)

// Gibt einem Spieler direkt eine Karte in die Hand und bereitet die Phase vor.
function giveDepesche(s, pid, id, phase = 'attack') {
  const p = s.players.find((x) => x.id === pid);
  p.depeschen = [id];
  s.phase = phase;
  s.current = s.order.indexOf(pid);
  s.pendingMove = null;
  s.depeschePlayedThisTurn = false;
  s.turnStats = { conquered: 0, conqueredFrom: {}, conqueredIn: {} };
  return p;
}

test('Depesche: Etappe-1-Belohnung legt eine Stufe-I-Wahl an', () => {
  let s = createGame(players(3), seeded(200), { missions: true });
  const pid = currentPlayerId(s);
  setMission(s, pid, { id: 'g_weltmacht' });
  const other = s.order.find((id) => id !== pid);
  const hub = 'ontario';
  const neigh = ADJACENCY[hub].slice(0, 3);
  for (const t of Object.keys(s.territories)) s.territories[t] = { owner: other, troops: 1 };
  s.territories[hub] = { owner: pid, troops: 30 };
  for (const t of neigh) s.territories[t] = { owner: other, troops: 1 };
  s.phase = 'attack'; s.current = s.order.indexOf(pid);
  s.pendingMove = null; s.conqueredThisTurn = false;
  s.turnStats = { conquered: 0, conqueredFrom: {}, conqueredIn: {} };
  let st = s;
  for (const t of neigh) {
    let r = applyAction(st, { type: 'blitz', from: hub, to: t }, pid, diceSeq([6, 6, 6, 1]));
    st = r.state;
    if (st.pendingMove) st = applyAction(st, { type: 'occupy', count: st.pendingMove.min }, pid).state;
  }
  const p = st.players.find((x) => x.id === pid);
  assert.equal(p.depeschenChoice.length, 1);
  assert.equal(p.depeschenChoice[0].level, 1);
  assert.equal(p.depeschenChoice[0].cards.length, 2);
  for (const c of p.depeschenChoice[0].cards) assert.equal(DEPESCHE_CARDS[c].level, 1);
});

test('chooseDepesche: behalten, Handlimit mit Ablegen, außerhalb des Zugs erlaubt', () => {
  let s = createGame(players(3), seeded(201), { missions: true });
  const me = s.order[1]; // NICHT der aktuelle Spieler
  const p = s.players.find((x) => x.id === me);
  p.depeschenChoice = [{ level: 1, cards: ['gewaltmarsch', 'nachschub'] }];
  // außerhalb des eigenen Zugs wählbar
  let r = applyAction(s, { type: 'chooseDepesche', keep: 'a' }, me);
  assert.ifError(r.error);
  let st = r.state;
  let pp = st.players.find((x) => x.id === me);
  assert.deepEqual(pp.depeschen, ['gewaltmarsch']);
  assert.equal(pp.depeschenChoice.length, 0);
  assert.equal(st.depeschenDiscard[1].includes('nachschub'), true, 'nicht gewählte Karte auf Ablage');

  // Hand voll -> Ablegen nötig
  pp.depeschen = ['gewaltmarsch', 'nachschub', 'sabotage'];
  pp.depeschenChoice = [{ level: 2, cards: ['luftbruecke', 'ueberraschung'] }];
  assert.ok(applyAction(st, { type: 'chooseDepesche', keep: 'a' }, me).error, 'Hand voll ohne Ablegen');
  const r2 = applyAction(st, { type: 'chooseDepesche', keep: 'a', discard: 0 }, me);
  assert.ifError(r2.error);
  assert.equal(r2.state.players.find((x) => x.id === me).depeschen.length, DEPESCHE_HAND_LIMIT);
  assert.equal(r2.state.players.find((x) => x.id === me).depeschen.includes('luftbruecke'), true);
});

test('playDepesche: Nachschub, Sabotage, Luftbrücke, nur 1 pro Zug, Phasenprüfung', () => {
  let s = createGame(players(3), seeded(202), { missions: true });
  const pid = currentPlayerId(s);
  const other = s.order.find((id) => id !== pid);
  for (const t of Object.keys(s.territories)) s.territories[t] = { owner: pid, troops: 2 };
  const enemy = Object.keys(s.territories)[0];
  s.territories[enemy] = { owner: other, troops: 5 };

  // Nachschub: +3 auf eigenes Gebiet
  let p = giveDepesche(s, pid, 'nachschub', 'reinforce');
  const target = Object.keys(s.territories).find((t) => s.territories[t].owner === pid);
  let r = applyAction(s, { type: 'playDepesche', index: 0, target }, pid);
  assert.ifError(r.error);
  assert.equal(r.state.territories[target].troops, 5);
  assert.equal(r.state.depeschePlayedThisTurn, true);
  // zweite Depesche im selben Zug abgelehnt
  const s2 = r.state; s2.players.find((x) => x.id === pid).depeschen = ['sabotage'];
  assert.match(applyAction(s2, { type: 'playDepesche', index: 0, target: enemy }, pid).error, /nur eine Depesche/);

  // Sabotage: -3 beim Gegner, nie unter 1
  let s3 = createGame(players(3), seeded(203), { missions: true });
  const a3 = currentPlayerId(s3); const o3 = s3.order.find((id) => id !== a3);
  for (const t of Object.keys(s3.territories)) s3.territories[t] = { owner: a3, troops: 2 };
  const foe = Object.keys(s3.territories)[0]; s3.territories[foe] = { owner: o3, troops: 2 };
  giveDepesche(s3, a3, 'sabotage', 'attack');
  r = applyAction(s3, { type: 'playDepesche', index: 0, target: foe }, a3);
  assert.ifError(r.error);
  assert.equal(r.state.territories[foe].troops, 1, 'min. 1');

  // Luftbrücke: ohne Verbindung verschieben
  let s4 = createGame(players(3), seeded(204), { missions: true });
  const a4 = currentPlayerId(s4);
  const ids = Object.keys(s4.territories);
  for (const t of ids) s4.territories[t] = { owner: a4, troops: 1 };
  const from = ids[0]; const to = ids[ids.length - 1]; // garantiert nicht benachbart genutzt
  s4.territories[from] = { owner: a4, troops: 6 };
  giveDepesche(s4, a4, 'luftbruecke', 'fortify');
  r = applyAction(s4, { type: 'playDepesche', index: 0, from, to, count: 4 }, a4);
  assert.ifError(r.error);
  assert.equal(r.state.territories[to].troops, 5);
  assert.equal(r.state.territories[from].troops, 2);

  // Phasenprüfung: Luftbrücke in reinforce nicht erlaubt
  let s5 = createGame(players(3), seeded(205), { missions: true });
  const a5 = currentPlayerId(s5);
  for (const t of Object.keys(s5.territories)) s5.territories[t] = { owner: a5, troops: 3 };
  giveDepesche(s5, a5, 'luftbruecke', 'reinforce');
  const two = Object.keys(s5.territories);
  assert.match(applyAction(s5, { type: 'playDepesche', index: 0, from: two[0], to: two[1], count: 1 }, a5).error, /Phase/);
});

test('playDepesche: Überraschungsangriff gewinnt den nächsten Gleichstand', () => {
  let s = createGame(players(3), seeded(206), { missions: true });
  const pid = currentPlayerId(s);
  const other = s.order.find((id) => id !== pid);
  const from = 'ontario'; const to = ADJACENCY['ontario'].find((n) => true);
  for (const t of Object.keys(s.territories)) s.territories[t] = { owner: pid, troops: 2 };
  s.territories[from] = { owner: pid, troops: 5 };
  s.territories[to] = { owner: other, troops: 2 };
  giveDepesche(s, pid, 'ueberraschung', 'attack');
  let r = applyAction(s, { type: 'playDepesche', index: 0 }, pid);
  assert.ifError(r.error);
  assert.equal(r.state.tieBreakAttacker, pid);
  // Gleichstand 3:3 → mit Überraschung verliert der Verteidiger
  r = applyAction(r.state, { type: 'attack', from, to, dice: 1 }, pid, diceSeq([3, 3]));
  assert.ifError(r.error);
  assert.equal(r.state.territories[to].troops, 1, 'Verteidiger verliert bei Gleichstand');
  assert.equal(r.state.tieBreakAttacker, null, 'Flag verbraucht');
});

test('viewFor: fremde Depeschen-Hand, Wahl und Stapelinhalt sind verborgen', () => {
  let s = createGame(players(3), seeded(207), { missions: true });
  const [p0, p1] = s.players;
  p0.depeschen = ['sabotage', 'nachschub'];
  p0.depeschenChoice = [{ level: 1, cards: ['gewaltmarsch', 'nachschub'] }];
  const v = viewFor(s, p1.id);
  const seen = v.players.find((x) => x.id === p0.id);
  assert.equal(seen.depeschen, undefined);
  assert.equal(seen.depeschenCount, 2);
  assert.equal(seen.depeschenChoice, undefined);
  assert.equal(v.depeschenDeck, undefined, 'Stapelinhalt verborgen');
  assert.ok(v.depeschenDeckCount[1] >= 0, 'nur Anzahl sichtbar');
  // eigene Sicht behält alles
  const own = viewFor(s, p0.id).players.find((x) => x.id === p0.id);
  assert.deepEqual(own.depeschen, ['sabotage', 'nachschub']);
});

// ------------------------------------------------------------------ Pranger (Schritt 5)

test('missionType: ordnet jede Mission ihrem öffentlichen Typ zu', () => {
  assert.equal(missionType({ id: 'k_na_af' }), 'kontinent');
  assert.equal(missionType({ id: 'g_weltmacht' }), 'gebiet');
  assert.equal(missionType({ id: 'g_bollwerk' }), 'gebiet');
  assert.equal(missionType({ id: 'f_feldherr' }), 'feldherr');
  assert.equal(missionType({ id: 'v_p2', target: 'p2' }), 'vernichtung');
  assert.equal(missionType(null), null);
});

test('abgefangen: stellt den Missionstyp eines Gegners öffentlich an den Pranger', () => {
  let s = createGame(players(3), seeded(300), { missions: true });
  const pid = currentPlayerId(s);
  const foe = s.order.find((id) => id !== pid);
  setMission(s, foe, { id: 'v_p2', target: 'p2' });
  giveDepesche(s, pid, 'abgefangen', 'reinforce');
  const r = applyAction(s, { type: 'playDepesche', index: 0, target: foe }, pid);
  assert.ifError(r.error);
  const tgt = r.state.players.find((x) => x.id === foe);
  assert.equal(tgt.pillory.type, 'vernichtung');
  assert.equal(tgt.pillory.turn, r.state.turn);
  // öffentlich: auch in fremder Sicht sichtbar, aber ohne die konkrete Mission
  const seen = viewFor(r.state, s.order.find((id) => id !== pid && id !== foe)).players.find((x) => x.id === foe);
  assert.equal(seen.pillory.type, 'vernichtung');
  assert.equal(seen.mission, undefined, 'konkrete Mission bleibt geheim');
  assert.ok(PILLORY_LABEL[seen.pillory.type]);
});

test('abgefangen: Fehlerfälle (sich selbst, ausgeschieden, schon am Pranger)', () => {
  let s = createGame(players(3), seeded(301), { missions: true });
  const pid = currentPlayerId(s);
  const foe = s.order.find((id) => id !== pid);
  setMission(s, foe, { id: 'g_weltmacht' });
  giveDepesche(s, pid, 'abgefangen', 'attack');
  assert.match(applyAction(s, { type: 'playDepesche', index: 0, target: pid }, pid).error, /Gegner/);
  // schon am Pranger
  s.players.find((x) => x.id === foe).pillory = { type: 'gebiet', turn: 1 };
  assert.match(applyAction(s, { type: 'playDepesche', index: 0, target: foe }, pid).error, /Pranger/);
  // ausgeschieden
  const foe2 = s.players.find((x) => x.id === foe);
  foe2.pillory = null; foe2.alive = false;
  assert.match(applyAction(s, { type: 'playDepesche', index: 0, target: foe }, pid).error, /ausgeschieden/);
});

test('abgefangen: Ausfallregel lässt einen vorhandenen Pranger-Typ unverändert', () => {
  let s = createGame(players(3), seeded(302), { missions: true });
  // Spieler mit Vernichtungsmission wird enttarnt (Typ: vernichtung) …
  const p = s.players[0];
  p.mission = { id: 'v_p3', target: 'p3' };
  p.pillory = { type: 'vernichtung', turn: 3 };
  // … dann greift die Ausfallregel und ändert die Mission auf Weltmacht.
  p.mission = { id: 'g_weltmacht' };
  // Der Pranger zeigt weiterhin den Typ zum Zeitpunkt des Aufdeckens.
  assert.equal(p.pillory.type, 'vernichtung');
});

test('abgefangen: ohne gültiges Pranger-Ziel wird beim Ziehen ersetzt', () => {
  let s = createGame(players(3), seeded(303), { missions: true });
  const pid = currentPlayerId(s);
  // Etappe-2-Belohnung (Stufe II) soll ausgelöst werden: Weltmacht mit 22 Gebieten (3 Spieler).
  setMission(s, pid, { id: 'g_weltmacht' });
  const others = s.order.filter((id) => id !== pid);
  const ids = Object.keys(s.territories);
  ids.forEach((t, i) => { s.territories[t] = { owner: i < 22 ? pid : others[i % others.length], troops: 1 }; });
  // Alle Gegner stehen schon am Pranger → kein gültiges Ziel für 'abgefangen'.
  for (const id of others) { const p = s.players.find((x) => x.id === id); p.mission = { id: 'g_weltmacht' }; p.pillory = { type: 'gebiet', turn: 1 }; }
  // Stufe-II-Stapel enthält 'abgefangen' und spielbare Karten – gezogen werden darf nie 'abgefangen'.
  s.depeschenDeck = { 1: [], 2: ['abgefangen', 'abgefangen', 'sabotage', 'sabotage', 'luftbruecke', 'luftbruecke'] };
  s.depeschenDiscard = { 1: [], 2: [] };
  s.phase = 'fortify'; s.current = s.order.indexOf(pid); s.pendingMove = null; s.conqueredThisTurn = false;
  const r = applyAction(s, { type: 'endTurn' }, pid, seeded(5));
  assert.ifError(r.error);
  const me = r.state.players.find((x) => x.id === pid);
  assert.equal(me.stagesDone[1], true, 'Etappe 2 erreicht');
  assert.equal(me.depeschenChoice.length, 1, 'Stufe-II-Wahl angelegt');
  for (const c of me.depeschenChoice[0].cards) assert.notEqual(c, 'abgefangen', 'kein Pranger ohne Ziel');
});

// ------------------------------------------------------------------ Simulation

function botAction(s, rng) {
  const pid = currentPlayerId(s);
  const own = Object.keys(s.territories).filter((id) => s.territories[id].owner === pid);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  // Missionswahl zuerst erledigen, wenn noch offen (unabhängig von der Phase)
  const self = s.players.find((p) => p.id === pid);
  if (s.missions && self.missionOptions && !self.mission) {
    return { type: 'chooseMission', id: pick(self.missionOptions).id };
  }
  // Offene Depeschen-Wahl auflösen (behalten, Hand ggf. erleichtern)
  if (self.depeschenChoice && self.depeschenChoice.length) {
    const full = (self.depeschen?.length || 0) >= DEPESCHE_HAND_LIMIT;
    return { type: 'chooseDepesche', keep: rng() < 0.85 ? 'a' : null, discard: full ? 0 : undefined };
  }
  // Gelegentlich eine spielbare Depesche ausspielen
  if (s.missions && !s.depeschePlayedThisTurn && !s.pendingMove && self.depeschen?.length && rng() < 0.4) {
    const hand = self.depeschen;
    for (let i = 0; i < hand.length; i++) {
      const card = DEPESCHE_CARDS[hand[i]];
      if (!card.phases.includes(s.phase)) continue;
      const id = hand[i];
      if (id === 'ueberraschung') return { type: 'playDepesche', index: i };
      if (id === 'nachschub') return { type: 'playDepesche', index: i, target: pick(own) };
      if (id === 'sabotage') {
        const foes = Object.keys(s.territories).filter((t) => s.territories[t].owner !== pid);
        if (foes.length) return { type: 'playDepesche', index: i, target: pick(foes) };
      }
      if (id === 'gewaltmarsch' || id === 'luftbruecke') {
        const srcs = own.filter((t) => s.territories[t].troops >= 2);
        if (srcs.length >= 2) {
          const from = pick(srcs);
          const tos = (id === 'gewaltmarsch' ? [...reachableOwn(s, from)] : own).filter((t) => t !== from);
          if (tos.length) return { type: 'playDepesche', index: i, from, to: pick(tos), count: 1 };
        }
      }
      if (id === 'abgefangen') {
        const foes = s.players.filter((p) => p.id !== pid && p.alive && !p.pillory);
        if (foes.length) return { type: 'playDepesche', index: i, target: pick(foes).id };
      }
    }
  }
  switch (s.phase) {
    case 'setup':
      return { type: 'place', territory: pick(own), count: 1 };
    case 'reinforce': {
      // Orden einlösen: Pflicht wenn keine Verstärkung mehr übrig (Zwang ab 5), sonst manchmal freiwillig
      const sets = ordenSets(s.players.find((p) => p.id === pid).orden);
      if (sets.length && (s.reinforcements === 0 || rng() < 0.3)) return { type: 'redeemOrden', set: sets[0] };
      const border = own.filter((id) => ADJACENCY[id].some((n) => s.territories[n].owner !== pid));
      return { type: 'place', territory: pick(border.length ? border : own), count: s.reinforcements };
    }
    case 'attack': {
      if (s.pendingMove) return { type: 'occupy', count: s.pendingMove.max };
      const options = [];
      for (const f of own) {
        for (const t of validAttackTargets(s, f)) {
          if (s.territories[f].troops > s.territories[t].troops) options.push([f, t]);
        }
      }
      if (!options.length || rng() < 0.05) return { type: 'endAttack' };
      const [f, t] = pick(options);
      return rng() < 0.5 ? { type: 'blitz', from: f, to: t } : { type: 'attack', from: f, to: t };
    }
    case 'fortify':
      return { type: 'endTurn' };
  }
  throw new Error(`unerwartete Phase ${s.phase}`);
}

function checkInvariants(s) {
  const ids = new Set(s.players.map((p) => p.id));
  for (const [tid, t] of Object.entries(s.territories)) {
    assert.ok(ids.has(t.owner), `ungültiger Besitzer in ${tid}`);
    const pendingTarget = s.pendingMove && s.pendingMove.to === tid;
    assert.ok(t.troops >= (pendingTarget ? 0 : 1), `zu wenige Truppen in ${tid}: ${t.troops}`);
  }
  for (const p of s.players) {
    assert.equal(p.alive, countTerritories(s, p.id) > 0, `alive-Flag falsch bei ${p.id}`);
  }
  assert.ok(s.reinforcements >= 0);
}

test('Simulation: 60 Zufallspartien mit 2–7 Bots verletzen keine Invarianten', () => {
  let finished = 0;
  for (let g = 0; g < 60; g++) {
    const rng = seeded(1000 + g);
    const n = 2 + (g % 6);
    let s = createGame(players(n), rng, { ordenMode: g % 2 ? 'dynamic' : 'static', missions: g % 3 !== 0 });
    for (let i = 0; i < 30000 && s.phase !== 'gameover'; i++) {
      const action = botAction(s, rng);
      const r = applyAction(s, action, currentPlayerId(s), rng);
      if (r.error) throw new Error(`Bot-Aktion abgelehnt (${JSON.stringify(action)}): ${r.error}`);
      s = r.state;
      checkInvariants(s);
    }
    if (s.phase === 'gameover') {
      finished++;
      // Sieg entweder durch Komplett-Eroberung oder durch erfülltes Missionsziel
      assert.ok(
        countTerritories(s, s.winner) === TERRITORIES.length || (s.missions && missionGoalMet(s, s.winner)),
        `Sieg ohne gültige Bedingung (Partie ${g})`,
      );
    }
  }
  assert.ok(finished > 0, 'keine einzige Partie wurde beendet');
  console.log(`  ${finished}/60 Simulationspartien bis zum Sieg gespielt`);
});
