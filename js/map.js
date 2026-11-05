// Eigene, vereinfachte Erde-Karte: 34 Gebiete in 6 Kontinenten.
// Die Karte ist ein Graph: Gebiete = Knoten, Nachbarschaften = Kanten.
// x/y sind Positionen in der SVG-Ansicht (MAP_SIZE). Optik und Logik sind getrennt:
// Für echte Ländergrenzen später nur die Darstellung austauschen, nicht diese Daten.

export const MAP_SIZE = { width: 1000, height: 540 };

export const CONTINENTS = {
  nordamerika: { name: 'Nordamerika', bonus: 4, color: '#d9b26f', label: { x: 190, y: 52 } },
  suedamerika: { name: 'Südamerika', bonus: 2, color: '#9cc46b', label: { x: 415, y: 482 } },
  europa: { name: 'Europa', bonus: 5, color: '#7fb0d6', label: { x: 430, y: 72 } },
  afrika: { name: 'Afrika', bonus: 3, color: '#e0915a', label: { x: 660, y: 455 } },
  asien: { name: 'Asien', bonus: 6, color: '#b49be0', label: { x: 770, y: 40 } },
  ozeanien: { name: 'Ozeanien', bonus: 2, color: '#e07f9a', label: { x: 745, y: 525 } },
};

export const TERRITORIES = [
  // Nordamerika
  { id: 'alaska', name: 'Alaska', continent: 'nordamerika', x: 80, y: 110 },
  { id: 'kanada_west', name: 'Westkanada', continent: 'nordamerika', x: 180, y: 110 },
  { id: 'kanada_ost', name: 'Ostkanada', continent: 'nordamerika', x: 290, y: 100 },
  { id: 'usa_west', name: 'USA West', continent: 'nordamerika', x: 170, y: 200 },
  { id: 'usa_ost', name: 'USA Ost', continent: 'nordamerika', x: 270, y: 200 },
  { id: 'mexiko', name: 'Mexiko', continent: 'nordamerika', x: 200, y: 280 },
  // Südamerika
  { id: 'kolumbien', name: 'Kolumbien', continent: 'suedamerika', x: 280, y: 330 },
  { id: 'peru', name: 'Peru', continent: 'suedamerika', x: 265, y: 410 },
  { id: 'brasilien', name: 'Brasilien', continent: 'suedamerika', x: 355, y: 385 },
  { id: 'argentinien', name: 'Argentinien', continent: 'suedamerika', x: 310, y: 480 },
  // Europa
  { id: 'grossbritannien', name: 'Großbritannien', continent: 'europa', x: 440, y: 140 },
  { id: 'skandinavien', name: 'Skandinavien', continent: 'europa', x: 520, y: 90 },
  { id: 'westeuropa', name: 'Westeuropa', continent: 'europa', x: 450, y: 215 },
  { id: 'mitteleuropa', name: 'Mitteleuropa', continent: 'europa', x: 525, y: 170 },
  { id: 'suedeuropa', name: 'Südeuropa', continent: 'europa', x: 535, y: 240 },
  { id: 'osteuropa', name: 'Osteuropa', continent: 'europa', x: 605, y: 150 },
  // Afrika
  { id: 'nordafrika', name: 'Nordafrika', continent: 'afrika', x: 470, y: 315 },
  { id: 'aegypten', name: 'Ägypten', continent: 'afrika', x: 570, y: 305 },
  { id: 'zentralafrika', name: 'Zentralafrika', continent: 'afrika', x: 530, y: 385 },
  { id: 'ostafrika', name: 'Ostafrika', continent: 'afrika', x: 615, y: 385 },
  { id: 'suedafrika', name: 'Südafrika', continent: 'afrika', x: 565, y: 465 },
  // Asien
  { id: 'ural', name: 'Ural', continent: 'asien', x: 685, y: 110 },
  { id: 'sibirien', name: 'Sibirien', continent: 'asien', x: 775, y: 90 },
  { id: 'ostsibirien', name: 'Ostsibirien', continent: 'asien', x: 890, y: 95 },
  { id: 'naher_osten', name: 'Naher Osten', continent: 'asien', x: 645, y: 260 },
  { id: 'zentralasien', name: 'Zentralasien', continent: 'asien', x: 715, y: 190 },
  { id: 'indien', name: 'Indien', continent: 'asien', x: 725, y: 295 },
  { id: 'china', name: 'China', continent: 'asien', x: 815, y: 220 },
  { id: 'japan', name: 'Japan', continent: 'asien', x: 925, y: 200 },
  { id: 'suedostasien', name: 'Südostasien', continent: 'asien', x: 825, y: 315 },
  // Ozeanien
  { id: 'indonesien', name: 'Indonesien', continent: 'ozeanien', x: 835, y: 395 },
  { id: 'neuguinea', name: 'Neuguinea', continent: 'ozeanien', x: 925, y: 390 },
  { id: 'westaustralien', name: 'Westaustralien', continent: 'ozeanien', x: 855, y: 470 },
  { id: 'ostaustralien', name: 'Ostaustralien', continent: 'ozeanien', x: 935, y: 470 },
];

// Kanten. Optionaler dritter Wert:
//   'sea'  = Seeweg (gestrichelt gezeichnet)
//   'wrap' = Verbindung über den Kartenrand (Alaska <-> Ostsibirien)
export const EDGES = [
  // Nordamerika
  ['alaska', 'kanada_west'],
  ['kanada_west', 'kanada_ost'],
  ['kanada_west', 'usa_west'],
  ['kanada_ost', 'usa_ost'],
  ['kanada_ost', 'usa_west'],
  ['usa_west', 'usa_ost'],
  ['usa_west', 'mexiko'],
  ['usa_ost', 'mexiko'],
  // Südamerika
  ['kolumbien', 'peru'],
  ['kolumbien', 'brasilien'],
  ['peru', 'brasilien'],
  ['peru', 'argentinien'],
  ['brasilien', 'argentinien'],
  // Europa
  ['grossbritannien', 'skandinavien', 'sea'],
  ['grossbritannien', 'westeuropa', 'sea'],
  ['westeuropa', 'mitteleuropa'],
  ['westeuropa', 'suedeuropa'],
  ['mitteleuropa', 'skandinavien'],
  ['mitteleuropa', 'suedeuropa'],
  ['mitteleuropa', 'osteuropa'],
  ['skandinavien', 'osteuropa'],
  ['suedeuropa', 'osteuropa'],
  // Afrika
  ['nordafrika', 'aegypten'],
  ['nordafrika', 'zentralafrika'],
  ['aegypten', 'ostafrika'],
  ['zentralafrika', 'ostafrika'],
  ['zentralafrika', 'suedafrika'],
  ['ostafrika', 'suedafrika'],
  // Asien
  ['ural', 'sibirien'],
  ['ural', 'zentralasien'],
  ['sibirien', 'ostsibirien'],
  ['sibirien', 'zentralasien'],
  ['sibirien', 'china'],
  ['ostsibirien', 'china'],
  ['ostsibirien', 'japan', 'sea'],
  ['zentralasien', 'naher_osten'],
  ['zentralasien', 'china'],
  ['zentralasien', 'indien'],
  ['naher_osten', 'indien'],
  ['indien', 'china'],
  ['indien', 'suedostasien'],
  ['china', 'suedostasien'],
  ['china', 'japan', 'sea'],
  // Ozeanien
  ['indonesien', 'neuguinea', 'sea'],
  ['indonesien', 'westaustralien', 'sea'],
  ['neuguinea', 'ostaustralien', 'sea'],
  ['neuguinea', 'westaustralien', 'sea'],
  ['westaustralien', 'ostaustralien'],
  // Interkontinental
  ['alaska', 'ostsibirien', 'wrap'],
  ['kanada_ost', 'grossbritannien', 'sea'],
  ['mexiko', 'kolumbien'],
  ['brasilien', 'nordafrika', 'sea'],
  ['westeuropa', 'nordafrika', 'sea'],
  ['suedeuropa', 'nordafrika', 'sea'],
  ['suedeuropa', 'aegypten', 'sea'],
  ['suedeuropa', 'naher_osten'],
  ['osteuropa', 'ural'],
  ['osteuropa', 'zentralasien'],
  ['osteuropa', 'naher_osten'],
  ['aegypten', 'naher_osten'],
  ['ostafrika', 'naher_osten', 'sea'],
  ['suedostasien', 'indonesien', 'sea'],
];

export const TERRITORY_BY_ID = Object.fromEntries(TERRITORIES.map((t) => [t.id, t]));

export const ADJACENCY = (() => {
  const adj = Object.fromEntries(TERRITORIES.map((t) => [t.id, []]));
  for (const [a, b] of EDGES) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return adj;
})();

export const CONTINENT_TERRITORIES = (() => {
  const out = Object.fromEntries(Object.keys(CONTINENTS).map((c) => [c, []]));
  for (const t of TERRITORIES) out[t.continent].push(t.id);
  return out;
})();
