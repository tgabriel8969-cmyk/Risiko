// Klassische Risiko-Weltkarte: 42 Gebiete in 6 Kontinenten.
// Die Karte ist ein Graph: Gebiete = Knoten, Nachbarschaften = Kanten.
// x/y = Spielstein-Mitte in der SVG-Ansicht (MAP_SIZE). Die Landflächen liegen
// in js/shapes.js, der Pergament-Hintergrund in assets/weltkarte.svg. Optik und
// Logik sind getrennt: Form/Position frei anpassbar, ohne die Spiellogik zu ändern.

export const MAP_SIZE = { width: 1000, height: 540 };

export const CONTINENTS = {
  // color = Akzentfarbe, land = gedämpfte Landfläche (passt zum Pergament-Hintergrund)
  nordamerika: { name: 'Nordamerika', bonus: 5, color: '#5b9bd5', land: '#82979a', label: { x: 150, y: 48 } },
  suedamerika: { name: 'Südamerika', bonus: 2, color: '#8cc152', land: '#89936c', label: { x: 250, y: 455 } },
  europa: { name: 'Europa', bonus: 5, color: '#f0c419', land: '#b39a68', label: { x: 600, y: 92 } },
  afrika: { name: 'Afrika', bonus: 3, color: '#e8743b', land: '#b78a5d', label: { x: 470, y: 478 } },
  asien: { name: 'Asien', bonus: 7, color: '#d9452e', land: '#ad7163', label: { x: 812, y: 52 } },
  ozeanien: { name: 'Ozeanien', bonus: 2, color: '#9b59b6', land: '#8e8292', label: { x: 905, y: 520 } },
};

export const TERRITORIES = [
  // Nordamerika
  { id: 'alaska', name: 'Alaska', continent: 'nordamerika', x: 86, y: 96 },
  { id: 'nordwest_territorium', name: 'Nordwest-Territorium', continent: 'nordamerika', x: 171, y: 88 },
  { id: 'groenland', name: 'Grönland', continent: 'nordamerika', x: 292, y: 63 },
  { id: 'alberta', name: 'Alberta', continent: 'nordamerika', x: 131, y: 159 },
  { id: 'ontario', name: 'Ontario', continent: 'nordamerika', x: 213, y: 160 },
  { id: 'quebec', name: 'Québec', continent: 'nordamerika', x: 283, y: 152 },
  { id: 'weststaaten', name: 'Weststaaten', continent: 'nordamerika', x: 143, y: 223 },
  { id: 'oststaaten', name: 'Oststaaten', continent: 'nordamerika', x: 236, y: 224 },
  { id: 'mittelamerika', name: 'Mittelamerika', continent: 'nordamerika', x: 233, y: 290 },
  // Südamerika
  { id: 'venezuela', name: 'Venezuela', continent: 'suedamerika', x: 295, y: 326 },
  { id: 'brasilien', name: 'Brasilien', continent: 'suedamerika', x: 359, y: 378 },
  { id: 'peru', name: 'Peru', continent: 'suedamerika', x: 314, y: 397 },
  { id: 'argentinien', name: 'Argentinien', continent: 'suedamerika', x: 338, y: 465 },
  // Europa
  { id: 'island', name: 'Island', continent: 'europa', x: 434, y: 116 },
  { id: 'grossbritannien', name: 'Großbritannien', continent: 'europa', x: 410, y: 177 },
  { id: 'skandinavien', name: 'Skandinavien', continent: 'europa', x: 501, y: 110 },
  { id: 'nordeuropa', name: 'Nordeuropa', continent: 'europa', x: 492, y: 174 },
  { id: 'westeuropa', name: 'Westeuropa', continent: 'europa', x: 444, y: 231 },
  { id: 'suedeuropa', name: 'Südeuropa', continent: 'europa', x: 517, y: 234 },
  { id: 'ukraine', name: 'Ukraine', continent: 'europa', x: 570, y: 165 },
  // Afrika
  { id: 'nordafrika', name: 'Nordafrika', continent: 'afrika', x: 459, y: 316 },
  { id: 'aegypten', name: 'Ägypten', continent: 'afrika', x: 543, y: 310 },
  { id: 'ostafrika', name: 'Ostafrika', continent: 'afrika', x: 566, y: 371 },
  { id: 'kongo', name: 'Kongo', continent: 'afrika', x: 506, y: 373 },
  { id: 'suedafrika', name: 'Südafrika', continent: 'afrika', x: 523, y: 438 },
  { id: 'madagaskar', name: 'Madagaskar', continent: 'afrika', x: 617, y: 427 },
  // Asien
  { id: 'ural', name: 'Ural', continent: 'asien', x: 656, y: 167 },
  { id: 'sibirien', name: 'Sibirien', continent: 'asien', x: 706, y: 111 },
  { id: 'jakutsk', name: 'Jakutsk', continent: 'asien', x: 789, y: 82 },
  { id: 'kamtschatka', name: 'Kamtschatka', continent: 'asien', x: 876, y: 98 },
  { id: 'irkutsk', name: 'Irkutsk', continent: 'asien', x: 807, y: 159 },
  { id: 'mongolei', name: 'Mongolei', continent: 'asien', x: 756, y: 207 },
  { id: 'japan', name: 'Japan', continent: 'asien', x: 925, y: 248 },
  { id: 'afghanistan', name: 'Afghanistan', continent: 'asien', x: 639, y: 222 },
  { id: 'china', name: 'China', continent: 'asien', x: 753, y: 267 },
  { id: 'naher_osten', name: 'Naher Osten', continent: 'asien', x: 608, y: 278 },
  { id: 'indien', name: 'Indien', continent: 'asien', x: 690, y: 317 },
  { id: 'siam', name: 'Siam', continent: 'asien', x: 791, y: 322 },
  // Ozeanien
  { id: 'indonesien', name: 'Indonesien', continent: 'ozeanien', x: 816, y: 392 },
  { id: 'neuguinea', name: 'Neuguinea', continent: 'ozeanien', x: 895, y: 372 },
  { id: 'westaustralien', name: 'Westaustralien', continent: 'ozeanien', x: 832, y: 444 },
  { id: 'ostaustralien', name: 'Ostaustralien', continent: 'ozeanien', x: 916, y: 435 },
];

// Kanten. Optionaler dritter Wert:
//   'sea'  = Seeweg (gestrichelt gezeichnet)
//   'wrap' = Verbindung über den Kartenrand (Alaska <-> Kamtschatka)
export const EDGES = [
  // Nordamerika (Grönland ist eine Insel – Verbindungen siehe Interkontinental/See)
  ['alaska', 'nordwest_territorium'],
  ['alaska', 'alberta'],
  ['nordwest_territorium', 'alberta'],
  ['nordwest_territorium', 'ontario'],
  ['alberta', 'ontario'],
  ['alberta', 'weststaaten'],
  ['ontario', 'quebec'],
  ['ontario', 'weststaaten'],
  ['ontario', 'oststaaten'],
  ['quebec', 'oststaaten'],
  ['weststaaten', 'oststaaten'],
  ['weststaaten', 'mittelamerika'],
  ['oststaaten', 'mittelamerika'],
  // Südamerika
  ['venezuela', 'peru'],
  ['venezuela', 'brasilien'],
  ['peru', 'brasilien'],
  ['peru', 'argentinien'],
  ['brasilien', 'argentinien'],
  // Europa
  ['island', 'grossbritannien', 'sea'],
  ['island', 'skandinavien', 'sea'],
  ['grossbritannien', 'skandinavien', 'sea'],
  ['grossbritannien', 'nordeuropa', 'sea'],
  ['grossbritannien', 'westeuropa', 'sea'],
  ['skandinavien', 'nordeuropa'],
  ['skandinavien', 'ukraine'],
  ['nordeuropa', 'westeuropa'],
  ['nordeuropa', 'suedeuropa'],
  ['nordeuropa', 'ukraine'],
  ['westeuropa', 'suedeuropa'],
  ['suedeuropa', 'ukraine'],
  // Afrika
  ['nordafrika', 'aegypten'],
  ['nordafrika', 'ostafrika'],
  ['nordafrika', 'kongo'],
  ['aegypten', 'ostafrika'],
  ['kongo', 'ostafrika'],
  ['kongo', 'suedafrika'],
  ['ostafrika', 'suedafrika'],
  ['ostafrika', 'madagaskar'],
  ['suedafrika', 'madagaskar', 'sea'],
  // Asien
  ['ural', 'sibirien'],
  ['ural', 'china'],
  ['ural', 'afghanistan'],
  ['sibirien', 'jakutsk'],
  ['sibirien', 'irkutsk'],
  ['sibirien', 'mongolei'],
  ['sibirien', 'china'],
  ['jakutsk', 'irkutsk'],
  ['jakutsk', 'kamtschatka'],
  ['irkutsk', 'kamtschatka'],
  ['irkutsk', 'mongolei'],
  ['kamtschatka', 'mongolei'],
  ['kamtschatka', 'japan', 'sea'],
  ['mongolei', 'japan', 'sea'],
  ['mongolei', 'china'],
  ['afghanistan', 'china'],
  ['afghanistan', 'indien'],
  ['afghanistan', 'naher_osten'],
  ['china', 'indien'],
  ['china', 'siam'],
  ['indien', 'naher_osten'],
  ['indien', 'siam'],
  ['siam', 'indonesien', 'sea'],
  // Ozeanien
  ['indonesien', 'neuguinea', 'sea'],
  ['indonesien', 'westaustralien', 'sea'],
  ['neuguinea', 'westaustralien', 'sea'],
  ['neuguinea', 'ostaustralien', 'sea'],
  ['westaustralien', 'ostaustralien'],
  // Interkontinental
  ['alaska', 'kamtschatka', 'wrap'],
  ['groenland', 'island', 'sea'],
  ['groenland', 'nordwest_territorium', 'sea'],
  ['groenland', 'quebec', 'sea'],
  ['japan', 'neuguinea', 'sea'],
  ['mittelamerika', 'venezuela'],
  ['brasilien', 'nordafrika', 'sea'],
  ['westeuropa', 'nordafrika', 'sea'],
  ['suedeuropa', 'nordafrika', 'sea'],
  ['suedeuropa', 'aegypten', 'sea'],
  ['suedeuropa', 'naher_osten'],
  ['ukraine', 'ural'],
  ['ukraine', 'afghanistan'],
  ['ukraine', 'naher_osten'],
  ['aegypten', 'naher_osten'],
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
