# Spezifikation: General-System

Stand: 06.11.2026 · Status: **Kern + Schritt 7 umgesetzt** (Feldherr, Marschbefehl,
Nachschub-auf-General, Vernichtung-Etappe 2, General-Kill-Belohnung).

Optionales Zusatzsystem (Lobby-/Lokal-Schalter „General"), unabhängig von den Missionen
aktivierbar. In `createGame(players, rng, { general: true })` gesetzt als `state.general`.

## 1. Grundregeln (beschlossen)

- Jeder Spieler hat **einen General**, der auf genau einem eigenen Gebiet steht:
  `player.general = territoryId` oder `null`, wenn er gefallen ist.
- **Start:** zufällig auf einem eigenen Gebiet (nach der Gebietsverteilung, mit `rng`).
- **Kampfbonus:** Steht der General auf dem **angreifenden** oder **verteidigenden** Gebiet,
  bekommt dort der **höchste Würfel +1** – im Vergleich, die gewürfelten Augen bleiben sichtbar.
  Gilt bei Einzelwurf und Blitz, kombinierbar mit „Überraschungsangriff".
- **Bewegung:** Der General **rückt auf Wunsch mit**, wenn man von seinem Gebiet aus
  erobert (`occupy` mit `withGeneral`) oder in der Verschieben-Phase wegzieht (`fortify`
  mit `withGeneral`). Ohne das Flag bleibt er stehen. (Automatisches Nachrücken bei
  `min === max` bewegt ihn **nicht**.)
- **Fallen:** Wird das Gebiet, auf dem der General steht, von einem Gegner **erobert**,
  fällt der General (`general = null`). Der Eroberer merkt sich das in
  `stats.killedGeneralOf` (sofern `stats` existiert). Log: „⚔️ X hat den General von Y besiegt!".
- **Wiederbelebung:** nur über die Depesche **Marschbefehl** (Schritt 7). Ohne Missionen/
  Depeschen bleibt ein gefallener General weg – das ist gewollt.
- **Sichtbarkeit:** Generäle sind **öffentlich** (Stern-Marker auf der Karte). `viewFor`
  entfernt `player.general` nicht. (Der Nebel wird das später einschränken.)

## 2. Oberfläche

- Karte: **★** in Besitzerfarbe auf dem Gebiet des Generals; Tooltip „· General".
- Nachrücken/Verschieben: Umschalter **„★ General mitnehmen: ja/nein"**, nur sichtbar,
  wenn der eigene General auf dem Startgebiet steht.
- Kampf-Panel: **★+1** neben der betroffenen Seite und Hinweis „General: +1 auf höchsten Würfel".

## 3. Missions-/Depeschen-Anbindung (Schritt 7 – umgesetzt)

- **Feldherr-Mission** (`f_feldherr`) im Pool, sobald `options.general`. Etappe 1 =
  `stats.generalConquests ≥ 3` (General stand im angreifenden Gebiet bei der Eroberung),
  kumulativ über Züge, nach jeder Eroberung geprüft. Fällt der General vor 3, ist Etappe 1
  unerreichbar – gewollt.
- **Vernichtung Etappe 2**: erfüllt durch „General von X durch dich besiegt"
  (`stats.killedGeneralOf`) **oder** X auf ≤ 4 Gebiete gedrückt.
- Depesche **Marschbefehl** (Stufe II, nur mit General im Stapel): setzt den General in ein
  beliebiges eigenes Gebiet – lebt er, zieht er um; ist er gefallen, wird er dort wiederbelebt
  (einziger Weg der Wiederbelebung).
- Depesche **Nachschub**: mit lebendem General gehen die +3 auf dessen Gebiet; ohne General
  (System aus oder gefallen) auf ein beliebiges eigenes.
- **General-Kill → Stufe-I-Depeschenwahl** als Belohnung (nur bei aktiven Missionen).
- **Etappe 2** stellt **3** Depeschen zur Wahl (statt 2), um z. B. bei totem General gezielt
  Marschbefehl ziehen zu können.

## 4. Tests (umgesetzt)

Start nur mit Option; Kampfbonus entscheidet Gleichstand (Angriff) bzw. hält ein Gebiet
(Verteidigung); General fällt bei Eroberung inkl. `killedGeneralOf`; Mitrücken nur mit
Flag; Simulation läuft mit aktivem General (Invariante: lebender General steht auf eigenem
Gebiet).
