import * as THREE from "three";

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

  const decor = new THREE.Group();
  decor.name = "velodrome";
  groupe.add(decor);
  decor.add(murExterieur(piste, exterieur, force));
  decor.add(lignes(piste, interieur, force));
  piste.velodrome = { debut: DEBUT, fin: FIN, plein: PLEIN, finPlein: FIN_PLEIN, angle: ANGLE, interieur };
}

/** Point du monde à l'échantillon i, au décalage lat, à la hauteur y. */
const pt = (P, i, lat, y) => [P.cx[i] + P.nx[i] * lat, y, P.cz[i] + P.nz[i] * lat];

/**
 * Mur extérieur : il prolonge la route penchée et se recourbe jusqu'à la verticale (bois clair,
 * bande rouge et blanche en haut, chapeau blanc), puis redescend jusqu'au sol (jupe de béton
 * avec une bande bleue). Un seul maillage à couleurs par sommet.
 */
function murExterieur(P, ext, force) {
  const { demi } = P;
  const bord = demi + 1.4; // bout de la bordure haute
  const BOIS = new THREE.Color(0xf1d3a1), BOIS2 = new THREE.Color(0xe2b97c);
  const ROUGE = new THREE.Color(0xe8322f), BLANC = new THREE.Color(0xffffff);
  const BETON = new THREE.Color(0xd5d9de), BLEU = new THREE.Color(0x339af0);
  // profil en coupe (d vers l'extérieur depuis le bord, y vers le haut) pour un échantillon
  const profil = (i, f) => {
    const aRoute = Math.abs(P.devers[i]);
    const h0 = P.hDevers(P.devers[i], ext * bord) + 0.02;
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
  const pos = [], col = [];
  for (let i = DEBUT; i < FIN; i++) {
    const j = i + 1;
    const fi = force(i - DEBUT), fj = force(j - DEBUT);
    const A = profil(i, fi), B = profil(j, fj);
    for (let k = 0; k < A.length - 1; k++) {
      const a0 = pt(P, i, ext * (bord + A[k].d), A[k].y), a1 = pt(P, i, ext * (bord + A[k + 1].d), A[k + 1].y);
      const b0 = pt(P, j, ext * (bord + B[k].d), B[k].y), b1 = pt(P, j, ext * (bord + B[k + 1].d), B[k + 1].y);
      const t = A[k + 1].c;
      const c = t === "bande" ? ((i >> 1) % 2 ? BLANC : ROUGE) : t === "chapeau" ? BLANC : t === "bleu" ? BLEU : t === "beton" ? BETON : (i >> 2) % 2 ? BOIS2 : BOIS;
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
      for (let n = 0; n < 6; n++) col.push(c.r, c.g, c.b);
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
function lignes(P, int, force) {
  const { demi } = P;
  const bandes = [
    { de: 0, a: 1.3, c: 0x4dabf7 }, // côte d'azur
    { de: 2.0, a: 2.3, c: 0x212529 }, // ligne noire
    { de: 4.4, a: 4.75, c: 0xe8322f }, // ligne rouge
    { de: 10.6, a: 10.95, c: 0x1c7ed6 }, // ligne bleue
  ];
  const pos = [], col = [];
  const cc = new THREE.Color();
  for (let i = DEBUT; i < FIN; i++) {
    const j = i + 1;
    if (force(i - DEBUT) < 0.02 && force(j - DEBUT) < 0.02) continue;
    // la route n'a que 2 sommets en travers : quand le dévers change d'un échantillon au suivant,
    // ses deux triangles ne sont plus dans le même plan (écart au plus 1/4 de la différence de
    // hauteur du bord haut) ; on lève les lignes d'autant pour qu'elles ne passent pas dessous
    const dHaut = Math.abs(P.hDevers(P.devers[j], -int * demi) - P.hDevers(P.devers[i], -int * demi));
    const dessus = 0.05 + dHaut * 0.3;
    for (const B of bandes) {
      cc.set(B.c);
      const l0 = int * (demi - B.de), l1 = int * (demi - B.a);
      const h = (k, l) => P.hDevers(P.devers[k], l) + dessus;
      const a0 = pt(P, i, l0, h(i, l0)), a1 = pt(P, i, l1, h(i, l1)), b0 = pt(P, j, l0, h(j, l0)), b1 = pt(P, j, l1, h(j, l1));
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
      for (let n = 0; n < 6; n++) col.push(cc.r, cc.g, cc.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
}
