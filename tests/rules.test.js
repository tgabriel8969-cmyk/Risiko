// Ausführen mit: npm test   (bzw. node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TERRITORIES, ADJACENCY, EDGES, CONTINENTS, TERRITORY_BY_ID } from '../js/map.js';
import {
  createGame, applyAction, currentPlayerId, countTerritories, calcReinforcements,
  validAttackTargets, START_ARMIES, SETUP_BATCH, MAX_PLAYERS,
  ordenSets, ordenReward, ORDEN_STATIC_BONUS, ORDEN_FORCE_AT, viewFor,
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

// ------------------------------------------------------------------ Simulation

function botAction(s, rng) {
  const pid = currentPlayerId(s);
  const own = Object.keys(s.territories).filter((id) => s.territories[id].owner === pid);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
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
    let s = createGame(players(2 + (g % 6)), rng, { ordenMode: g % 2 ? 'dynamic' : 'static' });
    for (let i = 0; i < 30000 && s.phase !== 'gameover'; i++) {
      const action = botAction(s, rng);
      const r = applyAction(s, action, currentPlayerId(s), rng);
      if (r.error) throw new Error(`Bot-Aktion abgelehnt (${JSON.stringify(action)}): ${r.error}`);
      s = r.state;
      checkInvariants(s);
    }
    if (s.phase === 'gameover') {
      finished++;
      assert.equal(countTerritories(s, s.winner), TERRITORIES.length);
    }
  }
  assert.ok(finished > 0, 'keine einzige Partie wurde beendet');
  console.log(`  ${finished}/60 Simulationspartien bis zum Sieg gespielt`);
});
