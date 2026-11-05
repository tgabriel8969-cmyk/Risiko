// Peer-to-Peer-Netzwerk über PeerJS (WebRTC).
// Der Host-Browser ist der Schiedsrichter; Clients schicken nur Aktionen.
// PeerJS nutzt für den Verbindungsaufbau einen kostenlosen öffentlichen Vermittlungsserver,
// die Spieldaten selbst laufen danach direkt zwischen den Browsern.
//
// Nachrichten Client -> Host:  hello {name, sessionId} | action {action} | ping {ts}
// Nachrichten Host -> Client:  welcome {playerId} | sync {lobby, state} | error {message}
//                              reject {reason} | pong {ts}

const PREFIX = 'weltherrschaft-v1-'; // macht unsere Raum-IDs auf dem öffentlichen Server eindeutig
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // ohne I/O (Verwechslungsgefahr)
const RETRY_MS = 3000;
const OPEN_TIMEOUT_MS = 15000;

export function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s + String(10 + Math.floor(Math.random() * 90));
}
export const formatCode = (c) => (c ? `${c.slice(0, 4)}-${c.slice(4)}` : '');
export const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function requirePeer() {
  if (typeof window.Peer !== 'function') {
    throw new Error('PeerJS konnte nicht geladen werden. Bitte Internetverbindung prüfen und neu laden.');
  }
}

// ------------------------------------------------------------------ Host

export class HostNet {
  constructor({ code, onReady, onMessage, onClose, onStatus }) {
    Object.assign(this, { code, onReady, onMessage, onClose, onStatus });
    this.conns = new Set();
    this.retries = 0;
    this.destroyed = false;
  }

  start() {
    requirePeer();
    this.onStatus?.('Verbinde mit Vermittlungsserver …');
    const peer = new window.Peer(PREFIX + this.code);
    this.peer = peer;

    peer.on('open', () => {
      if (this.peer !== peer) return;
      this.retries = 0;
      this.onStatus?.('Bereit – warte auf Mitspieler');
      this.onReady?.();
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => this.conns.add(conn));
      conn.on('data', (data) => this.onMessage?.(conn, data));
      conn.on('close', () => {
        this.conns.delete(conn);
        this.onClose?.(conn);
      });
      conn.on('error', () => {}); // 'close' folgt
    });

    peer.on('disconnected', () => {
      if (this.peer !== peer || this.destroyed) return;
      // Bestehende Spielverbindungen laufen weiter, nur neue Beitritte gehen nicht.
      this.onStatus?.('Vermittlungsserver getrennt – verbinde neu …');
      setTimeout(() => {
        if (this.peer === peer && !this.destroyed && peer.disconnected && !peer.destroyed) peer.reconnect();
      }, RETRY_MS);
    });

    peer.on('error', (err) => {
      if (this.peer !== peer || this.destroyed) return;
      if (err.type === 'unavailable-id' && this.retries < 10) {
        // Passiert nach einem Neuladen: der Server hält die alte ID noch kurz fest.
        this.retries++;
        this.onStatus?.(`Raum-Code noch belegt, neuer Versuch (${this.retries}/10) …`);
        peer.destroy();
        setTimeout(() => !this.destroyed && this.start(), RETRY_MS);
        return;
      }
      this.onStatus?.(`Netzwerkfehler: ${err.type || err.message}`);
    });
  }

  send(conn, msg) {
    if (conn?.open) conn.send(msg);
  }

  broadcast(msg) {
    for (const c of this.conns) this.send(c, msg);
  }

  destroy() {
    this.destroyed = true;
    this.peer?.destroy();
  }
}

// ------------------------------------------------------------------ Client

export class ClientNet {
  constructor({ code, onOpen, onMessage, onStatus }) {
    Object.assign(this, { code, onOpen, onMessage, onStatus });
    this.destroyed = false;
  }

  connect() {
    requirePeer();
    this.onStatus?.('Verbinde …');
    const peer = new window.Peer();
    this.peer = peer;
    peer.on('open', () => this._dial());
    peer.on('disconnected', () => {
      if (!this.destroyed && !peer.destroyed) setTimeout(() => peer.disconnected && peer.reconnect(), RETRY_MS);
    });
    peer.on('error', (err) => {
      if (this.destroyed) return;
      if (err.type === 'peer-unavailable') {
        this.onStatus?.('Host nicht erreichbar (Code richtig? Host-Tab offen?) – neuer Versuch …');
      } else {
        this.onStatus?.(`Verbindungsfehler: ${err.type || err.message} – neuer Versuch …`);
      }
      this._scheduleRedial();
    });
  }

  _dial() {
    if (this.destroyed) return;
    clearTimeout(this.redialTimer);
    clearTimeout(this.openTimer);
    if (this.peer.disconnected) {
      this._scheduleRedial();
      return;
    }
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true });
    this.conn = conn;

    // Kommt keine Direktverbindung zustande (strenge Firewall/NAT), meldet WebRTC oft gar nichts.
    this.openTimer = setTimeout(() => {
      if (this.conn === conn && !conn.open && !this.destroyed) {
        this.onStatus?.('Keine Direktverbindung möglich (Firewall/NAT?) – neuer Versuch …');
        conn.close();
        this._scheduleRedial();
      }
    }, OPEN_TIMEOUT_MS);

    conn.on('open', () => {
      if (this.conn !== conn) return;
      clearTimeout(this.openTimer);
      this.onStatus?.('Verbunden');
      this.onOpen?.();
      this._startPing();
    });
    conn.on('data', (data) => {
      if (this.conn === conn) this.onMessage?.(data);
    });
    conn.on('close', () => {
      if (this.conn !== conn || this.destroyed) return;
      this._stopPing();
      this.onStatus?.('Verbindung verloren – verbinde neu …');
      this._scheduleRedial();
    });
    conn.on('error', () => {});
  }

  _scheduleRedial() {
    clearTimeout(this.redialTimer);
    this.redialTimer = setTimeout(() => this._dial(), RETRY_MS);
  }

  _startPing() {
    this._stopPing();
    const ping = () => this.send({ t: 'ping', ts: Date.now() });
    ping();
    this.pingTimer = setInterval(ping, 3000);
  }

  _stopPing() {
    clearInterval(this.pingTimer);
  }

  send(msg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.redialTimer);
    clearTimeout(this.openTimer);
    this._stopPing();
    this.peer?.destroy();
  }
}
