// Définition des circuits.
// points : ligne centrale (x, z) en boucle fermée. Le premier point est la ligne d'arrivée,
// et la course part dans la direction du deuxième point.

// Circuits proposés dans le menu (les autres restent définis, prêts à être remis).
export const CIRCUITS_ACTIFS = ["dino"];

export const CIRCUITS = {
  prairie: {
    nom: "prairie",
    points: [
      [0, -40], [0, 40], [10, 100], [50, 135], [100, 140], [140, 115], [150, 70],
      [130, 30], [105, 0], [110, -40], [140, -75], [140, -120], [110, -150],
      [60, -160], [20, -150], [0, -120],
    ],
    echelle: 0.85,
    largeur: 16, // largeur de la route
    marge: 6, // herbe entre la route et la barrière
    ciel: { haut: 0x3d9bff, horizon: 0xd4f0ff },
    sol: 0x6cc24a,
    horsPiste: 0x7bc950, // couleur des bouffées quand on roule hors de la route
    bordure: [0xe8322f, 0xffffff],
    barriere: [0xffd34d, 0x2d7ff9],
    decor: "prairie",
  },

  plage: {
    nom: "plage",
    points: [
      [0, -40], [0, 50], [20, 110], [70, 135], [120, 115], [140, 60], [150, 0],
      [175, -60], [155, -120], [95, -145], [40, -135], [10, -100],
    ],
    echelle: 0.85,
    largeur: 16,
    marge: 6,
    ciel: { haut: 0x1e90ff, horizon: 0xbff0ff },
    sol: 0xf3d98b,
    horsPiste: 0xf5e2a8,
    bordure: [0xff6b6b, 0xffffff],
    barriere: [0x20c997, 0xffffff],
    route: 0xf0e6d8, // teinte du bitume (un peu ensablé)
    decor: "plage",
  },

  neige: {
    nom: "neige",
    points: [
      [0, -40], [0, 40], [-20, 100], [-70, 130], [-120, 110], [-135, 60], [-105, 15],
      [-110, -35], [-145, -80], [-125, -140], [-65, -155], [-20, -115],
    ],
    echelle: 0.85,
    largeur: 16,
    marge: 6,
    ciel: { haut: 0x7fb2e5, horizon: 0xeef6ff },
    sol: 0xf4f8ff,
    horsPiste: 0xffffff,
    bordure: [0x339af0, 0xffffff],
    barriere: [0xe8322f, 0xffffff],
    route: 0xd8e4ff,
    decor: "neige",
  },

  dino: {
    nom: "dino",
    points: [
      // ~1285 m : 4 grandes lignes droites (départ, haut, droite, bas), virages larges (rayon > 35 m)
      [0, -50], [0, 50], [15, 115], [60, 160], [130, 178], [210, 178], [275, 155], [305, 105],
      [310, 30], [310, -50], [295, -115], [255, -158], [195, -172], [130, -174], [70, -180],
      [15, -200], [-35, -240], [-90, -262], [-140, -240], [-155, -190], [-135, -152], [-95, -135],
      [-50, -130], [-18, -112], [-3, -88],
    ],
    echantillons: 1120, // ~1,15 m entre deux échantillons (physique précise)
    // tremplins dans les lignes droites du départ, du haut et de droite ; la tête du T-rex
    // occupe celle du bas (voir decors-themes.js) ; il reste ~100 m libres en haut et à droite
    tremplins: [0.065, 0.262, 0.452],
    tremplinsFenetre: 0.02, // on reste dans ces lignes droites (sinon ils iraient sur celle du T-rex)
    echelle: 0.85,
    largeur: 16,
    marge: 6,
    ciel: { haut: 0xff9e57, horizon: 0xffe3b3 },
    sol: 0x8fbf4a,
    horsPiste: 0x9c7a4a,
    bordure: [0xff922b, 0xfff3bf],
    barriere: [0x8b5a2b, 0xd9a066],
    route: 0xe8dcc8,
    decor: "dino",
  },

  jouets: {
    nom: "jouets",
    points: [
      [0, -40], [0, 50], [25, 100], [80, 110], [120, 80], [110, 30], [140, -10],
      [175, -50], [160, -110], [100, -130], [45, -120], [10, -95],
    ],
    echelle: 0.85,
    largeur: 16,
    marge: 6,
    ciel: { haut: 0xa5d8ff, horizon: 0xfff0f6 },
    sol: 0xd9a066, // parquet
    horsPiste: 0xffd8a8,
    bordure: [0x4dabf7, 0xffd43b],
    barriere: [0xff6b6b, 0x51cf66],
    route: 0xffe3e3,
    decor: "jouets",
  },

  concert: {
    nom: "concert",
    points: [
      [0, -40], [0, 40], [-25, 95], [-80, 120], [-130, 95], [-140, 40], [-110, 0],
      [-140, -45], [-130, -110], [-75, -140], [-25, -110],
    ],
    echelle: 0.85,
    largeur: 16,
    marge: 6,
    ciel: { haut: 0x1a0b3d, horizon: 0x7b2c9e },
    sol: 0x2b1b4f,
    horsPiste: 0xf783ac,
    bordure: [0xf783ac, 0x66d9e8],
    barriere: [0xff4dd2, 0x22b8cf],
    route: 0xb197fc,
    lumiere: 1.5, // un peu plus sombre : c'est le soir
    decor: "concert",
  },
};
