# Spezifikation: Missionen, Etappen & Depeschen

Stand: 05.11.2026 · Status: **Schritte 1–6 umgesetzt** (Sichtbarkeit, Missions-Pool,
Etappen, Depeschen inkl. UI, Pranger, Missions-Bot + Balance-Messung via
`npm run balance`). General-Kern + Schritt 7 (Feldherr, Marschbefehl, Nachschub-auf-General,
Vernichtung-Etappe 2, General-Kill-Belohnung) gebaut – siehe `docs/general.md`. Etappe 2
stellt 3 Depeschen zur Wahl. Offen: 8 🔗 Nebel. Balance-Nachjustierung bei Bedarf
(aktuell auffällig: Bollwerk-Siegquote ~0 %, Weltmacht/Feldherr fallen mit steigender Spielerzahl).

Diese Datei ist der Auftrag für die Umsetzung. Sie baut auf dem aktuellen Code auf
(`js/rules.js` mit Orden, `createGame(players, rng, options)`, `HANDLERS`).
**General** und **Nebel des Krieges** sind beschlossen, aber noch nicht gebaut.
Alles, was davon abhängt, ist hier mit 🔗 markiert und muss auch ohne diese Systeme
funktionieren (siehe §9).

---

## 1. Ziele des Systems

- Missionen ersetzen die Siegbedingung „alle Gebiete erobern“ (nur bei ≥ 3 Spielern).
- Jede Mission hat **2 Etappen + Endziel**. Etappen geben unterwegs Rückmeldung und Belohnung.
- Belohnung je Etappe: **+2 Truppen** in der nächsten Verstärkung **und** eine **Depesche**
  (2 ziehen, 1 behalten).
- Missionen bleiben geheim. Öffentlich ist nur, *wie viele* Etappen jemand erreicht hat.
- Die Depesche „Abgefangene Depesche“ kann den **Missionstyp** eines Spielers für **alle**
  sichtbar machen („Pranger“).

## 2. Begriffe

| Begriff | Bedeutung |
|---|---|
| Etappe 1 | immer ein **Ereignis** (passiert durch eine Aktion). Kann daher nie durch die Startverteilung geschenkt sein. |
| Etappe 2 | immer ein **Zustand**, geprüft am Ende des eigenen Zugs |
| Endziel | Zustand; erreicht → **sofortiger Sieg** |
| Depesche | Belohnungskarte (nicht zu verwechseln mit Orden, die bleiben unverändert) |
| Pranger | öffentlich bekannter Missionstyp eines Spielers |

## 3. Grundregeln

1. Missionen nur bei **3–7 Spielern** und wenn `options.missions === true`.
   Bei 2 Spielern oder ausgeschaltet: klassischer Sieg (alle Gebiete).
2. Jeder Spieler zieht zu Spielbeginn **verdeckt eine Mission** ohne Zurücklegen aus dem Pool (§4).
3. **Etappen sind unabhängig voneinander**: Etappe 2 kann vor Etappe 1 erreicht werden.
   Jede Etappe zählt genau einmal und bleibt erreicht, auch wenn sich der Zustand später ändert.
4. Etappen und Endziel zählen nur für den Spieler **am Zug** (Ausnahme: Zähler für
   Verteidigungen, §5.2, werden auch im fremden Zug hochgezählt, aber erst im eigenen Zug geprüft).
5. Das Endziel wird **nach jeder eigenen Aktion** geprüft. Erreicht → `phase = 'gameover'`,
   `winner = pid`, Log: „🏆 Tobi erfüllt seine Mission: …“ (Mission wird dabei für alle aufgedeckt).
6. Erreichen zwei Spieler ihr Endziel durch dieselbe Aktion, gewinnt der Spieler am Zug.
7. Die klassische Siegbedingung (alle 42 Gebiete) gilt **zusätzlich** weiter.

## 4. Missions-Pool

Der Pool wird in `createGame` zusammengestellt:

- 6 Kontinent-Missionen
- 2 Gebiets-Missionen (Weltmacht, Bollwerk)
- 1 × Feldherr 🔗 (nur wenn `options.general`)
- 1 Vernichtungs-Mission **pro Spieler** (Ziel = dieser Spieler). Eine Vernichtungs-Mission,
  deren Ziel man selbst ist, wird zurückgelegt und neu gezogen.

### 4.1 Kontinent-Missionen

Für alle sechs gilt:
- **Etappe 1 (Ereignis):** in einem Zug **2 Gebiete** in den Zielkontinenten erobert
  (bei „+1 beliebiger“ zählen nur die beiden festen Kontinente).
- **Etappe 2 (Zustand):** einen der festen Zielkontinente komplett.
- **Endziel:** alle Zielkontinente komplett.

| id | Zielkontinente |
|---|---|
| `k_na_af` | Nordamerika + Afrika |
| `k_na_oz` | Nordamerika + Ozeanien |
| `k_as_sa` | Asien + Südamerika |
| `k_as_af` | Asien + Afrika |
| `k_eu_sa_x` | Europa + Südamerika + 1 beliebiger weiterer Kontinent |
| `k_eu_oz_x` | Europa + Ozeanien + 1 beliebiger weiterer Kontinent |

### 4.2 Gebiets-Missionen (skalieren mit Spielerzahl)

Werte „4–7 Spieler / 3 Spieler“:

| id | Etappe 1 (Ereignis) | Etappe 2 (Zustand) | Endziel |
|---|---|---|---|
| `g_weltmacht` | in einem Zug **3 Gebiete** erobert | **18 / 22** Gebiete | **24 / 28** Gebiete |
| `g_bollwerk` | **2 Angriffe abgewehrt** seit Ende des eigenen letzten Zugs (§5.2) | **14 / 17** Gebiete mit je ≥ 2 Truppen | **18 / 22** Gebiete mit je ≥ 2 Truppen |

### 4.3 Vernichtung (`v_<playerId>`)

| Etappe 1 (Ereignis) | Etappe 2 (Zustand) | Endziel |
|---|---|---|
| in einem Zug **2 Gebiete von X** erobert | **General von X durch dich besiegt** 🔗 *oder* X hat **≤ 4 Gebiete** | X wird **von dir** ausgeschaltet |

**Ausfallregel:** Wird X von jemand anderem ausgeschaltet, wechselt die Mission auf
`g_weltmacht` (bereits erreichte Etappen bleiben gültig, offene Etappen werden die der
Weltmacht). Der Wechsel erscheint **nicht** im öffentlichen Log, nur privat beim Betroffenen.

„General von X durch dich besiegt“ ist ein Ereignis, das beim Besiegen gemerkt wird
(`player.stats.killedGeneralOf: [pid]`) und am Ende des Zugs als erfüllt gilt.

### 4.4 Feldherr (`f_feldherr`) 🔗

| Etappe 1 (Ereignis, kumulativ) | Etappe 2 (Zustand) | Endziel |
|---|---|---|
| dein General war an **3 Eroberungen** beteiligt (über mehrere Züge zusammengezählt) | **2 Kontinente** gleichzeitig | **3 Kontinente**, davon mind. einer aus Nordamerika, Europa, Asien |

„Beteiligt“ = der General stand im angreifenden Gebiet, als die Eroberung passierte.
Fällt der General, ist Etappe 1 nicht mehr erreichbar. **Das ist gewollt.**
Etappe 2 und Endziel bleiben möglich.

## 5. Prüfzeitpunkte & Zähler

### 5.1 Pro Zug (zurücksetzen in `startTurn`)

```js
s.turnStats = {
  conquered: 0,                 // Anzahl Eroberungen in diesem Zug
  conqueredFrom: {},            // { [vorherigerBesitzer]: n }
  conqueredIn: {},              // { [continentId]: n }
};
```

- Nach **jeder Eroberung** (`conquer`): Zähler erhöhen, dann **Ereignis-Etappen** (Etappe 1)
  des Spielers am Zug prüfen, dann **Endziel** prüfen.
- Am **Ende des eigenen Zugs** (in `finishTurn`, *vor* dem Spielerwechsel): Zustands-Etappen
  (Etappe 2) prüfen. Das passiert auch beim Ende durch `fortify`, `endTurn` und `forceSkip`.

### 5.2 Dauerhafte Zähler pro Spieler

```js
player.stats = {
  defendedSinceOwnTurn: 0,      // Bollwerk
  generalConquests: 0,          // Feldherr
  killedGeneralOf: [],          // Vernichtung Etappe 2
};
```

- **Abwehr** = eine Angriffsaktion (`attack` oder kompletter `blitz`) gegen ein Gebiet des
  Spielers, nach der das Gebiet **noch ihm gehört**. Zählt pro Aktion, nicht pro Würfelrunde.
- Bollwerk-Etappe 1 wird **zu Beginn des eigenen Zugs** geprüft (in `startTurn`, vor der
  Berechnung der Verstärkung). Danach `defendedSinceOwnTurn = 0`.

### 5.3 Belohnung bei Etappe

```js
player.stageBonus += 2;   // MISSION_STAGE_BONUS
```
- `stageBonus` wird in `calcReinforcements` addiert und danach auf 0 gesetzt.
  Wird die Etappe zu Zugbeginn erreicht (Bollwerk), zählt der Bonus sofort im laufenden Zug.
- Dazu eine **Depeschen-Wahl** (§6.2).
- Öffentliches Log: „Tobi hat eine Etappe erreicht (+2 Truppen, 1 Depesche).“
  **Welche** Etappe es war, bleibt geheim.
- Spielerliste zeigt öffentlich den Fortschritt als ●●○ (Etappe 1, Etappe 2, Endziel).

## 6. Depeschen

### 6.1 Regeln

- Zwei Stapel: **Stufe I** (Belohnung für Etappe 1 und fürs Besiegen eines Generals 🔗)
  und **Stufe II** (Belohnung für Etappe 2).
- Jede Karte liegt **2×** im Stapel. Leerer Stapel → Ablage neu mischen.
- Karten, die in der aktuellen Partie nicht nutzbar sind, werden beim Erzeugen des Stapels
  weggelassen (§9).
- **Handlimit 3.** Ist die Hand voll, darf bei einer neuen Wahl eine alte Karte abgelegt werden
  oder die neue verfallen.
- **Höchstens 1 Depesche pro Zug.** Nur im **eigenen Zug**, nur in den Phasen
  `reinforce`, `attack`, `fortify`, nicht während `pendingMove`.
- Beim Ausspielen erfahren alle den **Kartennamen**. Ziele von Aufklärungskarten (Späher,
  Tarnung) bleiben geheim.
- Depeschen sind **nicht** gegen Truppen eintauschbar (das bleibt Sache der Orden).

### 6.2 Wahl

Beim Auslösen: 2 Karten aus dem passenden Stapel ziehen → `player.depeschenChoice = [a, b]`.
Neue Aktion:

```js
{ type: 'chooseDepesche', keep: 'a'|'b'|null, discard?: <Index in Hand> }
```

- Darf auch **außerhalb des eigenen Zugs** ausgeführt werden (Belohnung durch Verteidigung o. Ä.)
  → Ausnahme in `applyAction`: Für `chooseDepesche` gilt nur „`actorId` hat eine offene Wahl“.
- Nicht gewählte Karte → Ablagestapel.
- Solange eine Wahl offen ist, blockiert sie den Spielablauf **nicht**.

### 6.3 Stufe I – Taktik

| id | Name | Wirkung | Phase |
|---|---|---|---|
| `aufklaerung` 🔗 | Aufklärung | Nebel für den Rest deines Zugs komplett aufgehoben | jede |
| `spaeher` 🔗 | Späher | ein Gebiet + alle Nachbarn sichtbar bis **Ende deines nächsten Zugs** | jede |
| `tarnung` 🔗 | Tarnung | bis **Beginn deines nächsten Zugs** zeigen 3 gewählte eigene Gebiete den Gegnern „?“ statt Truppenzahl, auch wenn sie angrenzen | jede |
| `gewaltmarsch` | Gewaltmarsch | ein **zusätzliches** Verschieben in diesem Zug, das den Zug **nicht** beendet | attack, fortify |
| `nachschub` | Nachschub | +3 Truppen auf das Gebiet deines Generals. Ohne General 🔗: auf ein beliebiges eigenes Gebiet | jede |

### 6.4 Stufe II – stark

| id | Name | Wirkung | Phase |
|---|---|---|---|
| `luftbruecke` | Luftbrücke | 1 bis (Truppen − 1) zwischen zwei beliebigen eigenen Gebieten verschieben, ohne Verbindung. Beendet den Zug **nicht** | attack, fortify |
| `sabotage` | Sabotage | ein gegnerisches Gebiet **−3 Truppen** (nie unter 1). Mit Nebel 🔗: Ziel muss für dich sichtbar sein | jede |
| `marschbefehl` 🔗 | Marschbefehl | General lebt: springt in ein beliebiges eigenes Gebiet. General gefallen: **wird wiederbelebt** auf einem beliebigen eigenen Gebiet. **Einziger Weg der Wiederbelebung.** | jede |
| `ueberraschung` | Überraschungsangriff | bei deiner **nächsten Angriffsaktion** in diesem Zug (einzelner Wurf oder kompletter Blitz) gewinnt der Angreifer bei Gleichstand | attack |
| `abgefangen` | Abgefangene Depesche | wähle einen Gegner, der noch nicht am Pranger steht: sein **Missionstyp** (Kontinent / Gebiet / Vernichtung / Feldherr) wird **für alle** sichtbar | jede |

**Pranger-Details:**
- `player.pillory = { type, turn }`. Spielerliste zeigt z. B. „📜 Vernichtung (seit Zug 7)“.
- Angezeigt wird der Typ **zum Zeitpunkt des Aufdeckens**. Ändert er sich später durch die
  Ausfallregel, wird das nicht öffentlich aktualisiert.
- Stehen alle lebenden Gegner am Pranger, darf `abgefangen` nicht gespielt werden und wird beim
  Ziehen durch eine andere Stufe-II-Karte ersetzt.

### 6.5 Aktion zum Ausspielen

```js
{ type: 'playDepesche', index: <Index in Hand>, target?: territoryId | playerId,
  targets?: territoryId[], from?: territoryId, to?: territoryId, count?: number }
```
Jede Karte prüft ihre Parameter selbst. Fehlermeldungen auf Deutsch wie bei den anderen Handlern.

## 7. Sichtbarkeit (Voraussetzung!)

Ohne diesen Schritt sind Missionen und Depeschen in den Browser-DevTools für jeden lesbar.

`viewFor(state, playerId)` in `rules.js` (rein, testbar) gibt eine Kopie zurück, in der
für **fremde** Spieler entfernt bzw. ersetzt ist:

| Feld | sichtbar für andere |
|---|---|
| `mission` | ❌ (nur `stagesDone: [bool, bool]` und `pillory`) |
| `depeschen` (Hand) | ❌ nur Anzahl |
| `depeschenChoice` | ❌ |
| `stats` | ❌ |
| Depeschen-Stapel | ❌ nur Anzahl |
| `rng`-relevante Daten / Stapelreihenfolge | ❌ |
| Log-Einträge mit `visibleTo` | nur wenn `playerId` enthalten |

- Log-Einträge bekommen optional `visibleTo: [pid]` für private Meldungen
  (z. B. „Deine Mission wurde zu Weltmacht“).
- Der **Host** schickt jedem Client `viewFor(state, clientId)` und zeigt sich selbst
  `viewFor(state, hostId)` an. (Technisch kennt der Host alles – unter Freunden akzeptiert.)
- Hot-Seat: Anzeige über `viewFor` des Spielers am Zug. Mission nur nach Klick auf
  „Mission anzeigen“ einblenden (damit die anderen am Bildschirm nicht mitlesen).
- 🔗 Der Nebel erweitert `viewFor` später um ausgeblendete Truppenzahlen.

## 8. Oberfläche

- **Missionskarte** im Seitenpanel: Name, die drei Stufen mit Haken und **Fortschritt**
  (z. B. „Asien: 7/12“, „Gebiete mit ≥ 2 Truppen: 11/14“). Für die Anzeige eine reine
  Funktion `missionProgress(state, pid)` in `rules.js`.
- **Depeschen-Hand** unter der Missionskarte; nicht spielbare Karten ausgegraut mit Grund als Tooltip.
- **Wahl-Dialog** bei `depeschenChoice` (zwei Karten nebeneinander, bei voller Hand zusätzlich
  „ablegen“-Auswahl).
- **Spielerliste:** ●●○ Fortschritt, Anzahl Depeschen, Pranger-Symbol.
- **Lobby-Schalter:** „Missionen“ (Standard: an ab 3 Spielern).

## 9. Abhängigkeiten von General & Nebel

| Bestandteil | ohne General | ohne Nebel |
|---|---|---|
| Mission `f_feldherr` | nicht im Pool | – |
| Vernichtung Etappe 2 | nur „X ≤ 4 Gebiete“ | – |
| `nachschub` | auf beliebiges eigenes Gebiet | – |
| `marschbefehl` | nicht im Stapel | – |
| „General besiegt → Stufe I“ | entfällt | – |
| `aufklaerung`, `spaeher`, `tarnung` | – | nicht im Stapel |
| `sabotage` | – | Ziel beliebig |

So ist das Missionssystem **vor** General und Nebel umsetzbar und testbar.

## 10. Konstanten (alles zentral, zum Feintunen)

```js
export const MISSION_MIN_PLAYERS = 3;
export const MISSION_STAGE_BONUS = 2;
export const DEPESCHE_HAND_LIMIT = 3;
export const DEPESCHE_COPIES = 2;
export const MISSION_TARGETS = {
  g_weltmacht: { stage2: { 3: 22, default: 18 }, goal: { 3: 28, default: 24 } },
  g_bollwerk:  { stage1Defends: 2, stage2: { 3: 17, default: 14 }, goal: { 3: 22, default: 18 }, minTroops: 2 },
  vernichtung: { stage1From: 2, stage2MaxTerritories: 4 },
  kontinent:   { stage1Conquests: 2 },
  feldherr:    { stage1GeneralConquests: 3, stage2Continents: 2, goalContinents: 3 },
};
```

## 11. Tests (Pflicht)

- Pool: korrekte Größe je Spielerzahl, keine Vernichtung gegen sich selbst, keine Duplikate,
  `f_feldherr` nur mit General.
- Jede Mission: Etappe 1, Etappe 2 und Endziel einzeln mit präpariertem Zustand auslösen.
- Etappe 1 wird **nicht** durch die Startverteilung ausgelöst (100 zufällige Starts).
- Etappen in umgekehrter Reihenfolge möglich; jede Etappe nur einmal belohnt.
- `stageBonus` landet genau einmal in der Verstärkung.
- Ausfallregel Vernichtung → Weltmacht, Etappen bleiben, Log privat.
- Bollwerk: Abwehr zählt pro Aktion, Blitz = 1 Abwehr, Reset nach eigenem Zugbeginn.
- Depeschen: Handlimit, 1 pro Zug, Phasenprüfung, jede Karte mit gültigen und ungültigen Parametern.
- `abgefangen`: nur Gegner ohne Pranger; verschwindet, wenn alle am Pranger stehen.
- `viewFor`: fremde Mission, Hand, Wahl und private Logs sind nicht im Ergebnis enthalten.
- Simulation: bestehende Invarianten + keine Mission bleibt „unerreichbar hängend“ ohne Grund.

## 12. Balance-Messung (Simulation)

Die vorhandenen Zufalls-Bots verfolgen keine Mission – mit ihnen sind Balance-Zahlen wertlos.
Neuer **Missions-Bot** (einfach, gierig):
- verstärkt Grenzgebiete, die an Missionsziele angrenzen,
- greift bevorzugt Gebiete an, die die eigene Mission voranbringen,
- spielt Depeschen, sobald sie gültig spielbar sind.

Ausgabe nach z. B. 500 Partien je Spielerzahl (3, 4, 5, 7):
- Siegquote je **Mission** (Ziel: keine Mission deutlich über/unter dem Schnitt),
- durchschnittliche **Siegrunde**,
- Anteil Sieg durch Mission vs. durch Komplett-Eroberung,
- Siegquote von Spielern, die als Erste eine Etappe erreicht haben (**Schneeball-Check**).

Erste Kandidaten zum Nachjustieren, falls nötig: Gebiets-Zielwerte, `sabotage`, `nachschub`.

## 13. Umsetzungsreihenfolge (je Schritt: Tests grün → Hot-Seat-Test → Commit)

1. `viewFor` + private Log-Einträge + Host/Client schicken gefilterte Zustände.
2. Missions-Pool, Zuteilung, `missionProgress`, Endziel als Siegbedingung, Missionskarte in der UI.
3. Etappen + Zähler + `stageBonus` + Fortschrittsanzeige ●●○.
4. Depeschen-Stapel, Wahl, Hand, `playDepesche` für die Karten **ohne** 🔗.
5. Pranger.
6. Missions-Bot + Balance-Ausgabe.
7. 🔗 Nach dem General: Feldherr, Vernichtung-Etappe 2 (General), `marschbefehl`, General-Kill-Belohnung.
8. 🔗 Nach dem Nebel: `aufklaerung`, `spaeher`, `tarnung`, Sichtprüfung bei `sabotage`.
