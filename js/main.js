// Steuerung: Startbildschirm, Lobby, Rollen (Host / Client / Lokal) und Speicherstand.

import { createGame, applyAction, currentPlayerId, viewFor, MAX_PLAYERS, MIN_PLAYERS } from './rules.js';
import { HostNet, ClientNet, makeCode, formatCode, normalizeCode } from './net.js';
import { GameView, esc } from './ui.js';

const root = document.getElementById('app');

const KEYS = {
  name: 'wh-name',
  hostSave: 'wh-host-save',
  lastCode: 'wh-last-code',
  session: 'wh-session',
  active: 'wh-active', // pro Tab: laufende Rolle, damit ein Neuladen automatisch wieder einsteigt
};

// localStorage/sessionStorage können blockiert sein (privates Fenster) – nie abstürzen
const safe = (storage) => ({
  get(k) { try { return storage.getItem(k); } catch { return null; } },
  set(k, v) { try { storage.setItem(k, v); } catch { /* egal */ } },
  del(k) { try { storage.removeItem(k); } catch { /* egal */ } },
});
const local = safe(window.localStorage);
// Session-ID pro Tab: überlebt ein Neuladen, aber zwei Tabs im selben Browser sind zwei Spieler
const session = safe(window.sessionStorage);

function getSessionId() {
  let id = session.get(KEYS.session);
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    session.set(KEYS.session, id);
  }
  return id;
}

const cleanName = (n) => String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Spieler';

const app = {
  screen: 'start', // start | lobby | game
  mode: null, // host | client | local
  code: null,
  myId: null,
  state: null,
  lobby: [], // Host: {id, name, sessionId, connected}; Client: öffentliche Liste vom Host
  conns: new Map(), // Host: playerId -> Verbindung
  net: null,
  view: null,
  status: '',
  ping: null,
  ordenMode: 'static', // Orden-Belohnung: 'static' | 'dynamic' (vor Spielstart wählbar)
  missions: true, // Missionen (nur wirksam ab 3 Spielern)
  general: false, // General-System (+1 auf höchsten Würfel, rückt mit)
};

// ================================================================== Start

function showStart(error = '') {
  app.screen = 'start';
  destroyView();
  const save = loadHostSave();
  const name = local.get(KEYS.name) || '';
  const lastCode = local.get(KEYS.lastCode) || '';
  const options = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS)
    .map((n) => `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n} Spieler</option>`)
    .join('');

  root.innerHTML = `
    <main class="start">
      <header class="hero">
        <h1>Weltherrschaft</h1>
        <p class="tagline">Erobere die Welt – mit Freunden, direkt im Browser.</p>
      </header>
      <label class="field">Dein Name
        <input id="name" maxlength="16" placeholder="z. B. Tobi" value="${esc(name)}" autocomplete="nickname">
      </label>
      <section class="card">
        <h2>Spiel hosten</h2>
        <p class="muted">Du bist Gastgeber. Dein Browser-Tab muss während des Spiels offen bleiben.</p>
        <button data-act="host">Neues Spiel hosten</button>
        ${save ? `<button class="secondary" data-act="resume">Gespeichertes Spiel fortsetzen (${formatCode(save.code)})</button>
                  <button class="ghost small" data-act="deleteSave">Speicherstand löschen</button>` : ''}
      </section>
      <section class="card">
        <h2>Beitreten</h2>
        <div class="row">
          <input id="code" placeholder="Raum-Code, z. B. KRTA-42" value="${esc(formatCode(lastCode))}" autocomplete="off">
          <button data-act="join">Beitreten</button>
        </div>
      </section>
      <section class="card">
        <h2>Lokal testen</h2>
        <p class="muted">Hot-Seat an einem Gerät, ganz ohne Netzwerk – ideal zum Ausprobieren.</p>
        <div class="row"><select id="localCount">${options}</select>
        <select id="localOrden" title="Orden-Belohnung">
          <option value="static">Orden: statisch</option>
          <option value="dynamic">Orden: dynamisch</option>
        </select>
        <select id="localMissions" title="Missionen (ab 3 Spielern)">
          <option value="on">Missionen: an</option>
          <option value="off">Missionen: aus</option>
        </select>
        <select id="localGeneral" title="General (+1 auf höchsten Würfel)">
          <option value="off">General: aus</option>
          <option value="on">General: an</option>
        </select>
        <button class="secondary" data-act="local">Starten</button></div>
      </section>
      <p class="error">${esc(error)}</p>
    </main>`;

  const main = root.querySelector('main');
  const readName = () => {
    const n = cleanName(main.querySelector('#name').value);
    local.set(KEYS.name, n);
    return n;
  };
  main.querySelector('#code').addEventListener('keydown', (e) => e.key === 'Enter' && main.querySelector('[data-act="join"]').click());
  main.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    try {
      if (act === 'host') startHost({ name: readName(), resume: false });
      if (act === 'resume') startHost({ name: readName(), resume: true });
      if (act === 'deleteSave' && confirm('Gespeichertes Spiel wirklich löschen?')) {
        local.del(KEYS.hostSave);
        showStart();
      }
      if (act === 'join') {
        const code = normalizeCode(main.querySelector('#code').value);
        if (code.length !== 6) return showStart('Bitte einen gültigen Raum-Code eingeben (4 Buchstaben + 2 Ziffern).');
        startClient(code, readName());
      }
      if (act === 'local') startLocal(Number(main.querySelector('#localCount').value), main.querySelector('#localOrden').value, main.querySelector('#localMissions').value === 'on', main.querySelector('#localGeneral').value === 'on');
    } catch (err) {
      showStart(err.message);
    }
  });
}

// ================================================================== Host

function loadHostSave() {
  try {
    const raw = local.get(KEYS.hostSave);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveHost() {
  local.set(
    KEYS.hostSave,
    JSON.stringify({
      code: app.code,
      myId: app.myId,
      lobby: app.lobby.map(({ id, name, sessionId }) => ({ id, name, sessionId })),
      state: app.state,
      savedAt: Date.now(),
    }),
  );
}

function startHost({ name, resume }) {
  const save = resume ? loadHostSave() : null;
  Object.assign(app, {
    mode: 'host',
    code: save?.code ?? makeCode(),
    myId: save?.myId ?? 'p1',
    state: save?.state ?? null,
    conns: new Map(),
    status: '',
    ping: null,
  });
  app.lobby = save?.lobby
    ? save.lobby.map((p) => ({ ...p, connected: p.id === app.myId }))
    : [{ id: 'p1', name, sessionId: getSessionId(), connected: true }];

  app.net = new HostNet({
    code: app.code,
    onStatus: (s) => { app.status = s; render(); },
    onMessage: hostOnMessage,
    onClose: hostOnClose,
  });
  app.net.start();
  session.set(KEYS.active, JSON.stringify({ role: 'host', name }));
  if (app.state) showGame();
  else { saveHost(); showLobby(); }
}

function publicLobby() {
  return app.lobby.map((p) => ({ id: p.id, name: p.name, connected: p.connected, isHost: p.id === app.myId }));
}

function uniqueName(name, selfId) {
  let n = name;
  let i = 2;
  while (app.lobby.some((p) => p.id !== selfId && p.name.toLowerCase() === n.toLowerCase())) n = `${name} ${i++}`;
  return n;
}

function nextPlayerId() {
  let i = 1;
  while (app.lobby.some((p) => p.id === `p${i}`)) i++;
  return `p${i}`;
}

function hostOnMessage(conn, msg) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.t === 'hello') {
    const sessionId = String(msg.sessionId || '');
    const name = cleanName(msg.name);
    // 1. per Session-ID wiedererkennen, 2. im laufenden Spiel: freien (offline) Platz mit gleichem Namen übernehmen
    let p = app.lobby.find((x) => x.sessionId === sessionId && x.id !== app.myId);
    if (!p && app.state) {
      p = app.lobby.find((x) => !x.connected && x.id !== app.myId && x.name.toLowerCase() === name.toLowerCase());
      if (p) p.sessionId = sessionId;
    }
    if (!p) {
      if (app.state) {
        return rejectConn(conn, 'Das Spiel läuft bereits. Zum Wiedereinstieg exakt denselben Namen wie vorher verwenden.');
      }
      if (app.lobby.length >= MAX_PLAYERS) return rejectConn(conn, 'Der Raum ist voll.');
      p = { id: nextPlayerId(), name: uniqueName(name), sessionId, connected: true };
      app.lobby.push(p);
    } else if (!app.state) {
      p.name = uniqueName(name, p.id);
    }
    const old = app.conns.get(p.id);
    if (old && old !== conn) old.close();
    app.conns.set(p.id, conn);
    conn.playerId = p.id;
    p.connected = true;
    app.net.send(conn, { t: 'welcome', playerId: p.id });
    hostChanged();
    return;
  }

  if (msg.t === 'action') {
    if (conn.playerId) hostApply(msg.action, conn.playerId, conn);
    return;
  }

  if (msg.t === 'ping') app.net.send(conn, { t: 'pong', ts: msg.ts });
}

function rejectConn(conn, reason) {
  app.net.send(conn, { t: 'reject', reason });
  setTimeout(() => conn.close(), 500);
}

function hostOnClose(conn) {
  const id = conn.playerId;
  if (!id || app.conns.get(id) !== conn) return;
  app.conns.delete(id);
  if (!app.state) {
    app.lobby = app.lobby.filter((p) => p.id !== id); // vor Spielstart einfach entfernen
  } else {
    const p = app.lobby.find((x) => x.id === id);
    if (p) p.connected = false;
  }
  hostChanged();
}

function hostApply(action, actorId, conn) {
  if (!app.state) return;
  if (action?.type === 'forceSkip' && actorId !== app.myId) {
    return conn && app.net.send(conn, { t: 'error', message: 'Nur der Host darf Züge überspringen.' });
  }
  const res = applyAction(app.state, action, actorId);
  if (res.error) {
    if (conn) app.net.send(conn, { t: 'error', message: res.error });
    else app.view?.showError(res.error);
    return;
  }
  app.state = res.state;
  hostChanged();
}

function hostChanged() {
  saveHost();
  // Jeder Client bekommt seine eigene gefilterte Sicht (fremde Geheimnisse ausgeblendet).
  // In der Lobby ist state noch null – dann wird wie bisher null gesendet.
  const lobby = publicLobby();
  for (const [pid, conn] of app.conns) {
    app.net?.send(conn, { t: 'sync', lobby, state: app.state ? viewFor(app.state, pid) : null });
  }
  render();
}

function hostStartGame() {
  const players = app.lobby.filter((p) => p.connected);
  if (players.length < MIN_PLAYERS) return;
  app.lobby = players;
  app.state = createGame(players.map(({ id, name }) => ({ id, name })), Math.random, { ordenMode: app.ordenMode, missions: app.missions, general: app.general });
  hostChanged();
  showGame();
}

// ================================================================== Client

function startClient(code, name) {
  Object.assign(app, { mode: 'client', code, myId: null, state: null, lobby: [], status: '', ping: null });
  local.set(KEYS.lastCode, code);
  app.net = new ClientNet({
    code,
    onOpen: () => app.net.send({ t: 'hello', name, sessionId: getSessionId() }),
    onMessage: clientOnMessage,
    onStatus: (s) => { app.status = s; render(); },
  });
  app.net.connect();
  session.set(KEYS.active, JSON.stringify({ role: 'client', code, name }));
  showLobby();
}

function clientOnMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'welcome':
      app.myId = msg.playerId;
      render();
      break;
    case 'sync':
      app.lobby = Array.isArray(msg.lobby) ? msg.lobby : [];
      app.state = msg.state ?? null;
      if (app.state && app.screen !== 'game') showGame();
      else render();
      break;
    case 'error':
      app.view?.showError(String(msg.message || 'Fehler'));
      break;
    case 'reject':
      leave(true);
      showStart(String(msg.reason || 'Beitritt abgelehnt.'));
      break;
    case 'pong':
      app.ping = Date.now() - Number(msg.ts);
      if (app.screen === 'lobby') render(); // im Spiel nicht bei jedem Ping neu zeichnen
      break;
  }
}

// ================================================================== Lokal (Hot-Seat)

function startLocal(count, ordenMode = 'static', missions = true, general = false) {
  const players = Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `Spieler ${i + 1}` }));
  Object.assign(app, { mode: 'local', code: null, myId: null, lobby: [], state: createGame(players, Math.random, { ordenMode, missions, general }) });
  showGame();
}

// ================================================================== Gemeinsam

function dispatch(action) {
  if (app.mode === 'local') {
    const res = applyAction(app.state, action, currentPlayerId(app.state));
    if (res.error) return app.view.showError(res.error);
    app.state = res.state;
    render();
  } else if (app.mode === 'host') {
    hostApply(action, app.myId, null);
  } else {
    app.net.send({ t: 'action', action });
  }
}

// Anzeige-Zustand: Host/Hot-Seat filtern selbst über viewFor; der Client bekommt
// bereits eine gefilterte Sicht vom Host.
function displayState() {
  if (!app.state) return null;
  if (app.mode === 'client') return app.state;
  const viewer = app.mode === 'host' ? app.myId : currentPlayerId(app.state);
  return viewFor(app.state, viewer);
}

function viewCtx() {
  return {
    state: displayState(),
    myId: app.myId,
    mode: app.mode,
    lobby: app.mode === 'host' ? publicLobby() : app.lobby,
    codeLabel: formatCode(app.code),
    status: app.status,
    ping: app.ping,
  };
}

function showGame() {
  app.screen = 'game';
  destroyView();
  app.view = new GameView(root, { dispatch, onLeave: () => leave() });
  app.view.update(viewCtx());
}

function showLobby() {
  app.screen = 'lobby';
  destroyView();
  renderLobby();
}

function destroyView() {
  app.view?.destroy();
  app.view = null;
}

function render() {
  if (app.screen === 'game' && app.state && app.view) app.view.update(viewCtx());
  else if (app.screen === 'lobby') renderLobby();
}

function renderLobby() {
  const isHost = app.mode === 'host';
  const players = isHost ? publicLobby() : app.lobby;
  const online = players.filter((p) => p.connected).length;

  root.innerHTML = `
    <main class="lobby">
      <h1>Lobby</h1>
      <section class="card">
        <div class="code-row"><span class="muted">Raum-Code</span>
          <strong class="code">${esc(formatCode(app.code))}</strong>
          ${isHost ? '<button class="ghost small" data-act="copy">Kopieren</button>' : ''}</div>
        <p class="status">${esc(app.status)}${app.ping != null ? ` · Ping ${app.ping} ms` : ''}</p>
      </section>
      <section class="card">
        <h2>Spieler (${players.length}/${MAX_PLAYERS})</h2>
        <ul class="lobby-players">
          ${players.map((p) => `<li><span class="pname">${esc(p.name)}</span>
              ${p.isHost ? '<span class="badge">Host</span>' : ''}
              ${p.id === app.myId ? '<span class="badge me">du</span>' : ''}
              <span class="conn ${p.connected ? 'on' : 'off'}">${p.connected ? 'verbunden' : 'offline'}</span></li>`).join('')
            || '<li class="muted">Noch niemand da …</li>'}
        </ul>
      </section>
      ${isHost
        ? `<section class="card">
             <label class="field">Orden-Belohnung
               <select id="ordenMode">
                 <option value="static"${app.ordenMode === 'static' ? ' selected' : ''}>statisch (immer gleich)</option>
                 <option value="dynamic"${app.ordenMode === 'dynamic' ? ' selected' : ''}>dynamisch (steigt je Einlösung)</option>
               </select>
             </label>
             <label class="field">Missionen
               <select id="missionsMode">
                 <option value="on"${app.missions ? ' selected' : ''}>an (geheime Ziele, ab 3 Spielern)</option>
                 <option value="off"${app.missions ? '' : ' selected'}>aus (klassischer Sieg: alle Gebiete)</option>
               </select>
             </label>
             <label class="field">General
               <select id="generalMode">
                 <option value="off"${app.general ? '' : ' selected'}>aus</option>
                 <option value="on"${app.general ? ' selected' : ''}>an (+1 auf höchsten Würfel, rückt mit)</option>
               </select>
             </label>
           </section>
           <button data-act="start" ${online < MIN_PLAYERS ? 'disabled' : ''}>Spiel starten</button>
           <p class="hint">Teile den Code mit deinen Freunden. Mindestens ${MIN_PLAYERS} Spieler.</p>`
        : `<p class="hint">${app.myId ? 'Du bist drin. Warte, bis der Host das Spiel startet …' : 'Verbinde mit dem Host …'}</p>`}
      <button class="ghost" data-act="leave">Verlassen</button>
    </main>`;

  const ordenSel = root.querySelector('#ordenMode');
  if (ordenSel) ordenSel.addEventListener('change', (e) => { app.ordenMode = e.target.value; });
  const missionsSel = root.querySelector('#missionsMode');
  if (missionsSel) missionsSel.addEventListener('change', (e) => { app.missions = e.target.value === 'on'; });
  const generalSel = root.querySelector('#generalMode');
  if (generalSel) generalSel.addEventListener('change', (e) => { app.general = e.target.value === 'on'; });

  root.querySelector('main').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'start') hostStartGame();
    if (act === 'leave') leave();
    if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(formatCode(app.code));
        btn.textContent = 'Kopiert ✓';
      } catch {
        btn.textContent = 'Bitte manuell kopieren';
      }
    }
  });
}

function leave(silent = false) {
  const running = app.state && app.state.phase !== 'gameover';
  if (!silent && app.mode !== 'local' && running) {
    const msg = app.mode === 'host'
      ? 'Spiel verlassen? Der Spielstand bleibt gespeichert und kann über „Fortsetzen“ weitergespielt werden.'
      : 'Spiel verlassen? Du kannst mit demselben Namen und Code wieder beitreten.';
    if (!confirm(msg)) return;
  }
  if (app.mode === 'host' && app.state?.phase === 'gameover') local.del(KEYS.hostSave);
  app.net?.destroy();
  session.del(KEYS.active);
  Object.assign(app, { mode: null, net: null, state: null, lobby: [], conns: new Map(), myId: null, code: null, ping: null, status: '' });
  if (!silent) showStart();
}

// Host warnen, bevor er den Tab schließt – sonst friert das Spiel für alle ein
window.addEventListener('beforeunload', (e) => {
  if (app.mode === 'host' && app.state && app.state.phase !== 'gameover') {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Nach einem Neuladen automatisch wieder einsteigen
function boot() {
  let active = null;
  try { active = JSON.parse(session.get(KEYS.active) || 'null'); } catch { /* ignorieren */ }
  try {
    if (active?.role === 'client' && active.code) return startClient(active.code, cleanName(active.name));
    if (active?.role === 'host' && loadHostSave()) return startHost({ name: cleanName(active.name), resume: true });
  } catch (err) {
    session.del(KEYS.active);
    return showStart(err.message);
  }
  showStart();
}

boot();
