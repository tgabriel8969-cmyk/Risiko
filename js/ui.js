// Spielansicht: SVG-Karte, Aktions-Panel, Spielerliste, Protokoll.
// Die View kennt nur den Zustand und ruft dispatch(action) auf –
// ob die Aktion lokal oder über das Netzwerk läuft, entscheidet main.js.

import { TERRITORIES, TERRITORY_BY_ID, CONTINENTS, CONTINENT_TERRITORIES, EDGES, MAP_SIZE } from './map.js';
import {
  currentPlayerId, playerById, territoryName, calcReinforcements, validAttackTargets,
  reachableOwn, countTerritories, countTroops, SETUP_BATCH,
} from './rules.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PHASE_LABEL = {
  setup: 'Aufstellung',
  reinforce: 'Verstärken',
  attack: 'Angreifen',
  fortify: 'Verschieben',
  gameover: 'Spielende',
};

function textColorFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? '#14181f' : '#ffffff';
}

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export class GameView {
  constructor(root, { dispatch, onLeave }) {
    this.root = root;
    this._dispatch = dispatch;
    this.onLeave = onLeave;
    this.sel = { from: null, to: null };
    this.amount = 1;
    this.moveCount = null;
    this.phaseKey = null;

    root.innerHTML = `
      <div class="game">
        <header class="topbar">
          <div class="brand">Weltherrschaft</div>
          <div class="meta" data-ref="meta"></div>
          <button class="ghost small" data-ref="leave">Verlassen</button>
        </header>
        <div class="board">
          <svg data-ref="map" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_SIZE.width} ${MAP_SIZE.height}"
               role="img" aria-label="Weltkarte"></svg>
        </div>
        <aside class="side">
          <section class="card panel" data-ref="panel"></section>
          <section class="card" data-ref="players"></section>
          <section class="card log" data-ref="log"></section>
        </aside>
        <div class="toast" data-ref="toast" role="status"></div>
      </div>`;

    this.$('map').addEventListener('click', (e) => {
      const g = e.target.closest('[data-terr]');
      if (g) this.onTerritory(g.dataset.terr);
    });
    this.$('panel').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled) this.onAct(b.dataset.act, b.dataset);
    });
    this.$('panel').addEventListener('input', (e) => {
      if (e.target.matches('[data-range]')) {
        this.moveCount = Number(e.target.value);
        const out = this.$('panel').querySelector('[data-out]');
        if (out) out.textContent = this.moveCount;
      }
    });
    this.$('leave').addEventListener('click', () => this.onLeave());
    this._onKey = (e) => e.key === 'Escape' && this.clearSel();
    document.addEventListener('keydown', this._onKey);
  }

  $(name) {
    return this.root.querySelector(`[data-ref="${name}"]`);
  }

  destroy() {
    document.removeEventListener('keydown', this._onKey);
    clearTimeout(this.toastTimer);
  }

  // ---------------------------------------------------------------- Zustand

  update(ctx) {
    this.ctx = ctx;
    const s = ctx.state;
    const key = `${s.turn}|${s.phase}|${s.current}`;
    if (key !== this.phaseKey) {
      this.sel = { from: null, to: null };
      this.moveCount = null;
      this.phaseKey = key;
    }
    this.validateSel();
    this.render();
  }

  me() {
    return this.ctx.mode === 'local' ? currentPlayerId(this.ctx.state) : this.ctx.myId;
  }

  myTurn() {
    const s = this.ctx.state;
    return s.phase !== 'gameover' && currentPlayerId(s) === this.me();
  }

  validateSel() {
    const s = this.ctx.state;
    const me = this.me();
    const f = this.sel.from && s.territories[this.sel.from];
    if (!f || f.owner !== me || f.troops < 2) {
      this.sel = { from: null, to: null };
      return;
    }
    if (this.sel.to) {
      const t = s.territories[this.sel.to];
      const okAttack = s.phase === 'attack' && t.owner !== me && validAttackTargets(s, this.sel.from).has(this.sel.to);
      const okFortify = s.phase === 'fortify' && t.owner === me && reachableOwn(s, this.sel.from).has(this.sel.to);
      if (!okAttack && !okFortify) this.sel.to = null;
    }
  }

  clearSel() {
    this.sel = { from: null, to: null };
    this.moveCount = null;
    if (this.ctx) this.render();
  }

  dispatch(action) {
    if (action.type === 'occupy' || action.type === 'fortify') this.moveCount = null;
    this._dispatch(action);
  }

  placeLimit() {
    const s = this.ctx.state;
    const me = this.me();
    if (s.phase === 'setup') return Math.min(SETUP_BATCH - s.setupPlacedThisTurn, s.setupRemaining[me] || 0);
    if (s.phase === 'reinforce') return s.reinforcements;
    return 0;
  }

  // ---------------------------------------------------------------- Eingaben

  onTerritory(id) {
    if (!this.ctx || !this.myTurn()) return;
    const s = this.ctx.state;
    const me = this.me();
    const t = s.territories[id];

    if (s.phase === 'setup' || s.phase === 'reinforce') {
      if (t.owner !== me) return this.showError('Du kannst nur auf eigene Gebiete setzen.');
      const limit = this.placeLimit();
      const count = this.amount === 'all' ? limit : Math.min(this.amount, limit);
      if (count >= 1) this.dispatch({ type: 'place', territory: id, count });
      return;
    }

    if (s.phase === 'attack') {
      if (s.pendingMove) return this.showError('Lege zuerst fest, wie viele Truppen nachrücken.');
      if (t.owner === me) {
        if (t.troops < 2) return this.showError('Zum Angreifen braucht ein Gebiet mindestens 2 Truppen.');
        this.sel = this.sel.from === id ? { from: null, to: null } : { from: id, to: null };
      } else if (this.sel.from) {
        if (!validAttackTargets(s, this.sel.from).has(id)) {
          return this.showError('Dieses Gebiet grenzt nicht an dein ausgewähltes Gebiet.');
        }
        this.sel.to = id;
      } else {
        return this.showError('Wähle zuerst eines deiner Gebiete als Angreifer.');
      }
      this.render();
      return;
    }

    if (s.phase === 'fortify') {
      if (t.owner !== me) return;
      if (!this.sel.from || this.sel.to) {
        if (t.troops < 2) return this.showError('Von hier kann nichts abgezogen werden (nur 1 Truppe).');
        this.sel = { from: id, to: null };
      } else if (id === this.sel.from) {
        this.sel = { from: null, to: null };
      } else {
        if (!reachableOwn(s, this.sel.from).has(id)) return this.showError('Kein Weg über eigene Gebiete dorthin.');
        this.sel.to = id;
        this.moveCount = s.territories[this.sel.from].troops - 1;
      }
      this.render();
    }
  }

  onAct(act, data) {
    const s = this.ctx.state;
    const { from, to } = this.sel;
    switch (act) {
      case 'amount':
        this.amount = data.value === 'all' ? 'all' : Number(data.value);
        this.renderPanel();
        break;
      case 'attack':
        this.dispatch({ type: 'attack', from, to, dice: Number(data.dice) });
        break;
      case 'blitz':
        this.dispatch({ type: 'blitz', from, to });
        break;
      case 'cancel':
        this.clearSel();
        break;
      case 'endAttack':
        this.dispatch({ type: 'endAttack' });
        break;
      case 'occupy': {
        const pm = s.pendingMove;
        this.dispatch({ type: 'occupy', count: clamp(this.moveCount ?? pm.max, pm.min, pm.max) });
        break;
      }
      case 'fortify':
        this.dispatch({ type: 'fortify', from, to, count: this.moveCount });
        break;
      case 'endTurn':
        this.dispatch({ type: 'endTurn' });
        break;
      case 'skip': {
        const name = playerById(s, currentPlayerId(s)).name;
        if (confirm(`${name} wirklich überspringen?`)) this.dispatch({ type: 'forceSkip' });
        break;
      }
      case 'home':
        this.onLeave();
        break;
    }
  }

  showError(msg) {
    const el = this.$('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
  }

  // ---------------------------------------------------------------- Rendern

  render() {
    this.renderMeta();
    this.renderMap();
    this.renderPanel();
    this.renderPlayers();
    this.renderLog();
  }

  renderMeta() {
    const c = this.ctx;
    this.$('meta').innerHTML =
      c.mode === 'local'
        ? 'Lokaler Test (Hot-Seat)'
        : `Raum <strong>${esc(c.codeLabel)}</strong> · ${esc(c.status || '')}${c.ping != null ? ` · ${c.ping} ms` : ''}`;
  }

  renderMap() {
    const s = this.ctx.state;
    const me = this.me();
    const mine = this.myTurn();
    const { width: W, height: H } = MAP_SIZE;
    const TB = TERRITORY_BY_ID;

    let targets = new Set();
    let reach = new Set();
    if (mine && this.sel.from) {
      if (s.phase === 'attack') targets = validAttackTargets(s, this.sel.from);
      if (s.phase === 'fortify' && !this.sel.to) reach = reachableOwn(s, this.sel.from);
    }
    const pm = s.pendingMove;

    let out = `
      <defs>
        <marker id="arrowhead" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#ffffff"/>
        </marker>
      </defs>
      <rect class="sea" width="${W}" height="${H}"/>`;

    // Gradnetz für den Landkarten-Look
    for (let x = 100; x < W; x += 100) out += `<line class="graticule" x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
    for (let y = 90; y < H; y += 90) out += `<line class="graticule" x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;

    // Kontinente als weiche Flächen
    for (const [cid, c] of Object.entries(CONTINENTS)) {
      out += `<g class="continent" fill="${c.color}">`;
      for (const tid of CONTINENT_TERRITORIES[cid]) out += `<circle cx="${TB[tid].x}" cy="${TB[tid].y}" r="50"/>`;
      out += `</g>`;
      out += `<text class="cont-label" x="${c.label.x}" y="${c.label.y}" fill="${c.color}">${esc(c.name)} +${c.bonus}</text>`;
    }

    // Verbindungen
    for (const [a, b, kind] of EDGES) {
      const A = TB[a];
      const B = TB[b];
      if (kind === 'wrap') {
        const ym = (A.y + B.y) / 2;
        const [L, R] = A.x < B.x ? [A, B] : [B, A];
        out += `<line class="edge sea-route" x1="${L.x}" y1="${L.y}" x2="0" y2="${ym}"/>`;
        out += `<line class="edge sea-route" x1="${R.x}" y1="${R.y}" x2="${W}" y2="${ym}"/>`;
      } else {
        out += `<line class="edge${kind === 'sea' ? ' sea-route' : ''}" x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}"/>`;
      }
    }

    // Letzter Angriff als Pfeil
    const c = s.lastCombat;
    if (c) {
      const A = TB[c.from];
      const B = TB[c.to];
      const color = playerById(s, c.attacker)?.color ?? '#fff';
      const arrow = (x1, y1, x2, y2, startPad, endPad, head) => {
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const ux = (x2 - x1) / len;
        const uy = (y2 - y1) / len;
        return `<line class="combat-arrow" stroke="${color}" ${head ? 'marker-end="url(#arrowhead)"' : ''}
          x1="${x1 + ux * startPad}" y1="${y1 + uy * startPad}" x2="${x2 - ux * endPad}" y2="${y2 - uy * endPad}"/>`;
      };
      if (Math.abs(B.x - A.x) > W / 2) {
        // Angriff über den Kartenrand: zum Rand hinaus, auf der anderen Seite wieder herein
        const ym = (A.y + B.y) / 2;
        const exitX = A.x < B.x ? 0 : W;
        out += arrow(A.x, A.y, exitX, ym, 24, 0, false) + arrow(W - exitX, ym, B.x, B.y, 0, 27, true);
      } else {
        out += arrow(A.x, A.y, B.x, B.y, 24, 27, true);
      }
    }

    // Gebiete
    for (const t of TERRITORIES) {
      const st = s.territories[t.id];
      const owner = playerById(s, st.owner);
      const own = st.owner === me;
      const clickable =
        mine &&
        (((s.phase === 'setup' || s.phase === 'reinforce') && own) ||
          (s.phase === 'attack' && !pm && ((own && st.troops >= 2) || targets.has(t.id))) ||
          (s.phase === 'fortify' && own));
      const cls = [
        'terr',
        clickable && 'clickable',
        this.sel.from === t.id && 'selected',
        this.sel.to === t.id && (s.phase === 'attack' ? 'target' : 'selected'),
        (targets.has(t.id) || reach.has(t.id)) && this.sel.to !== t.id && 'candidate',
        pm && (pm.from === t.id || pm.to === t.id) && 'selected',
      ]
        .filter(Boolean)
        .join(' ');
      out += `
        <g class="${cls}" data-terr="${t.id}">
          <circle class="hit" cx="${t.x}" cy="${t.y}" r="28" fill="rgba(0,0,0,0)"/>
          <circle class="token" cx="${t.x}" cy="${t.y}" r="19" fill="${owner.color}"/>
          <text class="troops" x="${t.x}" y="${t.y + 5}" fill="${textColorFor(owner.color)}">${st.troops}</text>
          <text class="tname" x="${t.x}" y="${t.y + 34}">${esc(t.name)}</text>
          <title>${esc(t.name)} – ${esc(owner.name)}, ${st.troops} Truppe(n)</title>
        </g>`;
    }

    this.$('map').innerHTML = out;
  }

  renderPanel() {
    const s = this.ctx.state;
    const cur = currentPlayerId(s);
    const curP = playerById(s, cur);
    const mine = this.myTurn();
    let h;

    if (s.phase === 'gameover') {
      const w = playerById(s, s.winner);
      h = `<div class="winner"><span class="dot big" style="background:${w.color}"></span>
             <div><strong>${esc(w.name)}</strong> hat die Welt erobert!</div></div>
           <button data-act="home">Zurück zum Start</button>`;
    } else {
      h = `<div class="turn-head">
             <span class="dot big" style="background:${curP.color}"></span>
             <div><div class="who">${esc(curP.name)}${mine && this.ctx.mode !== 'local' ? ' (du)' : ''}</div>
             <div class="phase">${PHASE_LABEL[s.phase]} · Zug ${s.turn}</div></div>
           </div>`;
      if (!mine) {
        h += `<p class="hint">Warte auf ${esc(curP.name)} …</p>`;
        if (this.ctx.mode === 'host') {
          h += `<button class="ghost small" data-act="skip">Zug überspringen</button>`;
        }
      } else {
        h += this.phasePanel();
      }
    }
    h += this.combatHtml();
    this.$('panel').innerHTML = h;
  }

  amountButtons(options) {
    return `<div class="seg" role="group" aria-label="Anzahl pro Klick">${options
      .map((v) => {
        const label = v === 'all' ? 'Alle' : v;
        const active = this.amount === v ? ' active' : '';
        return `<button class="seg-btn${active}" data-act="amount" data-value="${v}">${label}</button>`;
      })
      .join('')}</div>`;
  }

  phasePanel() {
    const s = this.ctx.state;
    const me = this.me();
    const tn = (id) => `<strong>${esc(territoryName(id))}</strong>`;
    const { from, to } = this.sel;

    if (s.phase === 'setup') {
      return `<p>Setze noch <strong>${this.placeLimit()}</strong> Truppe(n) in diesem Durchgang
                (insgesamt ${s.setupRemaining[me]} übrig).</p>
              <p class="label">Pro Klick setzen:</p>${this.amountButtons([1, 'all'])}
              <p class="hint">Klicke auf eigene Gebiete.</p>`;
    }

    if (s.phase === 'reinforce') {
      const r = calcReinforcements(s, me);
      const parts = [`${r.base} für ${r.territories} Gebiete`, ...r.bonuses.map((b) => `${esc(b.name)} +${b.bonus}`)];
      return `<p>Verstärkung: <strong>${s.reinforcements}</strong> Truppe(n) übrig.</p>
              <p class="small muted">Diesen Zug: ${parts.join(' · ')}</p>
              <p class="label">Pro Klick setzen:</p>${this.amountButtons([1, 3, 5, 'all'])}
              <p class="hint">Klicke auf eigene Gebiete.</p>`;
    }

    if (s.phase === 'attack') {
      const endBtn = `<button class="secondary" data-act="endAttack">Angriffe beenden →</button>`;
      if (s.pendingMove) {
        const pm = s.pendingMove;
        const v = clamp(this.moveCount ?? pm.max, pm.min, pm.max);
        this.moveCount = v;
        return `<p>${tn(pm.to)} erobert! Wie viele Truppen rücken nach?</p>
                <div class="range"><input type="range" data-range min="${pm.min}" max="${pm.max}" value="${v}">
                <output data-out>${v}</output></div>
                <button data-act="occupy">Nachrücken</button>`;
      }
      if (from && to) {
        const f = s.territories[from];
        const t = s.territories[to];
        const maxDice = Math.min(3, f.troops - 1);
        const diceBtns = [1, 2, 3]
          .filter((d) => d <= maxDice)
          .map((d) => `<button class="seg-btn" data-act="attack" data-dice="${d}">${d} Würfel</button>`)
          .join('');
        return `<p class="matchup">${tn(from)} (${f.troops}) → ${tn(to)} (${t.troops})</p>
                <div class="seg">${diceBtns}</div>
                <div class="row"><button class="warn" data-act="blitz">Blitz-Angriff</button>
                <button class="ghost" data-act="cancel">Abbrechen</button></div>${endBtn}`;
      }
      if (from) {
        const none = validAttackTargets(s, from).size === 0;
        return `<p>Angreifer: ${tn(from)} (${s.territories[from].troops}).
                ${none ? 'Keine feindlichen Nachbarn.' : 'Wähle ein markiertes feindliches Nachbargebiet.'}</p>
                <button class="ghost" data-act="cancel">Abbrechen</button>${endBtn}`;
      }
      return `<p>Wähle eines deiner Gebiete mit mindestens 2 Truppen als Angreifer.</p>${endBtn}`;
    }

    if (s.phase === 'fortify') {
      const endBtn = `<button class="secondary" data-act="endTurn">Zug beenden</button>`;
      if (from && to) {
        const max = s.territories[from].troops - 1;
        const v = clamp(this.moveCount ?? max, 1, max);
        this.moveCount = v;
        return `<p>Von ${tn(from)} nach ${tn(to)} verschieben:</p>
                <div class="range"><input type="range" data-range min="1" max="${max}" value="${v}">
                <output data-out>${v}</output></div>
                <div class="row"><button data-act="fortify">Verschieben &amp; Zug beenden</button>
                <button class="ghost" data-act="cancel">Abbrechen</button></div>`;
      }
      if (from) return `<p>Von ${tn(from)} aus: Wähle ein markiertes eigenes Gebiet.</p>
                        <button class="ghost" data-act="cancel">Abbrechen</button>${endBtn}`;
      return `<p>Optional: Einmal Truppen zwischen verbundenen eigenen Gebieten verschieben.</p>${endBtn}`;
    }
    return '';
  }

  combatHtml() {
    const s = this.ctx.state;
    const c = s.lastCombat;
    if (!c) return '';
    const dice = (arr, cls) => arr.map((d) => `<span class="die ${cls}">${d}</span>`).join('');
    const att = playerById(s, c.attacker);
    const def = playerById(s, c.defender);
    return `<div class="combat">
      <div class="combat-title">Letzter Kampf: ${esc(territoryName(c.from))} → ${esc(territoryName(c.to))}
        ${c.rounds > 1 ? `<span class="muted">(Blitz, ${c.rounds} Runden – letzte Runde)</span>` : ''}</div>
      <div class="dice"><span class="lbl"><span class="dot" style="background:${att.color}"></span>${esc(att.name)}</span>${dice(c.att, 'att')}</div>
      <div class="dice"><span class="lbl"><span class="dot" style="background:${def.color}"></span>${esc(def.name)}</span>${dice(c.def, 'def')}</div>
      <div class="small">Verluste: Angreifer −${c.attLoss}, Verteidiger −${c.defLoss}${c.conquered ? ' · <strong>erobert!</strong>' : ''}</div>
    </div>`;
  }

  renderPlayers() {
    const s = this.ctx.state;
    const cur = currentPlayerId(s);
    const lobby = this.ctx.lobby || [];
    const rows = s.order
      .map((pid) => {
        const p = playerById(s, pid);
        const lp = lobby.find((l) => l.id === pid);
        const offline = this.ctx.mode !== 'local' && lp && !lp.connected;
        const you = this.ctx.mode !== 'local' && pid === this.ctx.myId;
        return `<li class="${pid === cur && s.phase !== 'gameover' ? 'current' : ''} ${p.alive ? '' : 'dead'}">
          <span class="dot" style="background:${p.color}"></span>
          <span class="pname">${esc(p.name)}${you ? ' <em>(du)</em>' : ''}${lp?.isHost ? ' <span class="badge">Host</span>' : ''}${offline ? ' <span class="badge off">offline</span>' : ''}</span>
          <span class="stats">${p.alive ? `${countTerritories(s, pid)} Geb. · ${countTroops(s, pid)} Tr.` : 'ausgeschieden'}</span>
        </li>`;
      })
      .join('');
    this.$('players').innerHTML = `<h3>Spieler</h3><ul class="player-list">${rows}</ul>`;
  }

  renderLog() {
    const entries = this.ctx.state.log
      .slice(-40)
      .reverse()
      .map((e) => `<li><span class="muted">${e.turn}</span> ${esc(e.text)}</li>`)
      .join('');
    this.$('log').innerHTML = `<h3>Protokoll</h3><ol class="log-list">${entries}</ol>`;
  }
}
