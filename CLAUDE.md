# CLAUDE.md – Hinweise für Claude Code

Browser-Eroberungsspiel für 2–7 Spieler, Peer-to-Peer über PeerJS (WebRTC). Kein Backend, kein Build-Schritt.

## Grundsätze (bitte einhalten)

- **Host ist Schiedsrichter.** Clients schicken nur Absichten (`{t:'action', action}`), der Host prüft mit `applyAction` und verteilt den kompletten Zustand (`{t:'sync'}`). Niemals Würfel oder Regeln im Client auswerten.
- **Spiellogik bleibt rein.** `js/rules.js` und `js/map.js` haben keinen DOM- und keinen Netzwerkzugriff. `applyAction(state, action, actorId, rng)` gibt `{state}` oder `{error}` zurück und verändert den Eingabezustand nie (structuredClone).
- **Neue Regeln = neuer Handler in `HANDLERS`** (rules.js) + Test in `tests/rules.test.js` + ggf. Bot-Zug in der Simulation.
- **Kein Build-Tool.** Native ES-Module, Abhängigkeiten nur per CDN (PeerJS über unpkg). Läuft so auf GitHub Pages.
- **UI-Texte auf Deutsch.** Fehlermeldungen aus rules.js werden direkt angezeigt.
- Spielernamen und alles von anderen Peers immer mit `esc()` ausgeben (XSS).

## Befehle

```bash
npm test     # node --test: Karte, Regeln, 60 Zufallspartien
npm start    # lokaler Server auf http://localhost:8080
```
Zum schnellen Ausprobieren im Browser: Startbildschirm → „Lokal testen“ (Hot-Seat, ohne Netzwerk).

## Architektur in einem Satz pro Datei

- `map.js` – Graph der Karte (Gebiete mit x/y, EDGES mit optional `'sea'`/`'wrap'`, Kontinente mit Bonus und Labelposition)
- `rules.js` – Zustand + Phasen `setup → reinforce → attack → fortify → (nächster Spieler)`, `gameover`
- `net.js` – `HostNet`/`ClientNet`, Raum-ID = `weltherrschaft-v1-` + Code, Auto-Reconnect, Ping
- `ui.js` – `GameView` rendert alles aus `ctx = {state, myId, mode, lobby, codeLabel, status, ping}` und ruft `dispatch(action)`
- `main.js` – Bildschirme (start/lobby/game), Rollen (host/client/local), Speicherstand im localStorage, Auto-Wiedereinstieg nach Reload (sessionStorage `wh-active`)

## Bekannte Grenzen / offene Punkte

- Keine Karten-Sets, keine Missionen, kein Zug-Timer.
- Kein TURN-Server: Bei sehr restriktiven Netzen klappt die Direktverbindung evtl. nicht.
- Der Host könnte theoretisch schummeln (er besitzt den Zustand) – unter Freunden akzeptiert.
- Gebiete sind Kreise; echte Ländergrenzen wären der nächste Optik-Schritt.
