import * as THREE from "three";
import { CIRCUITS } from "./circuits.js";
import { textureAsphalte } from "./textures.js";

// Virage relevé façon vélodrome, dans le virage entre le ravin du ptérodactyle et la ligne
// droite du diplodocus. Ce n'est pas un passage scripté : la route est vraiment penchée
// (piste.incliner) et la physique s'en sert (hauteur selon le décalage latéral, roulis du kart).
// Le dévers monte doucement à l'entrée, reste à fond au milieu du virage et redescend à la
// sortie. Le bord bas (intérieur du virage) reste au sol ; dehors, un mur de bois clair se
// recourbe vers le haut, et une jupe de béton cache le dessous de la route.

const DEBUT = 286; // échantillons (le ptérodactyle dépose les karts vers 274)
const PLEIN = 316; // dévers à fond de PLEIN à FIN_PLEIN
const FIN_PLEIN = 342;
const FIN = 372; // (l'entonnoir du diplodocus commence vers 374)
const ANGLE = THREE.MathUtils.degToRad(38); // dévers au milieu du virage
const lisse = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Pose le virage relevé sur la piste (dévers, murs physiques, décor). */
export function virageReleve(piste, groupe) {
  const { N, pas, demi } = piste;
  const milieu = Math.round((PLEIN + FIN_PLEIN) / 2);
  // côté intérieur du virage (+1 = gauche) : c'est l'extérieur qui monte
  const a = (milieu - 12 + N) % N, b = (milieu + 12) % N;
  const interieur = Math.sign((piste.tx[b] - piste.tx[a]) * piste.nx[milieu] + (piste.tz[b] - piste.tz[a]) * piste.nz[milieu]) || 1;
  const exterieur = -interieur;
  const force = (m) => {
    const i = DEBUT + m;
    if (i < PLEIN) return lisse((i - DEBUT) / (PLEIN - DEBUT));
    if (i > FIN_PLEIN) return lisse((FIN - i) / (FIN - FIN_PLEIN));
    return 1;
  };
  piste.incliner(DEBUT, FIN, (m) => exterieur * ANGLE * force(m));

  // on reste sur la route penchée : le mur extérieur et le bord intérieur arrêtent les karts
  const libre = piste.demi + piste.marge - 1.0;
  for (let m = 0; m <= FIN - DEBUT; m++) piste.limiter(DEBUT + m, demi + 0.5 + (libre - demi - 0.5) * (1 - lisse(force(m) * 3)));

  // la route standard (2 sommets en travers) ne suit pas assez bien le dévers : on la cache ici
  // et on dessine une route plus fine dont chaque sommet est à la hauteur donnée par la physique
  piste.masquerRoute(DEBUT, FIN);
  const S = new Surface(piste);
  const decor = new THREE.Group();
  decor.name = "velodrome";
  groupe.add(decor);
  decor.add(...routeFine(S));
  decor.add(murExterieur(S, exterieur, force));
  decor.add(lignes(S, interieur, force));
  piste.velodrome = { debut: DEBUT, fin: FIN, plein: PLEIN, finPlein: FIN_PLEIN, angle: ANGLE, interieur, surface: S };
}

const SOUS = 4; // sommets par échantillon le long de la route (raccords : le dévers y change vite)
const COLONNES = 8; // colonnes de la route en travers
// au-dessus de la surface de la physique, comme partout (piste.js) : route +2 cm, bordures +3 cm

/**
 * Points de la surface du virage. u = position le long de la route en échantillons (fractionnaire),
 * lat = décalage latéral. Le point est placé comme le fait la physique (voir deversA dans piste.js :
 * avance corrigée par la courbure) et sa hauteur EST celle de la physique (piste.hauteurTremplin).
 */
class Surface {
  constructor(P) {
    this.P = P;
  }
  /** Position au sol [x, z] (repère de l'échantillon le plus proche). */
  xz(u, lat) {
    const P = this.P, N = P.N;
    const j = Math.round(u), i = ((j % N) + N) % N;
    const long = (u - j) * P.pas * (1 - lat * P.courbure[i]);
    return [P.cx[i] + P.nx[i] * lat + P.tx[i] * long, P.cz[i] + P.nz[i] * lat + P.tz[i] * long, i];
  }
  /** Hauteur de la physique au point du monde (x, z). */
  hauteur(x, z, pres) {
    const loc = this.P.localiser(x, z, pres);
    return this.P.hauteurTremplin(loc.indice, loc.lateral, loc.long).h;
  }
  /** Point [x, y, z] de la surface, levé de dessus. */
  point(u, lat, dessus = 0) {
    const [x, z, i] = this.xz(u, lat);
    return [x, this.hauteur(x, z, i) + dessus, z];
  }
}

/** Grille indexée : rangées le long (u), colonnes en travers ; sommet(u, k) → { p, uv?, c? }. */
function grille(us, nbCol, sommet) {
  const pos = [], uv = [], col = [], idx = [];
  for (const u of us)
    for (let k = 0; k < nbCol; k++) {
      const s = sommet(u, k);
      pos.push(...s.p);
      if (s.uv) uv.push(...s.uv);
      if (s.c) col.push(s.c.r, s.c.g, s.c.b);
    }
  for (let r = 0; r < us.length - 1; r++)
    for (let k = 0; k < nbCol - 1; k++) {
      const a = r * nbCol + k, b = a + 1, c = a + nbCol, d = c + 1;
      idx.push(a, b, c, b, d, c); // face avant vers le haut (comme la route de piste.js)
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (uv.length) g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (col.length) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Abscisses de DEBUT à FIN, SOUS par échantillon. */
const abscisses = () => Array.from({ length: (FIN - DEBUT) * SOUS + 1 }, (_, n) => DEBUT + n / SOUS);

/** Route (bitume, comme la route standard) et bordures rouges et blanches, posées sur la surface. */
function routeFine(S) {
  const P = S.P, { demi, pas } = P, def = CIRCUITS.dino;
  const us = abscisses();
  // route : de +demi (gauche, u de texture 0) à -demi (droite, 1), comme dans piste.js
  const gRoute = grille(us, COLONNES + 1, (u, k) => {
    const lat = demi - (2 * demi * k) / COLONNES;
    return { p: S.point(u, lat, 0.02), uv: [k / COLONNES, (u * pas) / 18] };
  });
  const route = new THREE.Mesh(gRoute, new THREE.MeshLambertMaterial({ map: textureAsphalte(), color: def.route ?? 0xffffff }));
  // bordures : couleur par échantillon (rangées doublées aux changements de couleur)
  const c0 = new THREE.Color(def.bordure[0]), c1 = new THREE.Color(def.bordure[1]);
  const maillages = [route];
  for (const cote of [1, -1]) {
    const pos = [], col = [];
    for (let n = 0; n < us.length - 1; n++) {
      const u0 = us[n], u1 = us[n + 1];
      const c = (Math.floor(u0) >> 1) % 2 ? c1 : c0;
      const a0 = S.point(u0, cote * demi, 0.03), a1 = S.point(u0, cote * (demi + 1.4), 0.03);
      const b0 = S.point(u1, cote * demi, 0.03), b1 = S.point(u1, cote * (demi + 1.4), 0.03);
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
      for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    maillages.push(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }
  return maillages;
}

/**
 * Mur extérieur : il prolonge la route penchée et se recourbe jusqu'à la verticale (bois clair,
 * bande rouge et blanche en haut, chapeau blanc), puis redescend jusqu'au sol (jupe de béton
 * avec une bande bleue). Un seul maillage à couleurs par sommet.
 */
function murExterieur(S, ext, force) {
  const P = S.P, { demi, N } = P;
  const bord = demi + 1.4; // bout de la bordure haute
  const BOIS = new THREE.Color(0xf1d3a1), BOIS2 = new THREE.Color(0xe2b97c);
  const ROUGE = new THREE.Color(0xe8322f), BLANC = new THREE.Color(0xffffff);
  const BETON = new THREE.Color(0xd5d9de), BLEU = new THREE.Color(0x339af0);
  const deversU = (u) => {
    const i = Math.floor(u), f = u - i;
    return Math.abs(P.devers[i % N] * (1 - f) + P.devers[(i + 1) % N] * f);
  };
  // profil en coupe (d vers l'extérieur depuis le bord, y vers le haut) à l'abscisse u
  const profil = (u) => {
    const aRoute = deversU(u), f = force(u - DEBUT);
    const h0 = S.point(u, ext * bord, 0.03)[1];
    const pts = [{ d: 0, y: h0, c: "bois" }];
    const nb = 6, haut = 0.15 + 2.6 * f; // le mur grandit avec le dévers
    let d = 0, y = h0;
    for (let k = 1; k <= nb; k++) {
      // segments de même hauteur, de plus en plus raides (de la pente de la route à presque vertical)
      const ang = aRoute + (THREE.MathUtils.degToRad(84) - aRoute) * (k / nb);
      d += haut / nb / Math.tan(Math.max(0.05, ang));
      y += haut / nb;
      pts.push({ d, y, c: k >= nb - 1 ? "bande" : "bois" });
    }
    pts.push({ d: d + 0.35, y, c: "chapeau" }); // chapeau
    pts.push({ d: d + 0.35, y: y - 0.6, c: "bleu" }); // haut de la jupe : bande bleue
    pts.push({ d: d + 0.35, y: 0, c: "beton" }); // jupe jusqu'au sol
    return pts;
  };
  const ou = (u, d, y) => {
    const [x, z] = S.xz(u, ext * (bord + d));
    return [x, y, z];
  };
  const pos = [], col = [];
  const us = abscisses();
  let B = profil(us[0]);
  for (let n = 0; n < us.length - 1; n++) {
    const u0 = us[n], u1 = us[n + 1], i = Math.floor(u0);
    const A = B;
    B = profil(u1);
    for (let k = 0; k < A.length - 1; k++) {
      const a0 = ou(u0, A[k].d, A[k].y), a1 = ou(u0, A[k + 1].d, A[k + 1].y);
      const b0 = ou(u1, B[k].d, B[k].y), b1 = ou(u1, B[k + 1].d, B[k + 1].y);
      const t = A[k + 1].c;
      const c = t === "bande" ? ((i >> 1) % 2 ? BLANC : ROUGE) : t === "chapeau" ? BLANC : t === "bleu" ? BLEU : t === "beton" ? BETON : (i >> 2) % 2 ? BOIS2 : BOIS;
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
      for (let v = 0; v < 6; v++) col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

/**
 * Lignes peintes du vélodrome sur la route penchée (depuis le bord intérieur) : la « côte d'azur »
 * bleue, puis les lignes noire, rouge et bleue. Elles apparaissent avec le dévers.
 */
function lignes(S, int, force) {
  const { demi } = S.P;
  const bandes = [
    { de: 0, a: 1.3, c: 0x4dabf7 }, // côte d'azur
    { de: 2.0, a: 2.3, c: 0x212529 }, // ligne noire
    { de: 4.4, a: 4.75, c: 0xe8322f }, // ligne rouge
    { de: 10.6, a: 10.95, c: 0x1c7ed6 }, // ligne bleue
  ];
  const pos = [], col = [];
  const cc = new THREE.Color();
  const us = abscisses();
  for (let n = 0; n < us.length - 1; n++) {
    const u0 = us[n], u1 = us[n + 1];
    if (force(u0 - DEBUT) < 0.02 && force(u1 - DEBUT) < 0.02) continue;
    for (const B of bandes) {
      cc.set(B.c);
      const l0 = int * (demi - B.de), l1 = int * (demi - B.a);
      const a0 = S.point(u0, l0, 0.05), a1 = S.point(u0, l1, 0.05), b0 = S.point(u1, l0, 0.05), b1 = S.point(u1, l1, 0.05);
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
      for (let v = 0; v < 6; v++) col.push(cc.r, cc.g, cc.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
}
