# Spezifikation: Nebel des Krieges

Stand: 06.11.2026 · Status: **umgesetzt**.

Optionales Zusatzsystem (Lobby-/Lokal-Schalter „Nebel"), unabhängig von Missionen/General
aktivierbar. In `createGame(players, rng, { fog: true })` gesetzt als `state.fog`.

## 1. Grundregeln (beschlossen)

- Verborgen sind **nur Truppenzahlen** – Besitzer/Farben jedes Gebiets bleiben immer sichtbar.
- **Sicht** eines Spielers = seine **eigenen Gebiete + alle direkt angrenzenden** (inkl. See-/
  Wrap-Kanten). Überall sonst steht „?" statt der Truppenzahl.
- `viewFor(state, pid)` setzt bei nicht sichtbaren Gebieten `troops = null` (DevTools-fest) und
  blendet fremde **Generäle** auf nicht sichtbaren Gebieten aus. Reine Funktion
  `visibleTerritories(state, pid)` liefert die sichtbare Menge (auch für Bots/Prüfungen).
- Da jedes angreifbare Ziel an ein eigenes Gebiet grenzt, sieht man die Truppen aller Ziele,
  die man tatsächlich angreifen kann – der Nebel behindert die Bedienung also nie.

## 2. Depeschen mit Nebel (nur im Stapel, wenn Nebel an – `needsFog`)

| id | Wirkung | Dauer |
|---|---|---|
| `aufklaerung` (I) | Nebel für den **Rest deines Zugs** komplett aufgehoben | dieser Zug |
| `spaeher` (I) | ein **beliebiges** Gebiet + Nachbarn sichtbar | bis **Ende** deines nächsten Zugs |
| `tarnung` (I) | **3 eigene** Gebiete zeigen Gegnern „?", auch wenn sie angrenzen | bis **Beginn** deines nächsten Zugs |

- Aufklärung/Späher **schlagen** fremde Tarnung (Aufklärung sowieso, Späher deckt sein Ziel auf).
- `sabotage` darf mit Nebel nur **sichtbare** Gegnergebiete treffen.
- Dauer über absolute Zugnummern: `until = turn + Spieleranzahl` (Späher aktiv solange
  `turn <= until`, Tarnung solange `turn < until`).

## 3. Oberfläche

- Karte: verborgene Gebiete zeigen „?" statt Truppenzahl (Besitzerfarbe bleibt).
- Spielerliste: fremde Truppen-Gesamtzahl als „?" unter Nebel.
- Ausspielen: Aufklärung sofort; Späher = ein beliebiges Gebiet anklicken; Tarnung = 3 eigene
  Gebiete nacheinander wählen (markiert, spielt bei der 3. Wahl).
- Lobby-/Lokal-Schalter „Nebel", unabhängig von Mission/General. Die Nebel-Wahl bestimmt
  mit, welche Depeschen im Stapel liegen (`needsFog`).

## 4. Tests (umgesetzt)

Sicht (eigen+angrenzend, Rest verborgen inkl. `viewFor`-`null`); ohne Option alles sichtbar;
Aufklärung/Späher/Tarnung; Sabotage nur auf Sichtbares; Nebel-Karten nur mit Nebel im Stapel;
Simulation mit aktivem Nebel verletzt keine Invarianten.

## 5. Offene Grenzen

- Das öffentliche Protokoll nennt Angriffe/Verluste weiterhin (wie bisher) – der Nebel betrifft
  nur die Truppenanzeige auf der Karte, nicht das Logbuch.
