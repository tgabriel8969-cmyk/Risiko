# Weltherrschaft

Rundenbasiertes Eroberungsspiel für 2–7 Freunde, direkt im Browser.
Es braucht **keinen Server**: Der Browser des Hosts ist der Schiedsrichter, die anderen verbinden sich per WebRTC direkt mit ihm (über [PeerJS](https://peerjs.com)).

> „Weltherrschaft“ ist ein Platzhaltername. Karte und Name sind bewusst eigenständig, nur die Spielmechanik orientiert sich am Klassiker.

## Schnellstart

Wegen der JavaScript-Module muss das Spiel über einen kleinen lokalen Webserver laufen. Ein Doppelklick auf `index.html` funktioniert **nicht**.

```bash
# Variante A (Node.js installiert)
npm start                 # -> http://localhost:8080

# Variante B (Python installiert)
python -m http.server 8080
```

Dann `http://localhost:8080` öffnen und **„Lokal testen“** wählen. Damit spielst du Hot-Seat an einem Gerät, ganz ohne Netzwerk.

## Mit Freunden spielen (kostenlos über GitHub Pages)

1. Kostenlosen GitHub-Account anlegen, neues Repository erstellen (z. B. `weltherrschaft`).
2. Alle Dateien dieses Ordners hochladen (Web-Oberfläche: *Add file → Upload files*).
3. Im Repository: *Settings → Pages → Branch: `main`, Ordner `/ (root)` → Save*.
4. Nach ca. 1 Minute ist das Spiel unter `https://<dein-name>.github.io/weltherrschaft/` erreichbar.

Ablauf am Spieleabend:
- Du öffnest den Link, gibst deinen Namen ein und klickst **„Neues Spiel hosten“**. Du bekommst einen Raum-Code wie `KRTA-42`.
- Den Code schickst du in die Gruppe. Deine Freunde öffnen denselben Link und klicken auf **„Beitreten“**.
- Sobald alle in der Lobby stehen: **„Spiel starten“**.

**Wichtig:** Dein Host-Tab muss offen bleiben. Schließt du ihn, pausiert das Spiel für alle. Der Spielstand wird aber nach jedem Zug gespeichert und läuft nach dem Neuladen weiter.

### Erster Test: Klappt die Verbindung bei allen?
Bevor ihr einen ganzen Abend plant: Hostet einmal kurz und lasst alle beitreten. Steht bei jedem in der Lobby **„verbunden“** mit einem Ping-Wert, passt alles.
Hängt jemand dauerhaft bei *„Keine Direktverbindung möglich“*, blockiert sein Netz WebRTC-Direktverbindungen. Das passiert eher bei Firmen- oder Mobilfunknetzen als im Heim-WLAN. Dann braucht es einen TURN-Server als Umweg (siehe „Nächste Schritte“).

## Was schon funktioniert

- Lobby mit Raum-Code, bis zu 7 Spieler
- Eigene Weltkarte: 34 Gebiete, 6 Kontinente mit Bonus
- Aufstellung (reihum je 3 Truppen), Verstärken, Angreifen (1–3 Würfel oder Blitz), Nachrücken, Verschieben
- Siegbedingung: alle Gebiete erobert
- Reconnect: Neuladen bringt Spieler und Host automatisch zurück ins Spiel. Wer den Tab geschlossen hat, steigt mit **exakt demselben Namen** und Code wieder ein.
- Host kann abwesende Spieler überspringen
- Hot-Seat-Modus zum Testen
- Spielerfarben aus der Okabe-Ito-Palette (gut unterscheidbar bei Farbschwäche)
- Handy-tauglich (Karte seitlich wischbar)

## Regeln (Kurzfassung)

| Phase | Was passiert |
|---|---|
| Aufstellung | Gebiete werden zufällig verteilt. Reihum setzt jeder bis zu 3 Truppen, bis alle Start-Truppen stehen. |
| Verstärken | Gebiete ÷ 3 (mind. 3) + Kontinentbonus. Alles muss gesetzt werden. |
| Angreifen | Beliebig oft. Angreifer bis 3 Würfel (eine Truppe bleibt immer zurück), Verteidiger bis 2. Höchste Würfel paarweise vergleichen, Gleichstand gewinnt der Verteidiger. |
| Nachrücken | Nach einer Eroberung: mindestens so viele Truppen wie Würfel. |
| Verschieben | Einmal pro Zug zwischen verbundenen eigenen Gebieten, dann ist der Zug vorbei. |

Start-Truppen und Bonuswerte stehen in `js/rules.js` bzw. `js/map.js` und lassen sich leicht ändern.

## Projektstruktur

```
index.html        Einstieg, lädt PeerJS (CDN) und js/main.js
css/style.css     komplettes Styling inkl. Handy-Layout
js/map.js         Kartendaten: Gebiete, Positionen, Nachbarschaften, Kontinente
js/rules.js       reine Spiellogik: applyAction(state, action, actor, rng)
js/net.js         PeerJS-Wrapper: HostNet / ClientNet, Raum-Codes, Reconnect
js/ui.js          GameView: SVG-Karte, Aktions-Panel, Spielerliste, Protokoll
js/main.js        Startbildschirm, Lobby, Rollen, Speicherstand
tests/            Unit-Tests + Zufallssimulation (npm test)
```

## Tests

```bash
npm test
```
Die Tests prüfen Karte (zusammenhängend, symmetrisch), Regeln (Würfelvergleich, Eroberung, Verschieben, ungültige Züge) und spielen **60 komplette Zufallspartien** mit 2–7 Bots durch, wobei nach jeder Aktion die Invarianten geprüft werden.

## Nächste Schritte (Vorschläge)

1. **Verbindungstest mit allen Freunden** (siehe oben). Das ist das größte technische Risiko.
2. **Karten/Sets:** Eine Karte pro Zug mit Eroberung, Sets gegen Bonustruppen tauschen (`conqueredThisTurn` ist schon vorbereitet).
3. **Echte Ländergrenzen:** Statt Kreisen SVG-Pfade pro Gebiet (`js/map.js` bleibt gleich, nur `renderMap` ändern).
4. **Zug-Timer** und Sound/Animationen beim Würfeln.
5. **TURN-Server** als Fallback, falls bei jemandem keine Direktverbindung zustande kommt.
6. Chat, Missionskarten, eigene Karten-Editor …
