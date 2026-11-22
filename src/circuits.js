// Définition des circuits.
// points : ligne centrale (x, z) en boucle fermée. Le premier point est la ligne d'arrivée,
// et la course part dans la direction du deuxième point.

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
};
