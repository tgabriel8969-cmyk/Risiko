// Spielansicht: SVG-Karte, Aktions-Panel, Spielerliste, Protokoll.
// Die View kennt nur den Zustand und ruft dispatch(action) auf –
// ob die Aktion lokal oder über das Netzwerk läuft, entscheidet main.js.

import { TERRITORIES, TERRITORY_BY_ID, CONTINENTS, CONTINENT_TERRITORIES, EDGES, MAP_SIZE } from './map.js';
import { TERRITORY_SHAPES } from './shapes.js';
import {
  currentPlayerId, playerById, territoryName, calcReinforcements, validAttackTargets,
  reachableOwn, countTerritories, countTroops, SETUP_BATCH,
  ordenSets, ordenReward, ORDEN_TYPES, ORDEN_LABEL, ORDEN_DYNAMIC, ORDEN_STATIC_BONUS, ORDEN_FORCE_AT,
  missionProgress, missionName,
} from './rules.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Debug-Modus per ?debug=1 in der URL: Raster, Koordinaten und Gebiets-IDs.
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';

// Auto-Speichern der Debug-Bearbeitung (Steine, Grenzen, Seewege) im Browser
const DBG_KEY = 'wh-debug-map';
const dbgLoad = () => { try { return JSON.parse(localStorage.getItem(DBG_KEY) || 'null'); } catch { return null; } };
const dbgSave = (data) => { try { localStorage.setItem(DBG_KEY, JSON.stringify(data)); } catch { /* egal */ } };
const dbgClear = () => { try { localStorage.removeItem(DBG_KEY); } catch { /* egal */ } };

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
    this.debugPos = {}; // id -> {x,y} Overrides beim Verschieben im Debug-Modus
    this.shapeOverride = {}; // id -> [[x,y],...] bearbeitete Landflächen
    this.debugMode = 'tokens'; // 'tokens' | 'borders' | 'sea'
    this.editId = null; // Gebiet, dessen Eckpunkte gerade bearbeitet werden
    // Seewege (als dünne gestrichelte Linien gezeichnet), aus EDGES vorbelegt
    this.seaRoutes = EDGES.filter((e) => e[2] === 'sea').map((e) => [e[0], e[1]]);
    this.wrapRoutes = EDGES.filter((e) => e[2] === 'wrap').map((e) => [e[0], e[1]]);
    this.seaFrom = null; // erster Klick im Wasserwege-Modus
    // Gespeicherte Debug-Bearbeitung laden (nur im Debug-Modus, damit normales Spiel unberührt bleibt)
    if (DEBUG) {
      const saved = dbgLoad();
      if (saved) {
        this.debugPos = saved.debugPos || {};
        this.shapeOverride = saved.shapeOverride || {};
        if (Array.isArray(saved.seaRoutes)) this.seaRoutes = saved.seaRoutes;
      }
    }

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
          <div class="orden-tray" data-ref="ordenTray"></div>
        </div>
        <aside class="side">
          <section class="card panel" data-ref="panel"></section>
          <section class="card mission" data-ref="mission"></section>
          <section class="card" data-ref="players"></section>
          <section class="card log" data-ref="log"></section>
          <section class="card orden-info" data-ref="ordenInfo"></section>
        </aside>
        <div class="toast" data-ref="toast" role="status"></div>
      </div>`;

    this.$('map').addEventListener('click', (e) => {
      if (this._suppressClick) { this._suppressClick = false; return; } // war ein Drag
      if (DEBUG) this.debugClick(e);
      const g = e.target.closest('[data-terr]');
      if (g) this.onTerritory(g.dataset.terr);
    });
    if (DEBUG) this.setupDebug();
    this.$('panel').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && !b.disabled) this.onAct(b.dataset.act, b.dataset);
    });
    this.$('ordenTray').addEventListener('click', (e) => {
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
      this.hotseatMissionFor = null; // Hot-Seat: Mission beim Zug-/Phasenwechsel wieder verdecken
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
      case 'redeem':
        this.dispatch({ type: 'redeemOrden', set: (data.set || '').split(',') });
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

  // Effektive Gebietsposition (Override im Debug-Modus, sonst aus der Karte)
  posOf(id) {
    return this.debugPos[id] ?? TERRITORY_BY_ID[id];
  }

  // Effektive Landfläche (Override im Debug-Modus, sonst aus shapes.js)
  shapeOf(id) {
    return this.shapeOverride[id] ?? TERRITORY_SHAPES[id] ?? [];
  }

  // Bearbeitbare Kopie der Landfläche sicherstellen (die Importe bleiben unangetastet)
  ensureShape(id) {
    if (!this.shapeOverride[id]) this.shapeOverride[id] = this.shapeOf(id).map((p) => [...p]);
    return this.shapeOverride[id];
  }

  // Aktuelle Debug-Bearbeitung im Browser sichern
  saveDebug() {
    dbgSave({ debugPos: this.debugPos, shapeOverride: this.shapeOverride, seaRoutes: this.seaRoutes });
  }

  // Seewege als gestrichelte Linien: Wrap über den Kartenrand, sonst leichte Kurve
  seaRoutesSvg() {
    const W = MAP_SIZE.width;
    let s = '';
    for (const [a, b] of this.wrapRoutes) {
      const A = this.posOf(a);
      const B = this.posOf(b);
      const ym = (A.y + B.y) / 2;
      const [L, R] = A.x < B.x ? [A, B] : [B, A];
      s += `<line class="sea-route" x1="${L.x}" y1="${L.y}" x2="0" y2="${ym}"/>`;
      s += `<line class="sea-route" x1="${R.x}" y1="${R.y}" x2="${W}" y2="${ym}"/>`;
    }
    for (const [a, b] of this.seaRoutes) {
      const A = this.posOf(a);
      const B = this.posOf(b);
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const off = Math.min(38, len * 0.14);
      const cx = ((A.x + B.x) / 2 - (dy / len) * off).toFixed(1);
      const cy = ((A.y + B.y) / 2 + (dx / len) * off).toFixed(1);
      s += `<path class="sea-route" d="M${A.x},${A.y} Q${cx},${cy} ${B.x},${B.y}"/>`;
    }
    return s;
  }

  // Mausposition -> SVG-Koordinaten
  svgCoords(e) {
    const svg = this.$('map');
    const m = svg.getScreenCTM();
    if (!m) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const loc = pt.matrixTransform(m.inverse());
    return { x: loc.x, y: loc.y };
  }

  // Debug-Toolbar + Zeiger-Listener einrichten
  setupDebug() {
    const bar = document.createElement('div');
    bar.className = 'dbg-bar';
    this.renderDebugBar(bar);
    bar.addEventListener('click', (e) => {
      const act = e.target.closest('[data-dbg]')?.dataset.dbg;
      if (act === 'export') this.debugExport();
      else if (act === 'export-sea') this.debugExportSea();
      else if (act === 'reset') {
        if (!confirm('Alle gespeicherten Debug-Änderungen (Steine, Grenzen, Seewege) verwerfen und auf den Stand aus map.js/shapes.js zurücksetzen?')) return;
        dbgClear();
        this.debugPos = {};
        this.shapeOverride = {};
        this.seaRoutes = EDGES.filter((ed) => ed[2] === 'sea').map((ed) => [ed[0], ed[1]]);
        this.editId = null;
        this.seaFrom = null;
        this.renderMap();
      } else if (act && act.startsWith('mode-')) {
        this.debugMode = act.slice(5); // tokens | borders | sea
        this.editId = null;
        this.seaFrom = null;
        this.renderDebugBar(bar);
        this.renderMap();
      }
    });
    this.root.querySelector('.game').appendChild(bar);

    const svg = this.$('map');
    svg.addEventListener('pointerdown', (e) => this.debugPointerDown(e));
    svg.addEventListener('pointermove', (e) => this.debugPointerMove(e));
    svg.addEventListener('pointerup', (e) => this.debugPointerUp(e));
    svg.addEventListener('pointercancel', (e) => this.debugPointerUp(e));
    svg.addEventListener('contextmenu', (e) => this.debugContextMenu(e));
  }

  renderDebugBar(bar) {
    const mode = this.debugMode;
    const hints = {
      tokens: 'Steine ziehen',
      borders: 'Gebiet wählen · Eckpunkt ziehen · Kantenmitte = neuer Punkt · Rechtsklick löscht',
      sea: 'Zwei Gebiete nacheinander klicken = Seeweg an/aus',
    };
    const btn = (m, label) => `<button class="small ${mode === m ? 'active' : ''}" data-dbg="mode-${m}">${label}</button>`;
    bar.innerHTML = `
      <span class="dbg-seg">${btn('tokens', 'Steine')}${btn('borders', 'Grenzen')}${btn('sea', 'Wasserwege')}</span>
      <span class="dbg-hint">${hints[mode]}</span>
      <button class="small" data-dbg="export-sea">Seewege</button>
      <button class="small" data-dbg="export">Alles</button>
      <button class="small ghost" data-dbg="reset">Zurücksetzen</button>`;
  }

  debugPointerDown(e) {
    if (e.button != null && e.button !== 0) return; // nur linke Maustaste
    if (this.debugMode === 'borders') return this.borderPointerDown(e);
    if (this.debugMode === 'sea') return this.seaPointerDown(e);
    // Steine-Modus: Token ziehen
    const g = e.target.closest('[data-terr]');
    if (!g) return;
    const p = this.svgCoords(e);
    if (!p) return;
    const id = g.dataset.terr;
    const cur = this.posOf(id);
    this.drag = { kind: 'token', id, g, start: p, offX: cur.x - p.x, offY: cur.y - p.y, moved: false };
    this.$('map').setPointerCapture(e.pointerId);
  }

  borderPointerDown(e) {
    this._suppressClick = true; // im Grenzen-Modus keine Spielauswahl auslösen
    const p = this.svgCoords(e);
    if (!p) return;
    const vEl = e.target.closest('.dbg-vertex');
    const aEl = e.target.closest('.dbg-add');
    if (vEl && this.editId) {
      this.drag = { kind: 'vertex', id: this.editId, vi: +vEl.dataset.vi, start: p, moved: false };
      this.$('map').setPointerCapture(e.pointerId);
      return;
    }
    if (aEl && this.editId) {
      const i = +aEl.dataset.ai;
      const shape = this.ensureShape(this.editId);
      const a = shape[i];
      const b = shape[(i + 1) % shape.length];
      shape.splice(i + 1, 0, [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)]);
      this.drag = { kind: 'vertex', id: this.editId, vi: i + 1, start: p, moved: true };
      this.renderMap();
      this.$('map').setPointerCapture(e.pointerId);
      return;
    }
    // sonst: Gebiet zum Bearbeiten auswählen (bzw. abwählen)
    const g = e.target.closest('[data-terr]');
    const id = g ? g.dataset.terr : null;
    if (id !== this.editId) {
      this.editId = id;
      this.renderMap();
    }
  }

  debugPointerMove(e) {
    if (!this.drag) return;
    const p = this.svgCoords(e);
    if (!p) return;
    if (Math.hypot(p.x - this.drag.start.x, p.y - this.drag.start.y) > 2) this.drag.moved = true;
    if (this.drag.kind === 'token') {
      const x = Math.round(p.x + this.drag.offX);
      const y = Math.round(p.y + this.drag.offY);
      this.debugPos[this.drag.id] = { x, y };
      this.moveTokenDom(this.drag.g, x, y);
    } else if (this.drag.kind === 'vertex') {
      const shape = this.ensureShape(this.drag.id);
      shape[this.drag.vi] = [Math.round(p.x), Math.round(p.y)];
      this.renderMap();
    }
  }

  debugPointerUp(e) {
    if (!this.drag) return;
    this.$('map').releasePointerCapture?.(e.pointerId);
    if (this.drag.moved) { this._suppressClick = true; this.saveDebug(); }
    this.drag = null;
  }

  seaPointerDown(e) {
    this._suppressClick = true;
    const g = e.target.closest('[data-terr]');
    if (!g) { this.seaFrom = null; this.renderMap(); return; }
    const id = g.dataset.terr;
    if (!this.seaFrom || this.seaFrom === id) {
      this.seaFrom = this.seaFrom === id ? null : id;
    } else {
      this.toggleSea(this.seaFrom, id);
      this.seaFrom = null;
      this.saveDebug();
    }
    this.renderMap();
  }

  toggleSea(a, b) {
    const i = this.seaRoutes.findIndex(([x, y]) => (x === a && y === b) || (x === b && y === a));
    if (i >= 0) this.seaRoutes.splice(i, 1);
    else this.seaRoutes.push([a, b]);
  }

  debugContextMenu(e) {
    if (this.debugMode !== 'borders') return;
    const vEl = e.target.closest('.dbg-vertex');
    if (!vEl || !this.editId) return;
    e.preventDefault();
    const shape = this.ensureShape(this.editId);
    if (shape.length <= 3) return this.showError('Ein Gebiet braucht mindestens 3 Eckpunkte.');
    shape.splice(+vEl.dataset.vi, 1);
    this.saveDebug();
    this.renderMap();
  }

  // Token-SVG-Elemente direkt verschieben (ohne Neuaufbau, flüssiges Ziehen)
  moveTokenDom(g, x, y) {
    const set = (sel, ax, ay) => { const el = g.querySelector(sel); if (el) { el.setAttribute('x', ax); el.setAttribute('y', ay); } };
    const setC = (sel) => { const el = g.querySelector(sel); if (el) { el.setAttribute('cx', x); el.setAttribute('cy', y); } };
    setC('.hit'); setC('.token');
    set('.troops', x, y);
    set('.tname', x, y + 21);
  }

  // Nur die Seewege als 'sea'-Kanten – unabhängig von Steinen/Grenzen
  seaExportText() {
    const seaLines = this.seaRoutes.map(([a, b]) => `  ['${a}', '${b}', 'sea'],`).join('\n');
    return `// Seewege (${this.seaRoutes.length}) – in map.js EDGES als 'sea' eintragen:\n${seaLines}`;
  }

  debugExportSea() {
    this.showExport(`Seewege-Export · ${this.seaRoutes.length} Verbindungen`, this.seaExportText());
  }

  // Komplett: TERRITORIES (x/y) + TERRITORY_SHAPES (Eckpunkte) + Seewege
  debugExport() {
    const terrLines = TERRITORIES.map((t) => {
      const { x, y } = this.posOf(t.id);
      return `  { id: '${t.id}', name: '${t.name}', continent: '${t.continent}', x: ${Math.round(x)}, y: ${Math.round(y)} },`;
    }).join('\n');
    const shapeLines = TERRITORIES.map((t) => {
      const pts = this.shapeOf(t.id).map((p) => `[${Math.round(p[0])}, ${Math.round(p[1])}]`).join(', ');
      return `  ${t.id}: [${pts}],`;
    }).join('\n');
    const text =
      `export const TERRITORIES = [\n${terrLines}\n];\n\n` +
      `export const TERRITORY_SHAPES = {\n${shapeLines}\n};\n\n` +
      this.seaExportText();
    this.showExport(`Komplett-Export · ${this.seaRoutes.length} Seewege`, text);
  }

  // Export-Fenster anzeigen + in die Zwischenablage kopieren + in die Konsole loggen
  showExport(title, text) {
    console.log(text);
    navigator.clipboard?.writeText(text).catch(() => {});
    let ov = this.root.querySelector('.dbg-export');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'dbg-export';
      this.root.querySelector('.game').appendChild(ov);
    }
    ov.innerHTML = `<div class="dbg-export-inner">
      <div class="dbg-export-head"><strong>${esc(title)} · kopiert</strong>
        <button class="small ghost" data-dbg="close">Schließen</button></div>
      <textarea readonly>${esc(text)}</textarea></div>`;
    ov.querySelector('[data-dbg="close"]').addEventListener('click', () => ov.remove());
    const ta = ov.querySelector('textarea');
    ta.focus();
    ta.select();
  }

  // Debug: Klickposition in SVG-Koordinaten umrechnen, loggen und kopieren
  debugClick(e) {
    const p = this.svgCoords(e);
    if (!p) return;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const text = `x: ${x}, y: ${y}`;
    const g = e.target.closest('[data-terr]');
    console.log(`[debug] ${text}${g ? `  (${g.dataset.terr})` : ''}`);
    navigator.clipboard?.writeText(text).catch(() => {});
    this.showError(`📋 ${text}`);
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
    this.renderOrdenInfo();
    this.renderOrdenTray();
    this.renderMission();
  }

  // Missionskarte: Name, 3 Stufen mit Haken und Fortschritt. Eigene Mission bzw.
  // (Hot-Seat) die des Spielers am Zug – im Hot-Seat erst nach Klick, damit Mitspieler
  // am selben Bildschirm nicht mitlesen.
  renderMission() {
    const el = this.$('mission');
    const s = this.ctx.state;
    if (!s.missions) { el.hidden = true; return; }
    el.hidden = false;
    const me = this.me();

    if (s.phase === 'gameover') {
      const w = playerById(s, s.winner);
      const prog = missionProgress(s, s.winner);
      el.innerHTML = `<h3>Mission</h3><p class="mission-name">🏆 ${esc(w.name)}: ${esc(prog?.name || '')}</p>`;
      return;
    }

    // Missionswahl zu Spielbeginn: 2 Optionen zur Auswahl
    const meP = playerById(s, me);
    if (meP && !meP.mission && meP.missionOptions) {
      const opt = (m) => {
        const pr = missionProgress(s, me, m);
        const stages = pr ? `<span class="muted small">${esc(pr.stage1.text)}<br>${esc(pr.goal.text)}</span>` : '';
        return `<button class="mission-opt" data-pick="${m.id}">
            <strong>${esc(missionName(m, s))}</strong>${stages}</button>`;
      };
      el.innerHTML = `<h3>Mission wählen</h3>
        <p class="hint">Wähle eine von zwei geheimen Missionen:</p>
        <div class="mission-choice">${meP.missionOptions.map(opt).join('')}</div>`;
      el.querySelectorAll('[data-pick]').forEach((b) =>
        b.addEventListener('click', () => this.dispatch({ type: 'chooseMission', id: b.dataset.pick })));
      return;
    }

    // Hot-Seat: Mission verdeckt, bis der aktuelle Spieler sie einblendet
    if (this.ctx.mode === 'local' && this.hotseatMissionFor !== me) {
      el.innerHTML = `<h3>Mission</h3>
        <p class="hint">Geheime Mission von <strong>${esc(playerById(s, me)?.name || '')}</strong>.</p>
        <button class="secondary small" data-ref="revealMission">Mission anzeigen</button>`;
      el.querySelector('[data-ref="revealMission"]').addEventListener('click', () => {
        this.hotseatMissionFor = me;
        this.renderMission();
      });
      return;
    }

    const prog = missionProgress(s, me);
    if (!prog) { el.innerHTML = `<h3>Mission</h3><p class="muted small">Keine Mission.</p>`; return; }
    const done = (playerById(s, me).stagesDone) || [false, false];
    const row = (label, st, isDone) => `<li class="${isDone ? 'done' : ''}">
        <span class="ms-check">${isDone ? '✓' : '○'}</span>
        <span class="ms-text">${esc(st.text)}${st.detail ? ` <span class="muted">(${esc(st.detail)})</span>` : ''}</span></li>`;
    el.innerHTML = `<h3>Mission</h3>
      <p class="mission-name">${esc(prog.name)}</p>
      <ul class="mission-stages">
        ${row('E1', prog.stage1, done[0])}
        ${row('E2', prog.stage2, done[1])}
        ${row('Ziel', prog.goal, prog.goal.met)}
      </ul>
      ${this.ctx.mode === 'local' ? `<button class="ghost small" data-ref="hideMission">Verbergen</button>` : ''}`;
    const hide = el.querySelector('[data-ref="hideMission"]');
    if (hide) hide.addEventListener('click', () => { this.hotseatMissionFor = null; this.renderMission(); });
  }

  ordenIcon(type, size = 24) {
    return `<img class="orden-ic" src="assets/orden-${type}.png" width="${size}" height="${size}" alt="${esc(ORDEN_LABEL[type])}" title="${esc(ORDEN_LABEL[type])}" draggable="false">`;
  }

  renderOrdenInfo() {
    const s = this.ctx.state;
    let h = `<h3>Orden-Belohnung</h3>`;
    if (s.ordenMode === 'dynamic') {
      h += `<p class="small">Modus: <strong>dynamisch</strong> · nächste Einlösung: <strong>${ordenReward(s)}</strong> Einheiten</p>
            <p class="small muted">Staffelung: ${ORDEN_DYNAMIC.join(', ')}, dann +5 · bereits eingelöst: ${s.setsRedeemed}</p>`;
    } else {
      h += `<p class="small">Modus: <strong>statisch</strong> · pro Satz: <strong>${ORDEN_STATIC_BONUS}</strong> Einheiten</p>`;
    }
    h += `<p class="small muted">Ein Satz = 3 gleiche oder 3 verschiedene Orden. Pro Zug mit ≥1 Eroberung gibt es 1 Orden.</p>`;
    this.$('ordenInfo').innerHTML = h;
  }

  // Persönliche Orden-Ablage unter der Karte (größere Medaillen, zentriert).
  // Einlösen nur in der eigenen Verstärken-Phase.
  renderOrdenTray() {
    const s = this.ctx.state;
    const me = this.me();
    const hand = (me && playerById(s, me)?.orden) || [];
    const counts = {};
    for (const t of hand) counts[t] = (counts[t] || 0) + 1;
    const medals = ORDEN_TYPES.filter((t) => counts[t])
      .map((t) => `<span class="orden-chip big">${this.ordenIcon(t, 46)}${counts[t] > 1 ? `<b>×${counts[t]}</b>` : ''}</span>`).join('');

    const canRedeem = this.myTurn() && s.phase === 'reinforce';
    const sets = canRedeem ? ordenSets(hand) : [];
    const reward = ordenReward(s);
    const setLabel = (set) => (new Set(set).size === 1
      ? `3× ${ORDEN_LABEL[set[0]]}`
      : ORDEN_TYPES.map((t) => ORDEN_LABEL[t]).join(' + '));
    const btns = sets.map((set) => `<button class="seg-btn" data-act="redeem" data-set="${set.join(',')}">Einlösen: ${esc(setLabel(set))} · +${reward}</button>`).join('');
    const forced = canRedeem && hand.length >= ORDEN_FORCE_AT;

    let h = `<div class="orden-tray-label">Deine Orden${hand.length ? ` · ${hand.length}` : ''}</div>`;
    h += `<div class="orden-tray-hand">${hand.length ? medals : '<span class="muted small">noch keine – erobere ein Gebiet für einen Orden</span>'}</div>`;
    if (btns) h += `<div class="orden-tray-actions">${btns}</div>`;
    if (forced) h += `<div class="orden-tray-forced">Du hast ${hand.length} Orden – bitte einen Satz einlösen, bevor du angreifst.</div>`;
    // Missions-Etappe erreicht: Belohnung für die nächste Runde vor Augen halten
    const pendingStage = (me && playerById(s, me)?.stageBonus) || 0;
    if (pendingStage) h += `<div class="orden-tray-reward">🎯 Etappe erreicht: +${pendingStage} Einheiten für die nächste Runde</div>`;
    // Depeschen folgen in Schritt 4 und werden hier unter den Orden angezeigt
    this.$('ordenTray').innerHTML = h;
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
      <rect class="sea" width="${W}" height="${H}"/>
      <image href="assets/weltkarte.svg" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`;

    // Debug-Raster: 50-px-Gitter mit Koordinaten an den Achsen
    if (DEBUG) {
      for (let x = 0; x <= W; x += 50) out += `<line class="dbg-grid${x % 100 === 0 ? ' major' : ''}" x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
      for (let y = 0; y <= H; y += 50) out += `<line class="dbg-grid${y % 100 === 0 ? ' major' : ''}" x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;
      for (let x = 0; x <= W; x += 50) out += `<text class="dbg-axis" x="${x + 2}" y="11">${x}</text>`;
      for (let y = 50; y <= H; y += 50) out += `<text class="dbg-axis" x="3" y="${y - 3}">${y}</text>`;
    }

    // Seewege (gestrichelt) – Landgrenzen zeigt das aneinanderliegende Land selbst
    out += this.seaRoutesSvg();

    // Kontinent-Boni als Beschriftung
    for (const c of Object.values(CONTINENTS)) {
      out += `<text class="cont-label" x="${c.label.x}" y="${c.label.y}">${esc(c.name)} +${c.bonus}</text>`;
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
        DEBUG && this.debugMode === 'borders' && this.editId === t.id && 'editing',
        DEBUG && this.debugMode === 'sea' && this.seaFrom === t.id && 'selected',
      ]
        .filter(Boolean)
        .join(' ');
      const { x: tx, y: ty } = this.posOf(t.id);
      const pts = this.shapeOf(t.id).map((p) => p.join(',')).join(' ');
      out += `
        <g class="${cls}" data-terr="${t.id}">
          <polygon class="land" points="${pts}" fill="${CONTINENTS[t.continent].land}"/>
          <circle class="hit" cx="${tx}" cy="${ty}" r="15" fill="rgba(0,0,0,0)"/>
          <circle class="token" cx="${tx}" cy="${ty}" r="10" fill="${owner.color}"/>
          <text class="troops" x="${tx}" y="${ty}" fill="${textColorFor(owner.color)}">${st.troops}</text>
          <text class="tname" x="${tx}" y="${ty + 21}">${esc(t.name)}</text>
          <title>${esc(t.name)} – ${esc(owner.name)}, ${st.troops} Truppe(n)</title>
        </g>`;
    }

    // Debug „Grenzen": Eckpunkt-Griffe + Kantenmitten für das aktive Gebiet
    if (DEBUG && this.debugMode === 'borders' && this.editId) {
      const shape = this.shapeOf(this.editId);
      for (let i = 0; i < shape.length; i++) {
        const a = shape[i];
        const b = shape[(i + 1) % shape.length];
        out += `<circle class="dbg-add" data-ai="${i}" cx="${(a[0] + b[0]) / 2}" cy="${(a[1] + b[1]) / 2}" r="4"/>`;
      }
      shape.forEach((p, i) => {
        out += `<circle class="dbg-vertex" data-vi="${i}" cx="${p[0]}" cy="${p[1]}" r="5"/>`;
      });
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
      if (s.turnStageBonus) parts.push(`Missions-Etappe +${s.turnStageBonus}`);
      return `<p>Verstärkung: <strong>${s.reinforcements}</strong> Truppe(n) übrig.</p>
              <p class="small muted">Diesen Zug: ${parts.join(' · ')}</p>
              <p class="label">Pro Klick setzen:</p>${this.amountButtons([1, 3, 5, 'all'])}
              <p class="hint">Klicke auf eigene Gebiete${ordenSets(playerById(s, me).orden || []).length ? ' – oder löse unter der Karte einen Orden-Satz ein' : ''}.</p>`;
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
        const stages = p.stagesDone || [false, false];
        const missionDots = s.missions && p.alive
          ? ` <span class="mission-dots" title="Missionsfortschritt (Etappe 1, Etappe 2, Endziel)">${stages[0] ? '●' : '○'}${stages[1] ? '●' : '○'}${p.id === s.winner ? '●' : '○'}</span>`
          : '';
        return `<li class="${pid === cur && s.phase !== 'gameover' ? 'current' : ''} ${p.alive ? '' : 'dead'}">
          <span class="dot" style="background:${p.color}"></span>
          <span class="pname">${esc(p.name)}${you ? ' <em>(du)</em>' : ''}${lp?.isHost ? ' <span class="badge">Host</span>' : ''}${offline ? ' <span class="badge off">offline</span>' : ''}${p.alive && p.orden?.length ? ` <span class="orden-count" title="Orden">🎖 ${p.orden.length}</span>` : ''}${missionDots}</span>
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
