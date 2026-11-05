// Reine Spiellogik – kein DOM, kein Netzwerk.
// Kern: applyAction(state, action, actorId, rng) -> { state } | { error }
// Der Zustand wird nie verändert, sondern immer eine Kopie zurückgegeben.
// Läuft identisch im Browser (Host / Hot-Seat) und in Node (Tests).

import {
  TERRITORIES,
  TERRITORY_BY_ID,
  CONTINENTS,
  CONTINENT_TERRITORIES,
  ADJACENCY,
} from './map.js';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 7;
// Okabe-Ito-Palette: auch bei Rot-Grün-Schwäche gut unterscheidbar
export const PLAYER_COLORS = ['#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7'];
// Start-Truppen je Spielerzahl (inkl. der 1 Truppe pro zugeteiltem Gebiet)
export const START_ARMIES = { 2: 30, 3: 26, 4: 22, 5: 19, 6: 17, 7: 15 };
// In der Aufstellung setzt jeder reihum bis zu so viele Truppen pro Durchgang
export const SETUP_BATCH = 3;

const LOG_LIMIT = 150;
const BLITZ_MAX_ROUNDS = 500;

// ---------------------------------------------------------------- Helfer

export const currentPlayerId = (s) => s.order[s.current];
export const playerById = (s, id) => s.players.find((p) => p.id === id);
export const playerName = (s, id) => playerById(s, id)?.name ?? '?';
export const territoryName = (id) => TERRITORY_BY_ID[id]?.name ?? id;
export const isAdjacent = (a, b) => ADJACENCY[a]?.includes(b) ?? false;

export function countTerritories(s, pid) {
  let n = 0;
  for (const t of Object.values(s.territories)) if (t.owner === pid) n++;
  return n;
}

export function countTroops(s, pid) {
  let n = 0;
  for (const t of Object.values(s.territories)) if (t.owner === pid) n += t.troops;
  return n;
}

export function calcReinforcements(s, pid) {
  const territories = countTerritories(s, pid);
  const base = Math.max(3, Math.floor(territories / 3));
  const bonuses = [];
  for (const [cid, list] of Object.entries(CONTINENT_TERRITORIES)) {
    if (list.every((tid) => s.territories[tid].owner === pid)) {
      bonuses.push({ continent: cid, name: CONTINENTS[cid].name, bonus: CONTINENTS[cid].bonus });
    }
  }
  return { territories, base, bonuses, total: base + bonuses.reduce((sum, b) => sum + b.bonus, 0) };
}

/** Feindliche Nachbarn, die von `from` aus angegriffen werden können. */
export function validAttackTargets(s, from) {
  const out = new Set();
  const f = s.territories[from];
  if (!f || f.troops < 2) return out;
  for (const n of ADJACENCY[from]) if (s.territories[n].owner !== f.owner) out.add(n);
  return out;
}

/** Eigene Gebiete, die über eine Kette eigener Gebiete erreichbar sind (ohne `from`). */
export function reachableOwn(s, from) {
  const owner = s.territories[from]?.owner;
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const n of ADJACENCY[cur]) {
      if (!seen.has(n) && s.territories[n].owner === owner) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  seen.delete(from);
  return seen;
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const rollDie = (rng) => 1 + Math.floor(rng() * 6);

const toInt = (v) =>
  (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isInteger(Number(v))
    ? Number(v)
    : NaN;

function addLog(s, text) {
  s.log.push({ turn: s.turn, text });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

function moveTroops(from, to, n) {
  from.troops -= n;
  to.troops += n;
}

// ---------------------------------------------------------------- Spielstart

/**
 * @param {{id:string, name:string}[]} players
 * @param {() => number} rng Zufallsfunktion [0,1) – in Tests deterministisch
 */
export function createGame(players, rng = Math.random) {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`Es werden ${MIN_PLAYERS} bis ${MAX_PLAYERS} Spieler benötigt.`);
  }
  const order = shuffle(players.map((p) => p.id), rng);
  const territories = {};
  shuffle(TERRITORIES.map((t) => t.id), rng).forEach((tid, i) => {
    territories[tid] = { owner: order[i % order.length], troops: 1 };
  });

  const state = {
    players: players.map((p, i) => ({ id: p.id, name: p.name, color: PLAYER_COLORS[i], alive: true })),
    order,
    territories,
    phase: 'setup', // setup | reinforce | attack | fortify | gameover
    current: 0, // Index in `order`
    turn: 1,
    setupRemaining: {},
    setupPlacedThisTurn: 0,
    reinforcements: 0,
    pendingMove: null, // nach Eroberung: { from, to, min, max }
    conqueredThisTurn: false, // vorbereitet für Karten (später)
    lastCombat: null,
    winner: null,
    log: [],
  };
  const start = START_ARMIES[players.length];
  for (const pid of order) state.setupRemaining[pid] = Math.max(0, start - countTerritories(state, pid));

  addLog(state, `Spiel gestartet. Reihenfolge: ${order.map((id) => playerName(state, id)).join(', ')}.`);
  addLog(state, `Aufstellung: Jeder setzt reihum bis zu ${SETUP_BATCH} Truppen.`);
  if (state.setupRemaining[order[0]] === 0) advanceSetup(state);
  return state;
}

// ---------------------------------------------------------------- Ablauf

function advanceSetup(s) {
  s.setupPlacedThisTurn = 0;
  const n = s.order.length;
  for (let step = 1; step <= n; step++) {
    const idx = (s.current + step) % n;
    if (s.setupRemaining[s.order[idx]] > 0) {
      s.current = idx;
      return;
    }
  }
  addLog(s, 'Aufstellung abgeschlossen – los geht’s!');
  s.current = 0;
  startTurn(s);
}

function startTurn(s) {
  const pid = currentPlayerId(s);
  const r = calcReinforcements(s, pid);
  s.phase = 'reinforce';
  s.reinforcements = r.total;
  s.conqueredThisTurn = false;
  s.pendingMove = null;
  const bonusText = r.bonuses.length
    ? ` (inkl. Bonus: ${r.bonuses.map((b) => `${b.name} +${b.bonus}`).join(', ')})`
    : '';
  addLog(s, `Zug ${s.turn}: ${playerName(s, pid)} ist am Zug und erhält ${r.total} Truppen${bonusText}.`);
}

function finishTurn(s) {
  s.pendingMove = null;
  const n = s.order.length;
  for (let step = 1; step <= n; step++) {
    const idx = (s.current + step) % n;
    if (playerById(s, s.order[idx]).alive) {
      s.current = idx;
      break;
    }
  }
  s.turn++;
  startTurn(s);
}

function forceSkip(s) {
  const pid = currentPlayerId(s);
  addLog(s, `${playerName(s, pid)} wurde vom Host übersprungen.`);
  if (s.phase === 'setup') {
    advanceSetup(s);
    return;
  }
  if (s.pendingMove) {
    const pm = s.pendingMove;
    moveTroops(s.territories[pm.from], s.territories[pm.to], pm.min);
  }
  finishTurn(s);
}

// ---------------------------------------------------------------- Kampf

function checkAttack(s, fromId, toId, pid) {
  if (s.phase !== 'attack') return 'Angreifen ist gerade nicht möglich.';
  if (s.pendingMove) return 'Lege zuerst fest, wie viele Truppen nachrücken.';
  const from = s.territories[fromId];
  const to = s.territories[toId];
  if (!from || !to) return 'Unbekanntes Gebiet.';
  if (from.owner !== pid) return 'Du kannst nur aus eigenen Gebieten angreifen.';
  if (to.owner === pid) return 'Du kannst kein eigenes Gebiet angreifen.';
  if (!isAdjacent(fromId, toId)) return 'Die Gebiete grenzen nicht aneinander.';
  if (from.troops < 2) return 'Zum Angreifen braucht ein Gebiet mindestens 2 Truppen.';
  return null;
}

function battleRound(s, fromId, toId, attDice, rng) {
  const from = s.territories[fromId];
  const to = s.territories[toId];
  const defDice = Math.min(2, to.troops);
  const att = Array.from({ length: attDice }, () => rollDie(rng)).sort((a, b) => b - a);
  const def = Array.from({ length: defDice }, () => rollDie(rng)).sort((a, b) => b - a);
  let attLoss = 0;
  let defLoss = 0;
  for (let i = 0; i < Math.min(att.length, def.length); i++) {
    if (att[i] > def[i]) defLoss++;
    else attLoss++; // Gleichstand gewinnt der Verteidiger
  }
  from.troops -= attLoss;
  to.troops -= defLoss;
  return { att, def, attLoss, defLoss };
}

function conquer(s, fromId, toId, dice, pid) {
  const from = s.territories[fromId];
  const to = s.territories[toId];
  const prevOwner = to.owner;
  to.owner = pid;
  to.troops = 0;
  s.conqueredThisTurn = true;
  if (s.lastCombat) s.lastCombat.conquered = true;
  addLog(s, `${playerName(s, pid)} erobert ${territoryName(toId)}!`);

  if (countTerritories(s, prevOwner) === 0) {
    const p = playerById(s, prevOwner);
    p.alive = false;
    addLog(s, `${p.name} wurde ausgeschaltet.`);
  }

  const max = from.troops - 1;
  const min = Math.min(dice, max);

  if (countTerritories(s, pid) === TERRITORIES.length) {
    moveTroops(from, to, max);
    s.winner = pid;
    s.phase = 'gameover';
    s.pendingMove = null;
    addLog(s, `🏆 ${playerName(s, pid)} hat die Welt erobert!`);
    return;
  }

  if (min === max) moveTroops(from, to, min);
  else s.pendingMove = { from: fromId, to: toId, min, max };
}

// ---------------------------------------------------------------- Aktionen

const HANDLERS = {
  place(s, a, pid) {
    if (s.phase !== 'setup' && s.phase !== 'reinforce') return 'Truppen setzen ist gerade nicht möglich.';
    const t = s.territories[a.territory];
    if (!t) return 'Unbekanntes Gebiet.';
    if (t.owner !== pid) return 'Du kannst nur auf eigene Gebiete setzen.';
    const count = toInt(a.count);
    if (!(count >= 1)) return 'Ungültige Anzahl.';

    if (s.phase === 'setup') {
      const allowed = Math.min(SETUP_BATCH - s.setupPlacedThisTurn, s.setupRemaining[pid]);
      if (count > allowed) return `Du kannst gerade höchstens ${allowed} Truppe(n) setzen.`;
      t.troops += count;
      s.setupRemaining[pid] -= count;
      s.setupPlacedThisTurn += count;
      if (s.setupPlacedThisTurn >= SETUP_BATCH || s.setupRemaining[pid] === 0) advanceSetup(s);
      return null;
    }

    if (count > s.reinforcements) return `Du hast nur noch ${s.reinforcements} Truppe(n).`;
    t.troops += count;
    s.reinforcements -= count;
    addLog(s, `${playerName(s, pid)} setzt ${count} Truppe(n) nach ${territoryName(a.territory)}.`);
    if (s.reinforcements === 0) s.phase = 'attack';
    return null;
  },

  attack(s, a, pid, rng) {
    const err = checkAttack(s, a.from, a.to, pid);
    if (err) return err;
    const from = s.territories[a.from];
    const maxDice = Math.min(3, from.troops - 1);
    const dice = a.dice == null ? maxDice : toInt(a.dice);
    if (!(dice >= 1 && dice <= maxDice)) {
      return `Mit ${from.troops} Truppen kannst du mit 1 bis ${maxDice} Würfel(n) angreifen.`;
    }
    const defender = s.territories[a.to].owner;
    const r = battleRound(s, a.from, a.to, dice, rng);
    s.lastCombat = {
      attacker: pid, defender, from: a.from, to: a.to, rounds: 1,
      att: r.att, def: r.def, attLoss: r.attLoss, defLoss: r.defLoss, conquered: false,
    };
    addLog(
      s,
      `${playerName(s, pid)} greift ${territoryName(a.to)} (${playerName(s, defender)}) an: ` +
        `[${r.att.join(' ')}] gegen [${r.def.join(' ')}] – Verluste ${r.attLoss}:${r.defLoss}.`,
    );
    if (s.territories[a.to].troops === 0) conquer(s, a.from, a.to, dice, pid);
    return null;
  },

  blitz(s, a, pid, rng) {
    const err = checkAttack(s, a.from, a.to, pid);
    if (err) return err;
    const from = s.territories[a.from];
    const to = s.territories[a.to];
    const defender = to.owner;
    let rounds = 0;
    let attLoss = 0;
    let defLoss = 0;
    let last = null;
    let dice = 0;
    while (to.troops > 0 && from.troops >= 2 && rounds < BLITZ_MAX_ROUNDS) {
      dice = Math.min(3, from.troops - 1);
      last = battleRound(s, a.from, a.to, dice, rng);
      rounds++;
      attLoss += last.attLoss;
      defLoss += last.defLoss;
    }
    s.lastCombat = {
      attacker: pid, defender, from: a.from, to: a.to, rounds,
      att: last.att, def: last.def, attLoss, defLoss, conquered: false,
    };
    addLog(
      s,
      `${playerName(s, pid)} startet einen Blitz-Angriff von ${territoryName(a.from)} auf ` +
        `${territoryName(a.to)} (${playerName(s, defender)}): ${rounds} Runde(n), Verluste ${attLoss}:${defLoss}.`,
    );
    if (to.troops === 0) conquer(s, a.from, a.to, dice, pid);
    return null;
  },

  occupy(s, a) {
    if (s.phase !== 'attack' || !s.pendingMove) return 'Es gibt gerade nichts nachzurücken.';
    const pm = s.pendingMove;
    const count = toInt(a.count);
    if (!(count >= pm.min && count <= pm.max)) return `Wähle zwischen ${pm.min} und ${pm.max} Truppen.`;
    moveTroops(s.territories[pm.from], s.territories[pm.to], count);
    s.pendingMove = null;
    return null;
  },

  endAttack(s) {
    if (s.phase !== 'attack') return 'Du bist nicht in der Angriffsphase.';
    if (s.pendingMove) return 'Lege zuerst fest, wie viele Truppen nachrücken.';
    s.phase = 'fortify';
    return null;
  },

  fortify(s, a, pid) {
    if (s.phase !== 'fortify') return 'Verschieben ist gerade nicht möglich.';
    const from = s.territories[a.from];
    const to = s.territories[a.to];
    if (!from || !to) return 'Unbekanntes Gebiet.';
    if (from.owner !== pid || to.owner !== pid) return 'Beide Gebiete müssen dir gehören.';
    if (a.from === a.to) return 'Start und Ziel müssen verschieden sein.';
    if (!reachableOwn(s, a.from).has(a.to)) return 'Die Gebiete sind nicht über eigene Gebiete verbunden.';
    const count = toInt(a.count);
    if (!(count >= 1 && count <= from.troops - 1)) return `Du kannst 1 bis ${from.troops - 1} Truppe(n) verschieben.`;
    moveTroops(from, to, count);
    addLog(s, `${playerName(s, pid)} verschiebt ${count} Truppe(n) von ${territoryName(a.from)} nach ${territoryName(a.to)}.`);
    finishTurn(s);
    return null;
  },

  endTurn(s) {
    if (s.phase === 'attack') {
      if (s.pendingMove) return 'Lege zuerst fest, wie viele Truppen nachrücken.';
    } else if (s.phase !== 'fortify') {
      return 'Du kannst deinen Zug jetzt noch nicht beenden.';
    }
    finishTurn(s);
    return null;
  },
};

/**
 * Wendet eine Aktion an.
 * Achtung: 'forceSkip' wird hier NICHT auf Berechtigung geprüft –
 * das macht der Host (nur er darf Spieler überspringen).
 */
export function applyAction(prev, action, actorId, rng = Math.random) {
  if (!action || typeof action.type !== 'string') return { error: 'Ungültige Aktion.' };
  if (prev.phase === 'gameover') return { error: 'Das Spiel ist beendet.' };
  const s = structuredClone(prev);

  if (action.type === 'forceSkip') {
    forceSkip(s);
    return { state: s };
  }
  if (actorId !== currentPlayerId(s)) return { error: 'Du bist nicht am Zug.' };
  const handler = Object.hasOwn(HANDLERS, action.type) ? HANDLERS[action.type] : null;
  if (!handler) return { error: `Unbekannte Aktion: ${action.type}` };
  const error = handler(s, action, actorId, rng);
  return error ? { error } : { state: s };
}
