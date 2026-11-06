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
// In der ersten Runde (jeder 1. Zug) höchstens so viele Angriffsaktionen – bremst den
// Eröffnungs-Schneeball und verhindert, dass wehrlose Spieler sofort ausscheiden.
export const FIRST_ROUND_ATTACK_LIMIT = 3;

// Orden: Belohnung fürs Erobern (statt Spielkarten). 3 Typen; ein Satz = 3 gleiche
// oder 3 verschiedene. Bei >= ORDEN_FORCE_AT Orden muss zu Zugbeginn eingelöst werden.
export const ORDEN_TYPES = ['kreuz', 'krone', 'medaille'];
export const ORDEN_LABEL = { kreuz: 'Eisernes Kreuz', krone: 'Kaiserorden', medaille: 'Verdienstmedaille' };
export const ORDEN_STATIC_BONUS = 5;
export const ORDEN_DYNAMIC = [4, 6, 8, 10, 12, 15]; // danach +5 je weiterem eingelösten Satz
export const ORDEN_FORCE_AT = 5;

/** Einheiten-Bonus für den nächsten eingelösten Satz (abhängig vom Modus). */
export function ordenReward(state) {
  if (state.ordenMode !== 'dynamic') return ORDEN_STATIC_BONUS;
  const n = state.setsRedeemed || 0;
  return n < ORDEN_DYNAMIC.length ? ORDEN_DYNAMIC[n] : ORDEN_DYNAMIC[ORDEN_DYNAMIC.length - 1] + (n - ORDEN_DYNAMIC.length + 1) * 5;
}

/** Alle einlösbaren Sätze einer Hand (3 gleiche oder 3 verschiedene). */
export function ordenSets(orden = []) {
  const count = {};
  for (const t of orden) count[t] = (count[t] || 0) + 1;
  const sets = [];
  for (const t of ORDEN_TYPES) if ((count[t] || 0) >= 3) sets.push([t, t, t]);
  if (ORDEN_TYPES.every((t) => (count[t] || 0) >= 1)) sets.push([...ORDEN_TYPES]);
  return sets;
}

/**
 * Gefilterte Sicht des Zustands für einen bestimmten Spieler (rein, mutiert nicht).
 * Entfernt bzw. reduziert Geheiminformationen fremder Spieler (§7 der Missions-Spec),
 * sodass sie auch in den Browser-DevTools nicht lesbar sind. Für Felder, die erst in
 * späteren Schritten entstehen (mission, depeschen, stats, …), wird hier schon gefiltert.
 */
/**
 * Gebiete, deren Truppenzahl `pid` sehen darf (§7). Ohne Nebel: alle. Mit Nebel: eigene
 * Gebiete + angrenzende; „Aufklärung" deckt den ganzen Zug alles auf, „Späher" ein entferntes
 * Gebiet samt Nachbarn; fremde „Tarnung" blendet gegnerische Gebiete trotz Angrenzung aus.
 */
export function visibleTerritories(s, pid) {
  const all = Object.keys(s.territories);
  if (!s.fog) return new Set(all);
  const p = playerById(s, pid);
  if (p?.aufklaerungTurn === s.turn) return new Set(all); // Nebel diesen Zug ganz weg
  const vis = new Set();
  for (const t of all) {
    if (s.territories[t].owner === pid) { // eigenes Gebiet + alle Nachbarn
      vis.add(t);
      for (const n of ADJACENCY[t]) vis.add(n);
    }
  }
  // Fremde Tarnung: deren getarnte Gebiete wieder verdecken (eigene bleiben sichtbar)
  for (const other of s.players) {
    if (other.id === pid || !other.tarnung || s.turn >= other.tarnung.until) continue;
    for (const t of other.tarnung.tiles) if (s.territories[t]?.owner !== pid) vis.delete(t);
  }
  // Späher deckt ein entferntes Gebiet samt Nachbarn auf (schlägt Tarnung)
  if (p?.spaeher && s.turn <= p.spaeher.until) {
    vis.add(p.spaeher.center);
    for (const n of ADJACENCY[p.spaeher.center] || []) vis.add(n);
  }
  return vis;
}

export function viewFor(state, playerId) {
  if (!state) return state;
  const v = structuredClone(state);
  // Private Log-Einträge nur für die berechtigten Spieler behalten
  v.log = (v.log || []).filter((e) => !e.visibleTo || e.visibleTo.includes(playerId));
  // Stapelinhalte/-reihenfolge sind geheim – nur Anzahlen zeigen
  if (v.depeschenDeck) v.depeschenDeckCount = { 1: v.depeschenDeck[1].length, 2: v.depeschenDeck[2].length };
  if (v.depeschenDiscard) v.depeschenDiscardCount = { 1: v.depeschenDiscard[1].length, 2: v.depeschenDiscard[2].length };
  delete v.depeschenDeck;
  delete v.depeschenDiscard;
  // Nebel: fremde Truppenzahlen (und Generäle) außerhalb der eigenen Sicht ausblenden –
  // vor dem Entfernen der Tarnungs-Felder, da diese die Sicht mitbestimmen.
  if (v.fog) {
    const vis = visibleTerritories(v, playerId);
    for (const [tid, t] of Object.entries(v.territories)) {
      if (!vis.has(tid)) { t.troops = null; t.fog = true; } // null = verborgen, auch in DevTools
    }
    for (const p of v.players || []) {
      if (p.id !== playerId && p.general && !vis.has(p.general)) p.general = null; // nur für diese Sicht
    }
  }
  for (const p of v.players || []) {
    if (p.id === playerId) continue; // eigene Infos bleiben vollständig
    delete p.spaeher; delete p.tarnung; delete p.aufklaerungTurn; // Nebel-Effekte sind geheim
    if (v.phase === 'gameover' && p.id === v.winner) continue; // Sieger-Mission wird aufgedeckt
    delete p.mission; // sichtbar bleiben nur p.stagesDone und p.pillory (öffentlich)
    delete p.missionOptions; // zur Wahl stehende Missionen sind geheim
    delete p.stats;
    delete p.depeschenChoice;
    if (Array.isArray(p.depeschen)) {
      p.depeschenCount = p.depeschen.length;
      delete p.depeschen;
    }
  }
  return v;
}

// ---------------------------------------------------------------- Depeschen
export const DEPESCHE_HAND_LIMIT = 3;
export const DEPESCHE_COPIES = 2;
// Nur Karten ohne 🔗-Abhängigkeit (General/Nebel). Weitere Karten kommen in
// späteren Schritten dazu und werden dann hier ergänzt.
export const DEPESCHE_CARDS = {
  // Stufe I – Taktik
  gewaltmarsch: { level: 1, name: 'Gewaltmarsch', phases: ['attack', 'fortify'], info: 'Einmal zusätzlich über eigene Gebiete verschieben, ohne den Zug zu beenden.' },
  nachschub: { level: 1, name: 'Nachschub', phases: ['reinforce', 'attack', 'fortify'], info: '+3 Truppen auf ein beliebiges eigenes Gebiet.' },
  // Nur mit Nebel im Stapel (§9)
  aufklaerung: { level: 1, needsFog: true, phases: ['reinforce', 'attack', 'fortify'], name: 'Aufklärung', info: 'Hebt den Nebel für den Rest deines Zugs komplett auf.' },
  spaeher: { level: 1, needsFog: true, phases: ['reinforce', 'attack', 'fortify'], name: 'Späher', info: 'Ein beliebiges Gebiet samt Nachbarn bis Ende deines nächsten Zugs sichtbar.' },
  tarnung: { level: 1, needsFog: true, phases: ['reinforce', 'attack', 'fortify'], name: 'Tarnung', info: '3 eigene Gebiete zeigen Gegnern bis zu deinem nächsten Zug „?" statt der Truppenzahl.' },
  // Stufe II – stark
  luftbruecke: { level: 2, name: 'Luftbrücke', phases: ['attack', 'fortify'], info: 'Truppen zwischen zwei beliebigen eigenen Gebieten verschieben – ohne Verbindung.' },
  sabotage: { level: 2, name: 'Sabotage', phases: ['reinforce', 'attack', 'fortify'], info: 'Ein gegnerisches Gebiet verliert 3 Truppen (nie unter 1).' },
  ueberraschung: { level: 2, name: 'Überraschungsangriff', phases: ['attack'], info: 'Bei deiner nächsten Angriffsaktion gewinnt der Angreifer bei Gleichstand.' },
  abgefangen: { level: 2, name: 'Abgefangene Depesche', phases: ['reinforce', 'attack', 'fortify'], info: 'Stellt den Missionstyp eines Gegners für alle sichtbar an den Pranger.' },
  // Nur mit General-System im Stapel (§9)
  marschbefehl: { level: 2, needsGeneral: true, phases: ['reinforce', 'attack', 'fortify'], name: 'Marschbefehl', info: 'Versetze deinen General in ein beliebiges eigenes Gebiet – oder belebe ihn dort wieder.' },
};
export const depescheName = (id) => DEPESCHE_CARDS[id]?.name ?? id;

function buildDepescheDecks(rng, general, fog) {
  const deck = { 1: [], 2: [] };
  for (const [id, c] of Object.entries(DEPESCHE_CARDS)) {
    if (c.needsGeneral && !general) continue; // Karten ohne nutzbares System weglassen (§9)
    if (c.needsFog && !fog) continue;
    for (let i = 0; i < DEPESCHE_COPIES; i++) deck[c.level].push(id);
  }
  return { 1: shuffle(deck[1], rng), 2: shuffle(deck[2], rng) };
}

// Eine Karte der Stufe `level` ziehen; leerer Nachziehstapel -> Ablage neu mischen.
function drawDepesche(s, level, rng) {
  const deck = s.depeschenDeck[level];
  if (!deck.length) {
    const disc = s.depeschenDiscard[level];
    if (!disc.length) return null;
    s.depeschenDeck[level] = shuffle(disc, rng);
    s.depeschenDiscard[level] = [];
  }
  return s.depeschenDeck[level].pop() ?? null;
}

// Lebende Gegner von `pid`, die noch nicht am Pranger stehen (§6.4, Pranger-Ziele).
function pilloryTargets(s, pid) {
  return s.players.filter((p) => p.id !== pid && p.alive && p.mission && !p.pillory).map((p) => p.id);
}

// Wie drawDepesche, aber „Abgefangene Depesche" ohne gültiges Pranger-Ziel wird
// durch eine andere Stufe-II-Karte ersetzt (§6.4). Nicht nutzbare Karten kommen
// zurück auf die Ablage, damit sie später (mit gültigem Ziel) wieder ziehbar sind.
function drawDepescheFor(s, pid, level, rng) {
  const setAside = [];
  let card = null;
  for (let i = 0; i < 20; i++) {
    card = drawDepesche(s, level, rng);
    if (card === 'abgefangen' && !pilloryTargets(s, pid).length) { setAside.push(card); card = null; continue; }
    break;
  }
  for (const c of setAside) s.depeschenDiscard[level].push(c);
  return card;
}

// Belohnungswahl auslösen: bis zu `count` *unterschiedliche* Karten ziehen (Standard 3;
// weniger nur, wenn die Stufe nicht genug verschiedene Typen hergibt), in die Warteschlange legen.
function grantDepescheChoice(s, pid, level, rng, count = 3) {
  const cards = [];
  const setAside = [];
  let guard = 0;
  while (cards.length < count && guard++ < 50) {
    const c = drawDepescheFor(s, pid, level, rng);
    if (!c) break; // Stapel und Ablage erschöpft
    if (cards.includes(c)) { setAside.push(c); continue; } // schon dabei -> zurück auf die Ablage
    cards.push(c);
  }
  for (const c of setAside) s.depeschenDiscard[level].push(c);
  if (!cards.length) return;
  const p = playerById(s, pid);
  (p.depeschenChoice ||= []).push({ level, cards });
}

// ---------------------------------------------------------------- Missionen
export const MISSION_MIN_PLAYERS = 3;
export const MISSION_STAGE_BONUS = 2;
export const MISSION_TARGETS = {
  g_weltmacht: { stage1Conquests: 3, stage2: { 3: 22, default: 18 }, goal: { 3: 28, default: 24 } },
  // Bastion = Machtkonzentration: starke Truppen-Festungen statt Fläche.
  g_bastion: { stage1Troops: { 3: 10, default: 8 }, stage2Count: 3, stage2Troops: { 3: 8, default: 6 }, goalTroops: { 3: 24, default: 18 } },
  vernichtung: { stage1From: 2, stage2MaxTerritories: 4 },
  kontinent: { stage1Conquests: 2 },
  feldherr: { stage1GeneralConquests: 3, stage2Continents: 2, goalContinents: 3 },
};

const KONTINENT_MISSIONS = {
  k_na_af: ['nordamerika', 'afrika'],
  k_na_oz: ['nordamerika', 'ozeanien'],
  k_as_sa: ['asien', 'suedamerika'],
  k_as_af: ['asien', 'afrika'],
  k_eu_sa_x: ['europa', 'suedamerika'], // + 1 beliebiger weiterer
  k_eu_oz_x: ['europa', 'ozeanien'],
};
const KONTINENT_EXTRA = new Set(['k_eu_sa_x', 'k_eu_oz_x']);

const scaled = (obj, n) => (n === 3 ? obj[3] : obj.default);
const continentComplete = (s, pid, cid) => CONTINENT_TERRITORIES[cid].every((tid) => s.territories[tid].owner === pid);
const completedContinents = (s, pid) => Object.keys(CONTINENTS).filter((cid) => continentComplete(s, pid, cid));
function countTerritoriesWithTroops(s, pid, min) {
  let n = 0;
  for (const t of Object.values(s.territories)) if (t.owner === pid && t.troops >= min) n++;
  return n;
}

/** Baut den Missions-Pool (§4). `general` zieht die Feldherr-Mission mit hinein. */
export function buildMissionPool(playerIds, options = {}) {
  return [
    ...Object.keys(KONTINENT_MISSIONS).map((id) => ({ id })),
    { id: 'g_weltmacht' },
    { id: 'g_bastion' },
    ...(options.general ? [{ id: 'f_feldherr' }] : []),
    ...playerIds.map((pid) => ({ id: `v_${pid}`, target: pid })),
  ];
}

// Jeder bekommt zur Spielwahl 2 Missionen (verdeckt, ohne Zurücklegen); nie die
// eigene Vernichtungs-Mission. Mathematisch bleiben bei ≤7 Spielern stets ≥2
// zulässige Karten übrig, da jeder höchstens eine unzulässige Karte (v_self) hat.
function assignMissionChoices(playerIds, rng, options) {
  const pool = shuffle(buildMissionPool(playerIds, options), rng);
  const out = {};
  for (const pid of playerIds) {
    const picked = [];
    for (let k = 0; k < pool.length && picked.length < 2; k++) {
      if (pool[k].target === pid) continue;
      picked.push(pool.splice(k, 1)[0]);
      k--;
    }
    out[pid] = picked;
  }
  return out;
}

/** Eine zur Wahl stehende Mission annehmen (unabhängig vom Zug, §6.2-Stil). */
function chooseMission(s, pid, id) {
  if (!s.missions) return 'Missionen sind in dieser Partie nicht aktiv.';
  const p = playerById(s, pid);
  if (!p) return 'Unbekannter Spieler.';
  if (p.mission) return 'Du hast deine Mission bereits gewählt.';
  const chosen = (p.missionOptions || []).find((m) => m.id === id);
  if (!chosen) return 'Diese Mission steht dir nicht zur Wahl.';
  p.mission = chosen;
  p.missionOptions = null;
  addLog(s, `Du hast deine Mission gewählt: ${missionName(chosen, s)}.`, [pid]);
  return null;
}

export function missionName(mission, state) {
  if (!mission) return '';
  const id = mission.id;
  if (id in KONTINENT_MISSIONS) {
    return `Kontinente: ${KONTINENT_MISSIONS[id].map((c) => CONTINENTS[c].name).join(' + ')}${KONTINENT_EXTRA.has(id) ? ' + 1 weiterer' : ''}`;
  }
  if (id === 'g_weltmacht') return 'Weltmacht';
  if (id === 'g_bastion') return 'Bastion';
  if (mission.target) return `Vernichtung: ${state ? playerName(state, mission.target) : mission.target}`;
  if (id === 'f_feldherr') return 'Feldherr';
  return id;
}

// Öffentlicher Missionstyp (für den Pranger, §6.4). Verrät nicht das konkrete Ziel.
export const PILLORY_LABEL = { kontinent: 'Kontinent', gebiet: 'Gebiet', vernichtung: 'Vernichtung', feldherr: 'Feldherr' };
export function missionType(mission) {
  if (!mission) return null;
  const id = mission.id;
  if (id in KONTINENT_MISSIONS) return 'kontinent';
  if (id === 'g_weltmacht' || id === 'g_bastion') return 'gebiet';
  if (id === 'f_feldherr') return 'feldherr';
  if (mission.target || id.startsWith('v_')) return 'vernichtung';
  return null;
}

/** Strukturierte Ziel-Hinweise einer Mission – für Heuristik/Bots (rein, kein DOM). */
export function missionTargets(mission) {
  if (!mission) return { continents: [], targetPlayer: null, wantTerritories: true };
  const id = mission.id;
  if (id in KONTINENT_MISSIONS) return { continents: KONTINENT_MISSIONS[id].slice(), targetPlayer: null, wantTerritories: false };
  if (mission.target) return { continents: [], targetPlayer: mission.target, wantTerritories: false };
  // Weltmacht, Bastion, Feldherr: einfach expandieren bzw. Kontinente halten
  return { continents: [], targetPlayer: null, wantTerritories: true };
}

/** Ist das Endziel einer Mission aktuell erfüllt? (rein; mission default = die zugeteilte) */
export function missionGoalMet(s, pid, mission = playerById(s, pid)?.mission) {
  if (!mission) return false;
  const id = mission.id;
  const n = s.order.length;
  if (id in KONTINENT_MISSIONS) {
    const fixed = KONTINENT_MISSIONS[id];
    if (!fixed.every((c) => continentComplete(s, pid, c))) return false;
    if (KONTINENT_EXTRA.has(id)) return completedContinents(s, pid).some((c) => !fixed.includes(c));
    return true;
  }
  if (id === 'g_weltmacht') return countTerritories(s, pid) >= scaled(MISSION_TARGETS.g_weltmacht.goal, n);
  if (id === 'g_bastion') return countTerritoriesWithTroops(s, pid, scaled(MISSION_TARGETS.g_bastion.goalTroops, n)) >= 1 && completedContinents(s, pid).length >= 1;
  if (mission.target) {
    const x = playerById(s, mission.target);
    return !!x && !x.alive && x.eliminatedBy === pid;
  }
  if (id === 'f_feldherr') {
    const comp = completedContinents(s, pid);
    return comp.length >= MISSION_TARGETS.feldherr.goalContinents && comp.some((c) => ['nordamerika', 'europa', 'asien'].includes(c));
  }
  return false;
}

/** Anzeige-Fortschritt einer Mission (rein; mission default = die zugeteilte). */
export function missionProgress(s, pid, mission = playerById(s, pid)?.mission) {
  if (!mission) return null;
  const m = mission;
  const id = m.id;
  const n = s.order.length;
  const T = MISSION_TARGETS;
  let stage1, stage2, goal;

  if (id in KONTINENT_MISSIONS) {
    const fixed = KONTINENT_MISSIONS[id];
    const prog = (c) => {
      const list = CONTINENT_TERRITORIES[c];
      const own = list.filter((tid) => s.territories[tid].owner === pid).length;
      return `${CONTINENTS[c].name} ${own}/${list.length}`;
    };
    stage1 = { text: 'In einem Zug 2 Gebiete in den Zielkontinenten erobern' };
    stage2 = { text: 'Einen Zielkontinent komplett', detail: fixed.map(prog).join(' · ') };
    goal = { text: `Alle Zielkontinente komplett${KONTINENT_EXTRA.has(id) ? ' (+1 weiterer)' : ''}`, detail: fixed.map(prog).join(' · '), met: missionGoalMet(s, pid, m) };
  } else if (id === 'g_weltmacht') {
    const c = countTerritories(s, pid);
    stage1 = { text: 'In einem Zug 3 Gebiete erobern' };
    stage2 = { text: 'Gebiete besitzen', detail: `${c}/${scaled(T.g_weltmacht.stage2, n)}` };
    goal = { text: 'Gebiete besitzen', detail: `${c}/${scaled(T.g_weltmacht.goal, n)}`, met: missionGoalMet(s, pid, m) };
  } else if (id === 'g_bastion') {
    const s1 = scaled(T.g_bastion.stage1Troops, n);
    const s2 = scaled(T.g_bastion.stage2Troops, n);
    const gz = scaled(T.g_bastion.goalTroops, n);
    const forts = (min) => countTerritoriesWithTroops(s, pid, min);
    stage1 = { text: `Ein Gebiet mit ≥ ${s1} Truppen`, detail: forts(s1) >= 1 ? 'erreicht' : 'noch keins' };
    stage2 = { text: `${T.g_bastion.stage2Count} Gebiete mit je ≥ ${s2} Truppen`, detail: `${Math.min(forts(s2), T.g_bastion.stage2Count)}/${T.g_bastion.stage2Count}` };
    goal = { text: `Festung ≥ ${gz} Truppen + 1 Kontinent`, detail: `Festung: ${forts(gz) >= 1 ? 'ja' : 'nein'} · Kontinente: ${completedContinents(s, pid).length}`, met: missionGoalMet(s, pid, m) };
  } else if (m.target) {
    const xn = playerName(s, m.target);
    const x = playerById(s, m.target);
    stage1 = { text: `In einem Zug 2 Gebiete von ${xn} erobern` };
    stage2 = { text: `${xn} auf ≤ ${T.vernichtung.stage2MaxTerritories} Gebiete drücken`, detail: `${xn}: ${x ? countTerritories(s, m.target) : 0} Gebiete` };
    goal = { text: `${xn} ausschalten`, met: missionGoalMet(s, pid, m) };
  } else if (id === 'f_feldherr') {
    stage1 = { text: 'General an 3 Eroberungen beteiligt' };
    stage2 = { text: '2 Kontinente gleichzeitig', detail: `${completedContinents(s, pid).length} komplett` };
    goal = { text: '3 Kontinente (einer aus NA/EU/AS)', met: missionGoalMet(s, pid, m) };
  }
  return { id, name: missionName(m, s), stage1, stage2, goal };
}

// Ist die Zustands-Etappe (Etappe 2) der Mission aktuell erfüllt? (rein)
function stage2Met(s, pid) {
  const m = playerById(s, pid)?.mission;
  if (!m) return false;
  const id = m.id;
  const n = s.order.length;
  const T = MISSION_TARGETS;
  if (id in KONTINENT_MISSIONS) return KONTINENT_MISSIONS[id].some((c) => continentComplete(s, pid, c));
  if (id === 'g_weltmacht') return countTerritories(s, pid) >= scaled(T.g_weltmacht.stage2, n);
  if (id === 'g_bastion') return countTerritoriesWithTroops(s, pid, scaled(T.g_bastion.stage2Troops, n)) >= T.g_bastion.stage2Count;
  if (m.target) {
    // §4.3: General von X durch dich besiegt 🔗 ODER X auf ≤ 4 Gebiete gedrückt
    const killedGeneral = playerById(s, pid)?.stats?.killedGeneralOf?.includes(m.target);
    const lowTerr = playerById(s, m.target)?.alive && countTerritories(s, m.target) <= T.vernichtung.stage2MaxTerritories;
    return !!(killedGeneral || lowTerr);
  }
  if (id === 'f_feldherr') return completedContinents(s, pid).length >= T.feldherr.stage2Continents;
  return false;
}

// Eine Etappe als erreicht markieren: +2 Truppen und eine Depeschen-Wahl (einmalig).
function reachStage(s, pid, idx, rng = Math.random) {
  const p = playerById(s, pid);
  if (!p?.mission || p.stagesDone[idx]) return;
  p.stagesDone[idx] = true;
  p.stageBonus += MISSION_STAGE_BONUS;
  const level = idx === 0 ? 1 : 2; // Etappe 1 -> Stufe I, Etappe 2 -> Stufe II
  grantDepescheChoice(s, pid, level, rng); // 3 unterschiedliche Karten zur Wahl
  addLog(s, `${p.name} hat eine Etappe erreicht (+${MISSION_STAGE_BONUS} Truppen, 1 Depesche).`); // welche bleibt geheim
}

// Etappe 1 = Ereignis, nach jeder Eroberung geprüft (nutzt turnStats des Spielers am Zug).
function checkStage1(s, pid, rng) {
  if (!s.missions || s.phase === 'setup') return; // Startverteilung darf Etappe 1 nie auslösen (§2)
  const p = playerById(s, pid);
  const m = p?.mission;
  if (!m || p.stagesDone[0]) return;
  const id = m.id;
  const ts = s.turnStats || { conquered: 0, conqueredFrom: {}, conqueredIn: {} };
  let ok = false;
  if (id in KONTINENT_MISSIONS) {
    const inZiel = KONTINENT_MISSIONS[id].reduce((sum, c) => sum + (ts.conqueredIn[c] || 0), 0);
    ok = inZiel >= MISSION_TARGETS.kontinent.stage1Conquests;
  } else if (id === 'g_weltmacht') {
    ok = ts.conquered >= MISSION_TARGETS.g_weltmacht.stage1Conquests;
  } else if (m.target) {
    ok = (ts.conqueredFrom[m.target] || 0) >= MISSION_TARGETS.vernichtung.stage1From;
  } else if (id === 'f_feldherr') {
    // Kumulativ über Züge: General war an genug Eroberungen beteiligt (§4.4)
    ok = (p.stats?.generalConquests || 0) >= MISSION_TARGETS.feldherr.stage1GeneralConquests;
  } else if (id === 'g_bastion') {
    // Zustand, aber nie durch die Startverteilung (Setup oben ausgeschlossen): ein Gebiet ≥ Schwelle
    ok = countTerritoriesWithTroops(s, pid, scaled(MISSION_TARGETS.g_bastion.stage1Troops, s.order.length)) >= 1;
  }
  if (ok) reachStage(s, pid, 0, rng);
}

// Etappe 2 = Zustand, am Ende des eigenen Zugs geprüft (für alle Missionen).
function checkStage2(s, pid, rng) {
  if (!s.missions) return;
  if (stage2Met(s, pid)) reachStage(s, pid, 1, rng);
}

function checkMissionVictory(s, pid) {
  if (!s.missions || s.phase === 'gameover' || s.phase === 'setup') return;
  if (missionGoalMet(s, pid)) {
    // Einen noch offenen Nachrück-Vorgang abschließen, damit kein Gebiet auf 0 steht
    if (s.pendingMove) {
      const pm = s.pendingMove;
      moveTroops(s.territories[pm.from], s.territories[pm.to], pm.min);
    }
    s.winner = pid;
    s.phase = 'gameover';
    s.pendingMove = null;
    addLog(s, `🏆 ${playerName(s, pid)} erfüllt seine Mission: ${missionName(playerById(s, pid).mission, s)}!`);
  }
}

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
  const stageBonus = playerById(s, pid)?.stageBonus || 0; // aus erreichten Missions-Etappen
  const total = base + bonuses.reduce((sum, b) => sum + b.bonus, 0) + stageBonus;
  return { territories, base, bonuses, stageBonus, total };
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

function addLog(s, text, visibleTo) {
  const entry = { turn: s.turn, text };
  if (visibleTo) entry.visibleTo = visibleTo; // private Meldung nur für diese Spieler-IDs
  s.log.push(entry);
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

function moveTroops(from, to, n) {
  from.troops -= n;
  to.troops += n;
}

// Pfeil-Historie des Zugs ergänzen (gleiche Strecke nicht doppelt; Eroberung „gewinnt").
function recordMove(s, from, to, kind, conquered = false) {
  if (!Array.isArray(s.turnMoves)) s.turnMoves = [];
  const prev = s.turnMoves.find((m) => m.from === from && m.to === to && m.kind === kind);
  if (prev) prev.conquered = prev.conquered || conquered;
  else s.turnMoves.push({ from, to, kind, conquered });
}

// ---------------------------------------------------------------- Spielstart

/**
 * @param {{id:string, name:string}[]} players
 * @param {() => number} rng Zufallsfunktion [0,1) – in Tests deterministisch
 * @param {{ordenMode?: 'static'|'dynamic'}} options
 */
export function createGame(players, rng = Math.random, options = {}) {
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`Es werden ${MIN_PLAYERS} bis ${MAX_PLAYERS} Spieler benötigt.`);
  }
  const order = shuffle(players.map((p) => p.id), rng);
  const territories = {};
  shuffle(TERRITORIES.map((t) => t.id), rng).forEach((tid, i) => {
    territories[tid] = { owner: order[i % order.length], troops: 1 };
  });

  const state = {
    players: players.map((p, i) => ({ id: p.id, name: p.name, color: PLAYER_COLORS[i], alive: true, orden: [] })),
    order,
    territories,
    phase: 'setup', // setup | reinforce | attack | fortify | gameover
    current: 0, // Index in `order`
    turn: 1,
    setupRemaining: {},
    setupPlacedThisTurn: 0,
    reinforcements: 0,
    pendingMove: null, // nach Eroberung: { from, to, min, max }
    conqueredThisTurn: false,
    ordenMode: options.ordenMode === 'dynamic' ? 'dynamic' : 'static',
    setsRedeemed: 0, // global, steuert die dynamische Staffelung
    lastCombat: null,
    turnMoves: [], // Pfeil-Historie des laufenden Zugs (wird in startTurn geleert)
    attacksThisTurn: 0, // Angriffe im laufenden Zug (Limit in der ersten Runde)
    winner: null,
    log: [],
  };
  const start = START_ARMIES[players.length];
  for (const pid of order) state.setupRemaining[pid] = Math.max(0, start - countTerritories(state, pid));

  // General-System (optional, unabhängig von Missionen): jeder hat einen General auf
  // einem zufälligen eigenen Gebiet. Er gibt seinem Gebiet +1 auf den höchsten Würfel
  // (Angriff & Verteidigung), rückt auf Wunsch mit und fällt, wenn sein Gebiet erobert wird.
  state.general = options.general === true;
  if (state.general) {
    for (const p of state.players) {
      const mine = Object.keys(territories).filter((tid) => territories[tid].owner === p.id);
      p.general = mine.length ? mine[Math.floor(rng() * mine.length)] : null;
    }
  }

  // Nebel des Krieges (optional): fremde Truppenzahlen außerhalb der eigenen Sicht verborgen.
  state.fog = options.fog === true;
  if (state.fog) {
    for (const p of state.players) {
      p.aufklaerungTurn = 0; // Zug, in dem „Aufklärung" aktiv ist (Nebel diesen Zug ganz weg)
      p.spaeher = null; // { center, until } – entferntes Gebiet + Nachbarn sichtbar
      p.tarnung = null; // { tiles:[...], until } – eigene Gebiete zeigen Gegnern „?"
    }
  }

  // Missionen nur ab 3 Spielern und wenn aktiviert; jeder zieht verdeckt eine
  state.missions = options.missions === true && players.length >= MISSION_MIN_PLAYERS;
  if (state.missions) {
    const choices = assignMissionChoices(order, rng, options);
    for (const p of state.players) {
      p.missionOptions = choices[p.id]; // 2 zur Auswahl, bis gewählt wird
      p.mission = null;
      p.stagesDone = [false, false]; // [Etappe 1, Etappe 2]
      p.stageBonus = 0; // +2 je erreichter Etappe, fließt in die nächste Verstärkung
      p.stats = { generalConquests: 0, killedGeneralOf: [] }; // dauerhafte Zähler (§5.2)
      p.depeschen = []; // Hand (max. DEPESCHE_HAND_LIMIT)
      p.depeschenChoice = []; // offene Belohnungs-Wahlen (Warteschlange)
      p.pillory = null; // öffentlicher Missionstyp, sobald enttarnt (§6.4)
    }
    state.depeschenDeck = buildDepescheDecks(rng, state.general, state.fog);
    state.depeschenDiscard = { 1: [], 2: [] };
    state.depeschePlayedThisTurn = false;
    state.tieBreakAttacker = null; // Überraschungsangriff: Gleichstand geht an diesen Angreifer
  }

  addLog(state, `Spiel gestartet. Reihenfolge: ${order.map((id) => playerName(state, id)).join(', ')}.`);
  if (state.missions) addLog(state, 'Missionen aktiv: Jeder wählt zu Beginn eine aus zwei geheimen Missionen.');
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

function startTurn(s, rng = Math.random) {
  const pid = currentPlayerId(s);
  // Zähler für diesen Zug zurücksetzen
  s.turnStats = { conquered: 0, conqueredFrom: {}, conqueredIn: {} };
  s.turnMoves = []; // Pfeil-Historie dieses Zugs (Angriffe/Verschiebungen), für alle sichtbar
  s.attacksThisTurn = 0; // für das Angriffslimit der ersten Runde
  s.depeschePlayedThisTurn = false;
  s.tieBreakAttacker = null;
  const r = calcReinforcements(s, pid);
  s.phase = 'reinforce';
  s.reinforcements = r.total;
  s.conqueredThisTurn = false;
  s.pendingMove = null;
  const bonusText = r.bonuses.length
    ? ` (inkl. Bonus: ${r.bonuses.map((b) => `${b.name} +${b.bonus}`).join(', ')})`
    : '';
  const stageText = r.stageBonus ? ` (+${r.stageBonus} Etappen-Bonus)` : '';
  addLog(s, `Zug ${s.turn}: ${playerName(s, pid)} ist am Zug und erhält ${r.total} Truppen${bonusText}${stageText}.`);
  // Etappen-Bonus ist nun verrechnet; den Betrag für die Anzeige dieses Zugs merken
  s.turnStageBonus = r.stageBonus;
  const p = playerById(s, pid);
  if (p) p.stageBonus = 0;
}

function finishTurn(s, rng = Math.random) {
  const ender = playerById(s, currentPlayerId(s));
  // Zustands-Etappe (Etappe 2) am Ende des eigenen Zugs prüfen (vor dem Spielerwechsel)
  checkStage2(s, ender.id, rng);
  // Wer in diesem Zug mindestens ein Gebiet erobert hat, bekommt einen Orden
  if (s.conqueredThisTurn && ender.alive) {
    const type = ORDEN_TYPES[Math.floor(rng() * ORDEN_TYPES.length)];
    (ender.orden ||= []).push(type);
    addLog(s, `${ender.name} erhält einen Orden (${ORDEN_LABEL[type]}) für seine Eroberung.`);
  }
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
  startTurn(s, rng);
}

function forceSkip(s, rng = Math.random) {
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
  finishTurn(s, rng);
}

// ---------------------------------------------------------------- Kampf

// Erste Runde = jeder spielt zum ersten Mal, also Zug 1..Spieleranzahl.
function firstRoundAttackLimited(s) {
  return s.turn <= s.order.length && (s.attacksThisTurn || 0) >= FIRST_ROUND_ATTACK_LIMIT;
}

function checkAttack(s, fromId, toId, pid) {
  if (s.phase !== 'attack') return 'Angreifen ist gerade nicht möglich.';
  if (s.pendingMove) return 'Lege zuerst fest, wie viele Truppen nachrücken.';
  if (firstRoundAttackLimited(s)) return `In der ersten Runde sind höchstens ${FIRST_ROUND_ATTACK_LIMIT} Angriffe erlaubt.`;
  const from = s.territories[fromId];
  const to = s.territories[toId];
  if (!from || !to) return 'Unbekanntes Gebiet.';
  if (from.owner !== pid) return 'Du kannst nur aus eigenen Gebieten angreifen.';
  if (to.owner === pid) return 'Du kannst kein eigenes Gebiet angreifen.';
  if (!isAdjacent(fromId, toId)) return 'Die Gebiete grenzen nicht aneinander.';
  if (from.troops < 2) return 'Zum Angreifen braucht ein Gebiet mindestens 2 Truppen.';
  return null;
}

// Steht der General von `pid` auf diesem Gebiet? (nur bei aktivem General-System)
function generalOn(s, pid, tid) {
  return s.general && playerById(s, pid)?.general === tid;
}

function battleRound(s, fromId, toId, attDice, rng) {
  const from = s.territories[fromId];
  const to = s.territories[toId];
  const defDice = Math.min(2, to.troops);
  const att = Array.from({ length: attDice }, () => rollDie(rng)).sort((a, b) => b - a);
  const def = Array.from({ length: defDice }, () => rollDie(rng)).sort((a, b) => b - a);
  // Überraschungsangriff (Depesche): für diesen Angreifer gewinnt Gleichstand
  const tieToAtt = s.tieBreakAttacker && s.tieBreakAttacker === from.owner;
  // General gibt +1 auf den höchsten Würfel (nur im Vergleich, die rohen Würfel bleiben sichtbar)
  const attBonus = generalOn(s, from.owner, fromId) ? 1 : 0;
  const defBonus = generalOn(s, to.owner, toId) ? 1 : 0;
  let attLoss = 0;
  let defLoss = 0;
  for (let i = 0; i < Math.min(att.length, def.length); i++) {
    const a = att[i] + (i === 0 ? attBonus : 0);
    const d = def[i] + (i === 0 ? defBonus : 0);
    if (a > d || (a === d && tieToAtt)) defLoss++;
    else attLoss++; // sonst gewinnt bei Gleichstand der Verteidiger
  }
  from.troops -= attLoss;
  to.troops -= defLoss;
  return { att, def, attLoss, defLoss, attBonus, defBonus };
}

function conquer(s, fromId, toId, dice, pid, rng = Math.random) {
  const from = s.territories[fromId];
  const to = s.territories[toId];
  const prevOwner = to.owner;
  to.owner = pid;
  to.troops = 0;
  s.conqueredThisTurn = true;
  // Zug-Zähler für Missions-Etappe 1 (§5.1)
  if (s.turnStats) {
    s.turnStats.conquered += 1;
    s.turnStats.conqueredFrom[prevOwner] = (s.turnStats.conqueredFrom[prevOwner] || 0) + 1;
    const cont = TERRITORY_BY_ID[toId].continent;
    s.turnStats.conqueredIn[cont] = (s.turnStats.conqueredIn[cont] || 0) + 1;
  }
  if (s.lastCombat) s.lastCombat.conquered = true;
  addLog(s, `${playerName(s, pid)} erobert ${territoryName(toId)}!`);

  if (s.general) {
    const attacker = playerById(s, pid);
    // Feldherr: General stand im angreifenden Gebiet, als die Eroberung passierte (§4.4)
    if (generalOn(s, pid, fromId) && attacker?.stats) attacker.stats.generalConquests = (attacker.stats.generalConquests || 0) + 1;
    // General des bisherigen Besitzers fällt, wenn sein Gebiet erobert wird
    const victim = playerById(s, prevOwner);
    if (victim?.general === toId) {
      victim.general = null;
      if (attacker?.stats) (attacker.stats.killedGeneralOf ||= []).push(prevOwner); // Vernichtung-Etappe 2 (§4.3)
      addLog(s, `⚔️ ${playerName(s, pid)} hat den General von ${victim.name} besiegt!`);
      // Belohnung: eine Stufe-I-Depesche (nur wenn Depeschen aktiv sind, §6.3)
      if (s.missions) {
        grantDepescheChoice(s, pid, 1, rng);
        addLog(s, 'Für den besiegten General erhältst du eine Depesche (Stufe I).', [pid]);
      }
    }
  }

  if (countTerritories(s, prevOwner) === 0) {
    const dead = playerById(s, prevOwner);
    dead.alive = false;
    dead.eliminatedBy = pid; // für Vernichtungs-Missionen
    addLog(s, `${dead.name} wurde ausgeschaltet.`);
    // Ausfallregel: wessen Vernichtungsziel von jemand anderem erledigt wurde, bekommt Weltmacht
    if (s.missions) {
      for (const other of s.players) {
        if (other.mission?.target === prevOwner && other.id !== pid) {
          other.mission = { id: 'g_weltmacht' };
          addLog(s, 'Deine Vernichtungs-Mission ist hinfällig – neues Ziel: Weltmacht.', [other.id]);
        }
      }
    }
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

  checkStage1(s, pid, rng); // Ereignis-Etappe direkt nach der Eroberung prüfen
}

// ---------------------------------------------------------------- Depeschen spielen

// Effekt einer ausgespielten Depesche. Gibt Fehlertext zurück oder null.
// (Bei Fehler verwirft applyAction den geklonten Zustand ohnehin komplett.)
function playDepescheEffect(s, id, a, pid) {
  const own = (tid) => s.territories[tid] && s.territories[tid].owner === pid;
  if (id === 'nachschub') {
    // Mit lebendem General gehen die +3 auf dessen Gebiet (§6.3), sonst auf ein beliebiges eigenes.
    const gen = s.general ? playerById(s, pid)?.general : null;
    const target = gen || a.target;
    if (!own(target)) return 'Wähle ein eigenes Gebiet.';
    s.territories[target].troops += 3;
    return null;
  }
  if (id === 'marschbefehl') {
    if (!s.general) return 'Der Marschbefehl ist ohne General-System wirkungslos.';
    if (!own(a.target)) return 'Wähle ein eigenes Gebiet.';
    playerById(s, pid).general = a.target; // versetzen oder (falls gefallen) wiederbeleben
    return null;
  }
  if (id === 'sabotage') {
    const t = s.territories[a.target];
    if (!t) return 'Unbekanntes Gebiet.';
    if (t.owner === pid) return 'Sabotage trifft nur gegnerische Gebiete.';
    if (s.fog && !visibleTerritories(s, pid).has(a.target)) return 'Im Nebel kannst du nur sichtbare Gebiete sabotieren.';
    t.troops = Math.max(1, t.troops - 3);
    return null;
  }
  if (id === 'gewaltmarsch' || id === 'luftbruecke') {
    const from = s.territories[a.from];
    const to = s.territories[a.to];
    if (!own(a.from) || !own(a.to)) return 'Beide Gebiete müssen dir gehören.';
    if (a.from === a.to) return 'Start und Ziel müssen verschieden sein.';
    if (id === 'gewaltmarsch' && !reachableOwn(s, a.from).has(a.to)) return 'Nur über eigene Gebiete verbunden möglich.';
    const count = toInt(a.count);
    if (!(count >= 1 && count <= from.troops - 1)) return `Du kannst 1 bis ${from.troops - 1} Truppe(n) verschieben.`;
    moveTroops(from, to, count);
    return null;
  }
  if (id === 'ueberraschung') {
    s.tieBreakAttacker = pid;
    return null;
  }
  if (id === 'aufklaerung') {
    if (!s.fog) return 'Ohne Nebel gibt es nichts aufzuklären.';
    playerById(s, pid).aufklaerungTurn = s.turn; // Rest des Zugs alles sichtbar
    return null;
  }
  if (id === 'spaeher') {
    if (!s.fog) return 'Ohne Nebel gibt es nichts auszuspähen.';
    if (!s.territories[a.target]) return 'Unbekanntes Gebiet.';
    playerById(s, pid).spaeher = { center: a.target, until: s.turn + s.order.length }; // bis Ende des nächsten eigenen Zugs
    return null;
  }
  if (id === 'tarnung') {
    if (!s.fog) return 'Ohne Nebel gibt es nichts zu tarnen.';
    const tiles = Array.isArray(a.targets) ? [...new Set(a.targets)] : [];
    if (tiles.length !== 3) return 'Wähle genau 3 eigene Gebiete.';
    if (!tiles.every(own)) return 'Du kannst nur eigene Gebiete tarnen.';
    playerById(s, pid).tarnung = { tiles, until: s.turn + s.order.length }; // bis Beginn des nächsten eigenen Zugs
    return null;
  }
  if (id === 'abgefangen') {
    const tgt = playerById(s, a.target);
    if (!tgt || tgt.id === pid) return 'Wähle einen Gegner.';
    if (!tgt.alive) return 'Dieser Spieler ist bereits ausgeschieden.';
    if (!tgt.mission) return 'Dieser Spieler hat noch keine Mission gewählt.';
    if (tgt.pillory) return 'Dieser Spieler steht bereits am Pranger.';
    tgt.pillory = { type: missionType(tgt.mission), turn: s.turn };
    addLog(s, `📜 ${playerName(s, pid)} enttarnt ${playerName(s, tgt.id)}: Missionstyp „${PILLORY_LABEL[tgt.pillory.type]}“.`);
    return null;
  }
  return 'Unbekannte Depesche.';
}

// Belohnungs-Wahl auflösen (darf auch außerhalb des eigenen Zugs geschehen).
function chooseDepesche(s, pid, keep, discardIdx) {
  const p = playerById(s, pid);
  const choice = p?.depeschenChoice?.[0];
  if (!choice) return 'Du hast gerade keine Depeschen-Wahl offen.';
  const keepIdx = keep == null ? -1 : { a: 0, b: 1, c: 2 }[keep];
  if (keepIdx === undefined) return 'Ungültige Wahl.';
  if (keepIdx >= 0 && !choice.cards[keepIdx]) return 'Diese Karte gibt es nicht.';
  const kept = keepIdx >= 0 ? choice.cards[keepIdx] : null;
  if (kept) {
    if (p.depeschen.length >= DEPESCHE_HAND_LIMIT) {
      const di = toInt(discardIdx);
      if (!(di >= 0 && di < p.depeschen.length)) return 'Deine Hand ist voll – lege eine Karte ab oder verwirf die neue.';
      const dropped = p.depeschen.splice(di, 1)[0];
      s.depeschenDiscard[DEPESCHE_CARDS[dropped].level].push(dropped);
    }
    p.depeschen.push(kept);
  }
  // nicht behaltene (gezogene) Karten wandern auf die Ablage – per Index, damit Duplikate stimmen
  choice.cards.forEach((c, i) => { if (i !== keepIdx) s.depeschenDiscard[DEPESCHE_CARDS[c].level].push(c); });
  p.depeschenChoice.shift();
  addLog(s, kept ? `Du behältst eine Depesche: ${depescheName(kept)}.` : 'Du verwirfst die gezogenen Depeschen.', [pid]);
  return null;
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
    // Ab ORDEN_FORCE_AT Orden muss erst eingelöst werden, bevor es in die Angriffsphase geht
    if (s.reinforcements === 0 && (playerById(s, pid).orden?.length || 0) < ORDEN_FORCE_AT) s.phase = 'attack';
    return null;
  },

  redeemOrden(s, a, pid) {
    if (s.phase !== 'reinforce') return 'Orden kannst du nur beim Verstärken einlösen.';
    const set = Array.isArray(a.set) ? a.set : null;
    if (!set || set.length !== 3 || !set.every((t) => ORDEN_TYPES.includes(t))) return 'Wähle genau 3 gültige Orden.';
    const uniq = new Set(set);
    if (uniq.size !== 1 && uniq.size !== 3) return 'Nur 3 gleiche oder 3 verschiedene Orden sind gültig.';
    const player = playerById(s, pid);
    const rest = [...(player.orden || [])];
    for (const t of set) {
      const i = rest.indexOf(t);
      if (i < 0) return 'Du besitzt diese Orden nicht.';
      rest.splice(i, 1);
    }
    const reward = ordenReward(s);
    player.orden = rest;
    s.setsRedeemed += 1;
    s.reinforcements += reward;
    addLog(s, `${playerName(s, pid)} löst einen Orden-Satz ein und erhält +${reward} Einheiten.`);
    return null;
  },

  playDepesche(s, a, pid) {
    if (!s.missions) return 'Depeschen sind in dieser Partie nicht aktiv.';
    if (s.depeschePlayedThisTurn) return 'Du kannst pro Zug nur eine Depesche spielen.';
    if (s.pendingMove) return 'Lege zuerst fest, wie viele Truppen nachrücken.';
    const p = playerById(s, pid);
    const idx = toInt(a.index);
    if (!(idx >= 0 && idx < (p.depeschen?.length || 0))) return 'Ungültige Depesche.';
    const id = p.depeschen[idx];
    const card = DEPESCHE_CARDS[id];
    if (!card.phases.includes(s.phase)) return `${card.name} kannst du in dieser Phase nicht spielen.`;
    const err = playDepescheEffect(s, id, a, pid);
    if (err) return err;
    p.depeschen.splice(idx, 1);
    s.depeschenDiscard[card.level].push(id);
    s.depeschePlayedThisTurn = true;
    addLog(s, `${playerName(s, pid)} spielt eine Depesche: ${card.name}.`);
    return null;
  },

  attack(s, a, pid, rng) {
    const err = checkAttack(s, a.from, a.to, pid);
    if (err) return err;
    s.attacksThisTurn = (s.attacksThisTurn || 0) + 1;
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
      attBonus: r.attBonus, defBonus: r.defBonus,
    };
    addLog(
      s,
      `${playerName(s, pid)} greift ${territoryName(a.to)} (${playerName(s, defender)}) an: ` +
        `[${r.att.join(' ')}] gegen [${r.def.join(' ')}] – Verluste ${r.attLoss}:${r.defLoss}.`,
    );
    const conquered = s.territories[a.to].troops === 0;
    if (conquered) conquer(s, a.from, a.to, dice, pid, rng);
    recordMove(s, a.from, a.to, 'attack', conquered);
    if (s.tieBreakAttacker === pid) s.tieBreakAttacker = null; // Überraschung verbraucht
    return null;
  },

  blitz(s, a, pid, rng) {
    const err = checkAttack(s, a.from, a.to, pid);
    if (err) return err;
    s.attacksThisTurn = (s.attacksThisTurn || 0) + 1;
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
      attBonus: last.attBonus, defBonus: last.defBonus,
    };
    addLog(
      s,
      `${playerName(s, pid)} startet einen Blitz-Angriff von ${territoryName(a.from)} auf ` +
        `${territoryName(a.to)} (${playerName(s, defender)}): ${rounds} Runde(n), Verluste ${attLoss}:${defLoss}.`,
    );
    const conquered = to.troops === 0;
    if (conquered) conquer(s, a.from, a.to, dice, pid, rng);
    recordMove(s, a.from, a.to, 'attack', conquered);
    if (s.tieBreakAttacker === pid) s.tieBreakAttacker = null; // Überraschung verbraucht
    return null;
  },

  occupy(s, a, pid) {
    if (s.phase !== 'attack' || !s.pendingMove) return 'Es gibt gerade nichts nachzurücken.';
    const pm = s.pendingMove;
    const count = toInt(a.count);
    if (!(count >= pm.min && count <= pm.max)) return `Wähle zwischen ${pm.min} und ${pm.max} Truppen.`;
    moveTroops(s.territories[pm.from], s.territories[pm.to], count);
    if (a.withGeneral && generalOn(s, pid, pm.from)) {
      playerById(s, pid).general = pm.to; // General rückt in das eroberte Gebiet mit
      addLog(s, `${playerName(s, pid)} verlegt den General nach ${territoryName(pm.to)}.`);
    }
    s.pendingMove = null;
    return null;
  },

  endAttack(s) {
    if (s.phase !== 'attack') return 'Du bist nicht in der Angriffsphase.';
    if (s.pendingMove) return 'Lege zuerst fest, wie viele Truppen nachrücken.';
    s.phase = 'fortify';
    return null;
  },

  fortify(s, a, pid, rng) {
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
    recordMove(s, a.from, a.to, 'fortify', false);
    addLog(s, `${playerName(s, pid)} verschiebt ${count} Truppe(n) von ${territoryName(a.from)} nach ${territoryName(a.to)}.`);
    if (a.withGeneral && generalOn(s, pid, a.from)) {
      playerById(s, pid).general = a.to; // General zieht mit
      addLog(s, `${playerName(s, pid)} verlegt den General nach ${territoryName(a.to)}.`);
    }
    finishTurn(s, rng);
    return null;
  },

  endTurn(s, a, pid, rng) {
    if (s.phase === 'attack') {
      if (s.pendingMove) return 'Lege zuerst fest, wie viele Truppen nachrücken.';
    } else if (s.phase !== 'fortify') {
      return 'Du kannst deinen Zug jetzt noch nicht beenden.';
    }
    finishTurn(s, rng);
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
    forceSkip(s, rng);
    return { state: s };
  }
  // Missionswahl ist unabhängig vom Zug (jeder wählt zu Beginn für sich)
  if (action.type === 'chooseMission') {
    const err = chooseMission(s, actorId, action.id);
    return err ? { error: err } : { state: s };
  }
  // Depeschen-Wahl darf auch außerhalb des eigenen Zugs ausgeführt werden (§6.2)
  if (action.type === 'chooseDepesche') {
    const err = chooseDepesche(s, actorId, action.keep, action.discard);
    return err ? { error: err } : { state: s };
  }
  if (actorId !== currentPlayerId(s)) return { error: 'Du bist nicht am Zug.' };
  const handler = Object.hasOwn(HANDLERS, action.type) ? HANDLERS[action.type] : null;
  if (!handler) return { error: `Unbekannte Aktion: ${action.type}` };
  const error = handler(s, action, actorId, rng);
  if (error) return { error };
  checkStage1(s, actorId, rng); // Ereignis-Etappen (z. B. Bastion-Festung durch Verstärken) prüfen
  checkMissionVictory(s, actorId); // Endziel nach jeder eigenen Aktion prüfen
  return { state: s };
}
