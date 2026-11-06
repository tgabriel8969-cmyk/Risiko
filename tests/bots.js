// Bots für Simulation & Balance-Messung (§12). Kein DOM, kein Netzwerk – nur reine
// Heuristik auf dem Zustand. Der Missions-Bot verfolgt gierig sein eigenes Ziel:
// verstärkt Grenzen an Missionszielen, greift bevorzugt zielführend an, spielt
// Depeschen, sobald sie gültig spielbar sind.
import { ADJACENCY, CONTINENT_TERRITORIES } from '../js/map.js';
import {
  currentPlayerId, validAttackTargets, reachableOwn, ordenSets,
  missionTargets, DEPESCHE_CARDS, DEPESCHE_HAND_LIMIT, FIRST_ROUND_ATTACK_LIMIT,
} from '../js/rules.js';

export function missionBotAction(s, rng) {
  const pid = currentPlayerId(s);
  const self = s.players.find((p) => p.id === pid);
  const own = Object.keys(s.territories).filter((id) => s.territories[id].owner === pid);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const foe = (id) => s.territories[id].owner !== pid;

  // 1) Offene Missionswahl zuerst erledigen (unabhängig von der Phase)
  if (s.missions && self.missionOptions && !self.mission) {
    return { type: 'chooseMission', id: pick(self.missionOptions).id };
  }
  // 2) Offene Depeschen-Wahl auflösen (behalten, bei voller Hand die erste ablegen)
  if (self.depeschenChoice?.length) {
    const full = (self.depeschen?.length || 0) >= DEPESCHE_HAND_LIMIT;
    return { type: 'chooseDepesche', keep: 'a', discard: full ? 0 : undefined };
  }

  // Zielgebiete, die die eigene Mission voranbringen
  const tgt = s.missions ? missionTargets(self.mission) : { continents: [], targetPlayer: null, wantTerritories: true };
  const goalTerr = new Set();
  for (const c of tgt.continents) for (const t of CONTINENT_TERRITORIES[c]) goalTerr.add(t);
  const advances = (t) => goalTerr.has(t) || (tgt.targetPlayer && s.territories[t].owner === tgt.targetPlayer);

  // 3) Depesche spielen, sobald sie gültig spielbar ist
  if (s.missions && !s.depeschePlayedThisTurn && !s.pendingMove && self.depeschen?.length && rng() < 0.6) {
    for (let i = 0; i < self.depeschen.length; i++) {
      const id = self.depeschen[i];
      const card = DEPESCHE_CARDS[id];
      if (!card.phases.includes(s.phase)) continue;
      if (id === 'ueberraschung') return { type: 'playDepesche', index: i };
      if (id === 'nachschub') {
        const border = own.filter((t) => ADJACENCY[t].some(foe));
        return { type: 'playDepesche', index: i, target: pick(border.length ? border : own) };
      }
      if (id === 'sabotage') {
        const foes = Object.keys(s.territories).filter(foe);
        const pref = foes.filter(advances);
        if (foes.length) return { type: 'playDepesche', index: i, target: pick(pref.length ? pref : foes) };
      }
      if (id === 'gewaltmarsch' || id === 'luftbruecke') {
        const srcs = own.filter((t) => s.territories[t].troops >= 3);
        if (srcs.length) {
          const from = pick(srcs);
          const reach = id === 'gewaltmarsch' ? [...reachableOwn(s, from)] : own;
          const tos = reach.filter((t) => t !== from && ADJACENCY[t].some(foe));
          if (tos.length) return { type: 'playDepesche', index: i, from, to: pick(tos), count: s.territories[from].troops - 1 };
        }
      }
      if (id === 'abgefangen') {
        const foes = s.players.filter((p) => p.id !== pid && p.alive && !p.pillory);
        if (foes.length) return { type: 'playDepesche', index: i, target: pick(foes).id };
      }
      if (id === 'marschbefehl') {
        // General an die Front (oder, falls gefallen, dort wiederbeleben)
        const frontier = own.filter((t) => ADJACENCY[t].some(foe));
        const where = frontier.length ? frontier : own;
        if (where.length) return { type: 'playDepesche', index: i, target: pick(where) };
      }
    }
  }

  const border = own.filter((t) => ADJACENCY[t].some(foe));
  const goalBorder = border.filter((t) => ADJACENCY[t].some((n) => foe(n) && advances(n)));

  switch (s.phase) {
    case 'setup':
      return { type: 'place', territory: pick(goalBorder.length ? goalBorder : border.length ? border : own), count: 1 };
    case 'reinforce': {
      const sets = ordenSets(self.orden);
      if (sets.length && (s.reinforcements === 0 || rng() < 0.5)) return { type: 'redeemOrden', set: sets[0] };
      const where = pick(goalBorder.length ? goalBorder : border.length ? border : own);
      return { type: 'place', territory: where, count: s.reinforcements };
    }
    case 'attack': {
      if (s.pendingMove) return { type: 'occupy', count: s.pendingMove.max };
      // Angriffslimit der ersten Runde beachten
      if (s.turn <= s.order.length && (s.attacksThisTurn || 0) >= FIRST_ROUND_ATTACK_LIMIT) return { type: 'endAttack' };
      const options = [];
      for (const f of own) {
        if (s.territories[f].troops < 2) continue;
        for (const t of validAttackTargets(s, f)) {
          if (s.territories[f].troops > s.territories[t].troops) options.push([f, t]);
        }
      }
      if (!options.length) return { type: 'endAttack' };
      // Bollwerk bleibt defensiver (Truppen für „≥2"-Ziel halten), greift seltener an.
      const bollwerk = self.mission?.id === 'g_bollwerk';
      if ((bollwerk && rng() < 0.5) || rng() < 0.03) return { type: 'endAttack' };
      const pref = options.filter(([, t]) => advances(t));
      const [f, t] = pick(pref.length ? pref : options);
      return rng() < 0.6 ? { type: 'blitz', from: f, to: t } : { type: 'attack', from: f, to: t };
    }
    case 'fortify':
      return { type: 'endTurn' };
  }
  throw new Error(`unerwartete Phase ${s.phase}`);
}
