import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { planter, placeRocher, MARGE_ROCHER } from "./vegetation.js";
import { audio } from "./audio.js";
import { percerSol } from "./decor.js";

// Le T-rex géant couché du circuit Dinosaures : la route entre dans sa gueule grande ouverte,
// passe dans sa gorge puis dans un long tunnel de chair (son ventre : parois rouges, côtes
// blanches, bulles lumineuses) et ressort à l'air libre par l'arrière de son corps, sous la
// queue. C'est la VRAIE route : pas de téléportation, tout le monde (joueur et adversaires) y
// roule avec sa physique normale ; on voit le corps allongé du dehors.
//
// Tout est construit dans le repère de la piste : d = mètres le long de la route depuis les
// lèvres (la gueule), l = latéral (> 0 à gauche), y = hauteur ; voir point().
//
// Raccord bouche -> ventre : la gorge n'est pas un tuyau posé dans la bouche. Une fois la tête
// chargée, on mesure la cavité de la bouche sur le maillage (rayons en travers, mesurerCavite)
// et la gorge part de ces parois réelles, avec leurs couleurs (texture), ferme les côtés ouverts
// de la gueule par des joues, puis s'élargit et se fond dans la chair du tunnel (construireGorge).
//
// Accroches :
//  - piste.limiter(i, demi) : murs invisibles des dents et des parois du ventre (piste.js) ;
//    piste.retrecissements : l'entonnoir de rochers avant la gueule.
//  - piste.zonesDecor : emprise de la tête et du corps (la forêt et les dinos n'y vont pas).
//  - piste.teteTrex = { indice (centre de la tête), gueule, sortie, objet } (bonbons, décor).
//  - l'objet renvoyé a update(dt) (appelé avec les mixers du décor) : dans le ventre,
//    l'ambiance (brouillard, lumières) devient rouge sombre en douceur selon la position de la
//    caméra, sans toucher course.js ; rugissement quand le joueur arrive devant la gueule.

export const VENTRE = {
  gueule: 0.518, // fraction du tour : les lèvres (fin du grand virage après le diplodocus)
  sortie: 0.652, // fraction du tour : la sortie du tunnel (avant la tranchée de l'aquarium, 0,66)
  echelleTete: 24, // agrandissement du modèle de la tête (≈ 47 m de long, gueule ≈ 9 m de large)
  entonnoir: 48, // m avant la gueule où la route se resserre entre des rochers
  demiGueule: 3.6, // demi-largeur où l'on roule entre les dents (mesurée : dents à ±4,6 m)
  dTube: 11, // m après les lèvres : la gorge commence à s'élargir (murs, ambiance rouge)
  dGorge: 4, // m après les lèvres : début de la gorge (elle épouse les parois de la bouche)
  dJoint: 26, // m après les lèvres : la gorge rejoint le tunnel de chair (caché dans la tête)
  dLarge: 34, // m après les lèvres : le tunnel a sa pleine taille
  murTube: 9.6, // latéral du pied des parois (les bordures finissent à 9,4 m)
  hautTube: 9.5, // hauteur de la voûte
  dCou: 26, // m après les lèvres : début du cou (caché dans la tête)
};

/** Ambiance dans le ventre (mêmes clés que celle de l'aquarium) : sombre et rouge, mais lisible. */
const AMBIANCE_VENTRE = {
  brouillard: [0x3d0c18, 8, 75],
  ciel: [0xffc2cc, 0x5a1424, 1.35],
  soleil: 0.2,
  fond: 0x1a0509,
};

// Dans le modèle de la tête, la gueule ne regarde pas +x et la tête n'est pas centrée sur
// l'origine. Mesuré (pas réglé à l'œil) : plan vertical de symétrie gauche/droite de la tête
// (recherche sur l'angle et le décalage, erreur moyenne 0,024 unité contre ~0,07 ailleurs).
const ROTATION_GUEULE = 0.86; // radians : direction du museau dans le modèle (axe de symétrie)
const PLAN_SYMETRIE = 0.06; // unités du modèle : écart du plan de symétrie à l'origine

const doux = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const interpole = (table, u) => {
  if (u <= table[0][0]) return table[0][1];
  for (let k = 1; k < table.length; k++) {
    if (u <= table[k][0]) {
      const [u0, a] = table[k - 1], [u1, b] = table[k];
      const t = (u - u0) / (u1 - u0);
      return a + (b - a) * t * t * (3 - 2 * t);
    }
  }
  return table[table.length - 1][1];
};

/** Indices (échantillons) de la gueule, de la sortie et du centre de la tête. */
export function indicesTrex(piste) {
  const N = piste.N;
  const gueule = Math.round(N * VENTRE.gueule), sortie = Math.round(N * VENTRE.sortie);
  return { gueule, sortie, tete: (gueule + Math.round(20 / piste.pas)) % N };
}

export function installerTrex(groupe, piste) {
  const { N, pas, cx, cz, nx, nz, tx, tz } = piste;
  const V = VENTRE;
  const { gueule, sortie, tete: iTete } = indicesTrex(piste);
  const D_FIN = ((sortie - gueule + N) % N) * pas; // longueur de la gueule à la sortie (m)

  // --- repère de la piste ---
  /** Point du monde à d mètres après les lèvres, latéral l, hauteur y. */
  function point(d, l, y, v = new THREE.Vector3()) {
    const s = gueule + d / pas;
    const i0 = Math.floor(s), f = s - i0, i = ((i0 % N) + N) % N, j = (i + 1) % N;
    const px = cx[i] + (cx[j] - cx[i]) * f, pz = cz[i] + (cz[j] - cz[i]) * f;
    let ex = nx[i] + (nx[j] - nx[i]) * f, ez = nz[i] + (nz[j] - nz[i]) * f;
    const n = Math.hypot(ex, ez);
    ex /= n;
    ez /= n;
    return v.set(px + ex * l, y, pz + ez * l);
  }
  /** Position (d, l) d'un point du monde par rapport aux lèvres. */
  function local(x, z, indice = gueule) {
    const r = piste.localiser(x, z, indice);
    let k = (r.indice - gueule + N) % N;
    if (k > N / 2) k -= N;
    return { d: k * pas + r.long, l: r.lateral, indice: r.indice };
  }
  /** Repère (latéral, haut, avant) à d : pour poser une pièce dessinée en (l, y, avant). */
  function repere(d) {
    const i = (gueule + Math.round(d / pas)) % N;
    return new THREE.Matrix4()
      .makeBasis(new THREE.Vector3(nx[i], 0, nz[i]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(tx[i], 0, tz[i]))
      .setPosition(point(d, 0, 0));
  }
  // côté extérieur du circuit à la sortie (la queue s'y enroule)
  const ext = (() => {
    const i = sortie;
    return Math.sign((cx[i] - piste.centre.x) * nx[i] + (cz[i] - piste.centre.z) * nz[i]) || 1;
  })();

  // --- le tunnel de chair : taille de la paroi selon d ---
  /** Demi-largeur et hauteur de la paroi intérieure à d (gorge étroite, ventre, sortie évasée). */
  function paroi(d) {
    const g = doux(V.dTube, V.dLarge, d), e = doux(D_FIN - 7, D_FIN, d);
    return { W: 5.4 + (V.murTube - 5.4) * g + 1.2 * e, H: 9.2 + (V.hautTube - 9.2) * g + 1.3 * e };
  }

  // --- murs invisibles : entonnoir de rochers, dents, gorge, ventre ---
  const nEntonnoir = Math.round(V.entonnoir / pas);
  piste.retrecissements.push({ debut: (gueule - nEntonnoir + N) % N, fin: gueule, demiMin: V.demiGueule });
  for (let k = 0; k <= Math.round(D_FIN / pas); k++) {
    const d = k * pas;
    const { W } = paroi(d);
    // au pied d'une paroi en voûte, un kart (≈ 1 m de demi-largeur, 1,5 m de haut) touche à W - 1,4
    const demi = d < V.dTube + 2 ? V.demiGueule : Math.max(V.demiGueule, Math.min(W - 1.4, V.demiGueule + (d - V.dTube - 2) * 0.35));
    piste.limiter(gueule + k, demi);
  }

  // emprise de la tête et du corps : ni arbres, ni plantes, ni dinos
  (piste.zonesDecor ??= []).push(
    { nom: "tete trex", debut: (gueule - 3 + N) % N, fin: (gueule + Math.round(50 / pas)) % N, demi: 28 },
    { nom: "corps trex", debut: gueule, fin: (sortie + Math.round(14 / pas)) % N, demi: 35 },
  );
  piste.teteTrex = { indice: iTete, gueule, sortie, objet: null };

  // --- rochers le long de l'entonnoir (vrais rochers du pack, comme avant) ---
  // Ce sont eux qui "font" les murs : leur face intérieure est juste derrière le mur invisible
  // (limite + demi-largeur d'un kart), jamais dans la voie (avant, leur centre était à 1,6 m du
  // mur et leur rayon de 1,7 à 2,7 m : les karts entraient dans la pierre).
  const ROCHERS = ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"];
  const rochers = ROCHERS.map(() => []);
  for (let k = 0; k <= nEntonnoir - 2; k += 2) {
    const j = (gueule - nEntonnoir + k + N) % N;
    const voie = piste.limiteLaterale(j);
    if (voie + 1.6 > piste.demi + piste.marge) continue;
    for (const s of [1, -1]) {
      const n = (k / 2 + (s > 0 ? 0 : 1)) % 3, e = 0.9 + ((k * 7) % 5) * 0.08;
      // la voie la plus large sur toute l'étendue du rocher (l'entonnoir se resserre)
      const rayon = (placeRocher(ROCHERS[n]) ?? 2.3) * e, nr = Math.ceil(rayon / pas);
      let large = voie;
      for (let q = -nr; q <= nr; q++) large = Math.max(large, piste.limiteLaterale((j + q + N) % N));
      const l = large + MARGE_ROCHER + rayon;
      rochers[n].push({ x: cx[j] + nx[j] * s * l, z: cz[j] + nz[j] * s * l, s: e, y: -0.2, r: k * 1.7 + s });
    }
  }
  ROCHERS.forEach((nom, n) => planter(groupe, nom, rochers[n]));

  const trex = new THREE.Group();
  trex.name = "T-rex couché";
  groupe.add(trex);

  // pas de grand sol sous la route du ventre (il "scintillait" à travers la route, vu de près :
  // ses triangles font des centaines de mètres) ; le bord du trou est caché sous les bordures
  {
    const contour = [], n0 = Math.round((V.dTube + 4) / pas), n1 = Math.round((D_FIN - 4) / pas);
    for (let k = n0; k <= n1; k++) contour.push(point(k * pas, piste.demi + 1.2, 0));
    for (let k = n1; k >= n0; k--) contour.push(point(k * pas, -(piste.demi + 1.2), 0));
    percerSol(groupe, contour);
  }

  // ======================= le ventre (tunnel de chair) =======================
  // Il commence à V.dJoint, caché dans la tête : avant, c'est la gorge (construite quand la tête
  // est chargée, voir construireGorge) qui part des parois réelles de la bouche.
  const M = 16; // segments de la voûte
  let accroche = null; // le maillage du tunnel : il retrouve la scène et la caméra au rendu
  const nTube = Math.ceil((D_FIN - V.dJoint) / pas);
  /** Point m (0 = pied gauche, M = pied droit) de la paroi du tunnel à d, en (latéral, hauteur). */
  const paroiLY = (d, m) => {
    const { W, H } = paroi(d), a = (m / M) * Math.PI;
    // petites bosses de chair (fixes) pour que ça ne fasse pas un tuyau lisse
    const b = 1 + 0.035 * Math.sin(d * 0.9 + m * 1.7) + 0.025 * Math.sin(d * 2.3 - m * 3.1);
    return [Math.cos(a) * W * b, Math.sin(a) * H * b];
  };
  const ptParoi = (d, m, v) => {
    const [l, y] = paroiLY(d, m);
    return point(d, l, y, v);
  };
  const CHAIR = [new THREE.Color(0x9c2238), new THREE.Color(0xc23a58), new THREE.Color(0x6a1428), new THREE.Color(0xe0708a)];
  /** Couleur de la chair du tunnel (bandes, plis sombres réguliers, ruban plus clair en haut). */
  const couleurChair = (k, m) => {
    const [c1, c2, c3, c4] = CHAIR;
    return k % 12 < 2 ? c3 : m >= 7 && m <= 8 ? c4 : (m + (k >> 2)) % 2 ? c1 : c2;
  };
  // un seul matériau pour la gorge et le tunnel ; faces tournées vers l'intérieur seulement : vu
  // du dehors, rien de la chair ne peut dépasser de la tête ou du corps
  const matChair = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide, flatShading: true, emissive: 0x2a0610 });
  {
    const pos = [], col = [];
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
    for (let k = 0; k < nTube; k++) {
      const d0 = V.dJoint + k * pas, d1 = Math.min(D_FIN, d0 + pas);
      for (let m = 0; m < M; m++) {
        const c = couleurChair(k, m);
        ptParoi(d0, m, A); ptParoi(d1, m, B); ptParoi(d0, m + 1, C); ptParoi(d1, m + 1, D);
        for (const p of [A, B, C, B, D, C]) {
          pos.push(p.x, p.y, p.z);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const tube = new THREE.Mesh(g, matChair);
    tube.name = "ventre";
    tube.frustumCulled = false; // l'accroche onBeforeRender doit être appelée même hors champ
    trex.add(tube);
    accroche = tube;
  }

  // côtes blanches qui enjambent la route
  {
    const cotes = [];
    for (let d = V.dLarge + 2; d < D_FIN - 8; d += 13) {
      const { W, H } = paroi(d);
      const courbe = new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, m) => {
        const a = (m / 12) * Math.PI;
        return point(d, Math.cos(a) * (W - 0.35), Math.sin(a) * (H - 0.35));
      }));
      cotes.push(new THREE.TubeGeometry(courbe, 28, 0.55, 6, false));
    }
    trex.add(new THREE.Mesh(mergeGeometries(cotes), new THREE.MeshLambertMaterial({ color: 0xf1e3c8, emissive: 0x3a2a20 })));
  }

  // bulles lumineuses sur les parois (elles palpitent doucement)
  const NB_BULLES = 70;
  const bulles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), NB_BULLES);
  const infoBulles = [];
  {
    const c = new THREE.Color();
    const couleurs = [0xb2f2bb, 0xffec99, 0xffc9c9, 0xd0bfff];
    let graine = 5;
    const rnd = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
    for (let n = 0; n < NB_BULLES; n++) {
      const d = V.dJoint + 1 + rnd() * (D_FIN - V.dJoint - 5), m = 2 + rnd() * (M - 4);
      infoBulles.push({ p: ptParoi(d, m, new THREE.Vector3()), s: 0.6 + rnd() * 1.2, ph: rnd() * 6.3 });
      bulles.setColorAt(n, c.set(couleurs[n % couleurs.length]));
    }
  }
  trex.add(bulles);

  // ======================= le corps, vu du dehors =======================
  const dBout = D_FIN; // l'arrière du corps : la sortie
  const longCorps = dBout - V.dCou;
  // demi-largeur et hauteur du corps selon u (0 = cou caché dans la tête, 1 = l'arrière)
  const LARG = [[0, 10], [0.1, 12.5], [0.3, 18], [0.5, 20], [0.72, 18.5], [0.88, 15.5], [1, 13]];
  const HAUT = [[0, 12], [0.1, 13], [0.3, 19], [0.45, 21], [0.7, 18], [0.88, 14.5], [1, 12.5]];
  const formeCorps = (d) => {
    const u = (d - V.dCou) / longCorps;
    return { W: interpole(LARG, u), H: interpole(HAUT, u) };
  };
  // couleurs prises sur la tête (texture) : vert-gris olive, rayures sombres sur le dos, ventre crème
  const PEAU = new THREE.Color(0x76804c), RAYURE = new THREE.Color(0x353b22), VENTRE_CLAIR = new THREE.Color(0xd6c48e), DOS = new THREE.Color(0x5a6338);
  const MC = 22; // segments du tour du corps
  const ptCorps = (d, m, v) => {
    const { W, H } = formeCorps(d), a = (m / MC) * Math.PI;
    const c = Math.cos(a), s = Math.sin(a);
    const b = 1 + 0.04 * Math.sin(d * 0.33 + m * 1.3) + 0.03 * Math.sin(d * 0.81 - m * 2.7); // muscles, plis
    return point(d, Math.sign(c) * Math.abs(c) ** 0.8 * W * b, (s ** 0.9 * H - 0.6) * b, v);
  };
  const couleurPeau = (d, m, out) => {
    const s = Math.sin((m / MC) * Math.PI);
    if (s < 0.3) return out.copy(VENTRE_CLAIR); // le ventre, contre le sol
    if (s > 0.8 && Math.floor((d + 3) / 7) % 2 === 0) return out.copy(RAYURE); // rayures sur le dos
    return out.copy(s > 0.92 ? DOS : PEAU);
  };
  const partiesPeau = []; // { geo, couleur } fusionnées en un seul maillage
  {
    const pos = [], col = [];
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3(), c = new THREE.Color();
    const pasCorps = 2 * pas, nCorps = Math.ceil(longCorps / pasCorps);
    for (let k = 0; k < nCorps; k++) {
      const d0 = V.dCou + k * pasCorps, d1 = Math.min(dBout, d0 + pasCorps);
      for (let m = 0; m < MC; m++) {
        couleurPeau(d0, m, c);
        ptCorps(d0, m, A); ptCorps(d1, m, B); ptCorps(d0, m + 1, C); ptCorps(d1, m + 1, D);
        for (const p of [A, C, B, B, C, D]) {
          pos.push(p.x, p.y, p.z);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    // l'arrière du corps : un bord épais autour de la sortie (entre la paroi et la peau)
    const MB = 20, P = new THREE.Vector3(), Q = new THREE.Vector3(), P2 = new THREE.Vector3(), Q2 = new THREE.Vector3();
    const { W: Wt, H: Ht } = paroi(dBout);
    const pBord = (m, v) => {
      const a = (m / MB) * Math.PI;
      return point(dBout, Math.cos(a) * Wt, Math.sin(a) * Ht, v);
    };
    const pPeau = (m, v) => ptCorps(dBout, (m / MB) * MC, v);
    c.copy(RAYURE);
    for (let m = 0; m < MB; m++) {
      pBord(m, P); pPeau(m, Q); pBord(m + 1, P2); pPeau(m + 1, Q2);
      for (const p of [P, Q, P2, P2, Q, Q2]) {
        pos.push(p.x, p.y, p.z);
        col.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    partiesPeau.push(g);
  }

  /** Pièce colorée (géométrie dessinée en (l, y, avant)) posée à d. */
  const piece = (geo, couleur, d, l, y, rotation = null) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (rotation) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rotation));
    g.translate(l, y, 0).applyMatrix4(repere(d));
    const c = new THREE.Color(couleur), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) col.set([c.r, c.g, c.b], k * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.deleteAttribute("uv");
    g.deleteAttribute("normal");
    partiesPeau.push(g);
  };
  // plaques osseuses sur le dos
  for (let d = V.dCou + 18; d < dBout - 6; d += 4.5) {
    const { H } = formeCorps(d), h = 2.2 + 2.2 * Math.sin(((d - V.dCou) / longCorps) * Math.PI);
    piece(new THREE.ConeGeometry(1.6, h, 5).scale(0.5, 1, 1.2), 0x4a3a22, d, 0, H - 1.0 + h / 2);
  }
  // grosses cuisses repliées, pieds à plat vers l'avant (trois griffes), et petits bras
  {
    const uCuisse = 0.74, dC = V.dCou + uCuisse * longCorps, { W: Wc, H: Hc } = formeCorps(dC);
    for (const s of [1, -1]) {
      piece(new THREE.SphereGeometry(1, 10, 8).scale(6.5, 8, 12), PEAU, dC, s * (Wc - 2.5), Hc * 0.36);
      piece(new THREE.SphereGeometry(1, 9, 6).scale(3.2, 1.8, 7.5), DOS, dC + 9, s * (Wc + 2.2), 1.0);
      for (const o of [-1.8, 0, 1.8])
        piece(new THREE.ConeGeometry(0.55, 2.2, 5), 0xf1e6d0, dC + 16.4, s * (Wc + 2.2 + o), 0.6, new THREE.Euler(Math.PI / 2, 0, 0));
    }
    const dB = V.dCou + 0.2 * longCorps, { W: Wb, H: Hb } = formeCorps(dB);
    for (const s of [1, -1]) {
      piece(new THREE.SphereGeometry(1, 8, 6).scale(1.4, 1.4, 4.5), PEAU, dB + 3, s * (Wb + 0.4), Hb * 0.32, new THREE.Euler(0.5, 0, 0));
      for (const o of [-0.5, 0.5])
        piece(new THREE.ConeGeometry(0.3, 1.3, 5), 0xf1e6d0, dB + 7.3, s * (Wb + 0.4 + o), Hb * 0.32 - 1.9, new THREE.Euler(Math.PI / 2 + 0.6, 0, 0));
    }
  }
  // la queue : elle part du haut de l'arrière, passe au-dessus de la route juste après la sortie
  // (bien haut : on roule dessous), puis retombe sur le côté et s'allonge le long du flanc
  {
    const { H: Hb } = formeCorps(dBout);
    const cle = [
      [dBout - 14, 0, Hb - 2.5, 5.2], [dBout - 2, 0, Hb + 0.3, 4.4], [dBout + 5, 0.6 * ext, 12, 3.6],
      [dBout + 8, 9 * ext, 8.5, 3.0], [dBout + 7, 18 * ext, 4, 2.6], [dBout + 1, 25 * ext, 2.2, 2.2],
      [dBout - 10, 28.5 * ext, 1.6, 1.7], [dBout - 26, 29 * ext, 1.2, 1.2], [dBout - 40, 27.5 * ext, 0.9, 0.6], [dBout - 49, 25.5 * ext, 0.6, 0.12],
    ];
    const courbe = new THREE.CatmullRomCurve3(cle.map(([d, l, y]) => new THREE.Vector3(d, l, y)));
    const rayon = new THREE.CatmullRomCurve3(cle.map(([, , , r], k) => new THREE.Vector3(k, r, 0)));
    const NA = 46, NR = 10, pos = [], col = [];
    const anneaux = [];
    const T = new THREE.Vector3(), U = new THREE.Vector3(), Wv = new THREE.Vector3(), haut = new THREE.Vector3(0, 1, 0);
    const monde = (q) => point(q.x, q.y, q.z);
    for (let k = 0; k <= NA; k++) {
      const t = k / NA, c = monde(courbe.getPoint(t)), c2 = monde(courbe.getPoint(Math.min(1, t + 0.01))), c1 = monde(courbe.getPoint(Math.max(0, t - 0.01)));
      T.subVectors(c2, c1).normalize();
      U.crossVectors(T, haut).normalize();
      Wv.crossVectors(U, T).normalize();
      const r = Math.max(0.08, rayon.getPoint(t).y);
      anneaux.push(Array.from({ length: NR }, (_, m) => {
        const a = (m / NR) * Math.PI * 2;
        return c.clone().addScaledVector(U, Math.cos(a) * r).addScaledVector(Wv, Math.sin(a) * r * 0.85);
      }));
    }
    const c = new THREE.Color();
    for (let k = 0; k < NA; k++)
      for (let m = 0; m < NR; m++) {
        const m1 = (m + 1) % NR;
        const dessus = Math.sin((m / NR) * Math.PI * 2) > 0.3;
        c.copy(dessus ? (Math.floor(k / 3) % 2 ? RAYURE : DOS) : PEAU);
        for (const p of [anneaux[k][m], anneaux[k + 1][m], anneaux[k][m1], anneaux[k][m1], anneaux[k + 1][m], anneaux[k + 1][m1]]) {
          pos.push(p.x, p.y, p.z);
          col.push(c.r, c.g, c.b);
        }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    partiesPeau.push(g);
  }
  {
    const g = mergeGeometries(partiesPeau);
    g.computeVertexNormals();
    const corps = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }));
    corps.name = "corps trex";
    trex.add(corps);
  }

  // ======================= la tête (modèle chargé) =======================
  new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "dinos/tete-trex.glb").then((gltf) => {
    const modele = gltf.scene;
    modele.traverse((o) => {
      if (o.isMesh) {
        const map = o.material.map; // texture projetée depuis l'image Gemini (Blender)
        if (map) map.anisotropy = 4;
        // double face : par la gorge ouverte, on ne voit jamais "à travers" la tête
        o.material = map ? new THREE.MeshLambertMaterial({ map, flatShading: true, side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
      }
    });
    const E = V.echelleTete, boite = new THREE.Box3().setFromObject(modele);
    const tete = new THREE.Group();
    tete.add(modele);
    modele.scale.setScalar(E);
    modele.position.y = -boite.min.y * E;
    // orientation : axe du museau le long de la route au milieu de la gueule, plan de symétrie sur l'axe
    const iAxe = (gueule + Math.round(6 / pas)) % N;
    const perp = new THREE.Vector2(-Math.sin(ROTATION_GUEULE), Math.cos(ROTATION_GUEULE));
    modele.position.x = -perp.x * PLAN_SYMETRIE * E;
    modele.position.z = -perp.y * PLAN_SYMETRIE * E;
    tete.rotation.y = piste.angleA(iAxe) + Math.PI / 2 + ROTATION_GUEULE;
    tete.position.copy(point(20, 0, 0));
    // sommets dans le repère de la route (d, l, y)
    const sommets = () => {
      tete.updateMatrixWorld(true);
      const liste = [], v = new THREE.Vector3();
      modele.traverse((o) => {
        if (!o.isMesh) return;
        const pa = o.geometry.attributes.position;
        for (let k = 0; k < pa.count; k++) {
          v.fromBufferAttribute(pa, k).applyMatrix4(o.matrixWorld);
          const q = local(v.x, v.z, iTete);
          liste.push([q.d, q.l, v.y]);
        }
      });
      return liste;
    };
    // 1. les lèvres juste à la gueule : le point le plus en avant au-dessus du sol, devant la route
    let S = sommets();
    let dMin = Infinity;
    for (const [d, l, y] of S) if (y > 2 && y < 14 && Math.abs(l) < 6) dMin = Math.min(dMin, d);
    tete.position.addScaledVector(new THREE.Vector3(tx[iAxe], 0, tz[iAxe]), -dMin);
    // 2. le bas de la gueule (langue, mâchoire) au niveau de la route : le plus grand vide vertical
    // sur l'axe, au milieu de la gueule ; on descend la tête pour que son bas soit à la route
    S = sommets();
    const ys = S.filter(([d, l]) => d > 3 && d < 9 && Math.abs(l) < 2).map((q) => q[2]).sort((a, b) => a - b);
    let bas = 0, vide = 0;
    for (let k = 1; k < ys.length; k++) if (ys[k] - ys[k - 1] > vide) { vide = ys[k] - ys[k - 1]; bas = ys[k - 1]; }
    tete.position.y = -bas - 0.05;
    tete.updateMatrixWorld(true);
    // 3. dégagement : rien de la tête là où roulent les karts (les dents du bas qui barraient la
    // route, les bosses de la langue et des gencives) : on roule entre les crocs
    const degage = (d, l, y) => d > -4 && d < V.dJoint + 4 && Math.abs(l) < V.demiGueule + 1.1 && y > -0.3 && y < 3.2;
    retirerTriangles(modele, degage);
    // 4. la gorge part des vraies parois de la bouche (mesurées sur le maillage), puis 5. on creuse
    // la tête là où elle passe (le fond de la bouche, l'intérieur du crâne)
    const dansPassage = construireGorge(mesurerCavite(modele));
    retirerTriangles(modele, dansPassage);
    piste.teteTrex.objet = tete;
    trex.add(tete);
  });

  /**
   * Retire de la tête les triangles dont un point (sommet, milieu d'un côté ou centre) vérifie
   * rejeter(d, l, y) (repère de la route) : un grand triangle qui barre le passage part aussi.
   */
  function retirerTriangles(modele, rejeter) {
    const v = new THREE.Vector3();
    modele.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, pa = g.attributes.position;
      // chaque sommet une fois dans le repère de la route (les milieux s'en déduisent : à
      // cette échelle la route est droite sur la taille d'un triangle)
      const D = new Float32Array(pa.count), Lt = new Float32Array(pa.count), Y = new Float32Array(pa.count);
      for (let k = 0; k < pa.count; k++) {
        v.fromBufferAttribute(pa, k).applyMatrix4(o.matrixWorld);
        const q = local(v.x, v.z, iTete);
        D[k] = q.d; Lt[k] = q.l; Y[k] = v.y;
      }
      const idx = g.index ? g.index.array : null;
      const nTri = (idx ? idx.length : pa.count) / 3, garde = [];
      const poids = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [1 / 3, 1 / 3, 1 / 3]];
      for (let t = 0; t < nTri; t++) {
        const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
        const touche = poids.some(([wa, wb, wc]) => rejeter(D[a] * wa + D[b] * wb + D[c] * wc, Lt[a] * wa + Lt[b] * wb + Lt[c] * wc, Y[a] * wa + Y[b] * wb + Y[c] * wc));
        if (!touche) garde.push(a, b, c);
      }
      g.setIndex(garde); // (géométrie non indexée : l'index saute simplement les triangles retirés)
      g.computeVertexNormals();
    });
  }

  // ======================= la gorge : de la bouche au tunnel =======================
  const Y_RAYON = 0.6; // hauteur de départ des rayons de mesure (au-dessus de la langue)
  const R_OUVERT = 13; // au-delà, le rayon est sorti par le côté de la gueule ouverte
  const EPAISSEUR = 0.25; // la gorge passe juste derrière les parois de la bouche (cachée par elles)

  /** Couleurs d'une texture (petite copie lisible) pour retrouver la couleur d'un point de la tête. */
  function lireTexture(map) {
    const img = map?.image;
    if (!img?.width) return null;
    const T = 128, toile = document.createElement("canvas");
    toile.width = toile.height = T;
    const ctx = toile.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, T, T);
    return { T, data: ctx.getImageData(0, 0, T, T).data, flipY: map.flipY };
  }

  /**
   * Coupes de la cavité de la bouche, tous les mètres de V.dGorge à V.dJoint : des rayons partent
   * de l'axe de la route (à Y_RAYON) dans le plan en travers, un par segment de la voûte du tunnel
   * (m = 0 à gauche ... M à droite) ; on garde la première paroi touchée et sa couleur (texture).
   * null : le rayon sort par le côté de la gueule ouverte.
   */
  function mesurerCavite(modele) {
    const temp = [];
    const v = new THREE.Vector3();
    modele.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, pa = g.attributes.position, uv = g.attributes.uv, idx = g.index ? g.index.array : null;
      const n = idx ? idx.length : pa.count, pos = [], uvs = [];
      const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      for (let t = 0; t < n; t += 3) {
        const ids = [0, 1, 2].map((c) => (idx ? idx[t + c] : t + c));
        ids.forEach((id, c) => P[c].fromBufferAttribute(pa, id).applyMatrix4(o.matrixWorld));
        v.copy(P[0]).add(P[1]).add(P[2]).multiplyScalar(1 / 3);
        const q = local(v.x, v.z, iTete);
        if (q.d < V.dGorge - 3 || q.d > V.dJoint + 3 || Math.abs(q.l) > 24 || v.y > 24) continue;
        for (let c = 0; c < 3; c++) {
          pos.push(P[c].x, P[c].y, P[c].z);
          uvs.push(uv ? uv.getX(ids[c]) : 0, uv ? uv.getY(ids[c]) : 0);
        }
      }
      if (!pos.length) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      m.userData.texture = lireTexture(o.material.map);
      m.updateMatrixWorld(true);
      temp.push(m);
    });
    const couleurDe = (hit) => {
      const tex = hit.object.userData.texture;
      if (!tex || !hit.uv) return null;
      const u = ((hit.uv.x % 1) + 1) % 1, w = ((hit.uv.y % 1) + 1) % 1;
      const px = Math.min(tex.T - 1, Math.floor(u * tex.T)), py = Math.min(tex.T - 1, Math.floor((tex.flipY ? 1 - w : w) * tex.T));
      const k = (py * tex.T + px) * 4;
      return new THREE.Color().setRGB(tex.data[k] / 255, tex.data[k + 1] / 255, tex.data[k + 2] / 255, THREE.SRGBColorSpace);
    };
    const rc = new THREE.Raycaster();
    rc.far = 30;
    const O = new THREE.Vector3(), Q = new THREE.Vector3();
    const coupes = [];
    for (let d = V.dGorge; d <= V.dJoint; d += 1) {
      point(d, 0, Y_RAYON, O);
      const rayons = [];
      for (let m = 0; m <= M; m++) {
        const a = (m / M) * Math.PI;
        point(d, Math.cos(a), Y_RAYON + Math.sin(a), Q);
        rc.set(O, Q.sub(O).normalize());
        const h = rc.intersectObjects(temp, false);
        rayons.push(h.length && h[0].distance < R_OUVERT ? { r: h[0].distance, rLoin: h.at(-1).distance, couleur: couleurDe(h[0]) } : null);
      }
      coupes.push({ d, rayons });
    }
    for (const m of temp) m.geometry.dispose();
    return coupes;
  }

  /**
   * Construit la gorge à partir des coupes de la bouche : elle épouse les parois réelles (juste
   * derrière elles, donc invisible là où elles existent), ferme les côtés ouverts de la gueule
   * (joues), passe un repli de chair au fond de la bouche, puis s'élargit en douceur jusqu'à la
   * paroi du tunnel (même forme et mêmes couleurs à V.dJoint). Couleurs : celles de la bouche
   * (texture) au début, fondu vers la chair du ventre. Renvoie dansPassage(d, l, y) pour creuser
   * la tête là où la gorge passe ; ajuste aussi les murs invisibles.
   */
  function construireGorge(coupes) {
    const rDegage = (a) => {
      // rayon mini pour rester hors du dégagement des karts (|l| ≥ 4,8 ou y ≥ 3,3)
      const s = Math.sin(a), c = Math.abs(Math.cos(a));
      return Math.min(s > 0.01 ? (3.3 - Y_RAYON) / s : Infinity, c > 0.01 ? (V.demiGueule + 1.2) / c : Infinity);
    };
    const BOUCHE = new THREE.Color(0x7a2a30), LEVRE = new THREE.Color(0x3e1a16);
    // 1. coupes complètes : les côtés ouverts sont bouchés par une joue (rayon interpolé entre les
    //    parois voisines) ; le fond de la bouche (rayons très courts en haut) arrête la mesure
    const anneaux = [];
    for (const { d, rayons: bruts } of coupes) {
      // un rayon qui ne touche que la peau du dehors (vue de l'intérieur de la tête) passe par un
      // creux du modèle : on le traite comme un côté ouvert (la joue le cache)
      const rayons = bruts.map((x) => (x && x.rLoin - x.r > 0.5 ? x : null));
      // le palais (rayons du haut) doit être là, et pas trop bas : sinon c'est le fond de la
      // bouche (sa paroi coupe le plan) ou l'intérieur du crâne derrière
      if (rayons.slice(5, M - 5).some((x) => !x || x.r < 4.5)) break;
      if (rayons.filter(Boolean).length < 3) break;
      // points de paroi mesurés (juste derrière la paroi) ; aux pieds sans paroi (pas de mâchoire
      // du bas au-dessus de la route), la joue tombe droit sous le bord de la mâchoire du haut
      // (vue de devant, elle reste cachée derrière les crocs)
      // devant, la gorge passe juste derrière les parois de la bouche (on voit la vraie bouche) ;
      // plus loin elle passe juste devant (le palais du modèle, très sombre, ne se voit plus) : la
      // ligne où elle traverse la paroi suit les creux et les bosses du modèle, sans bord droit
      const decal = EPAISSEUR + (-0.35 - EPAISSEUR) * doux(V.dGorge + 3, V.dGorge + 7, d);
      const mur = rayons.map((x, m) => {
        if (!x) return null;
        const a = (m / M) * Math.PI, r = Math.min(x.r + decal, Math.max(x.r + 0.05, x.rLoin - 0.4)); // jamais à travers la peau
        return [Math.cos(a) * r, Y_RAYON + Math.sin(a) * r];
      });
      const bordG = mur.find(Boolean), bordD = mur.findLast(Boolean), pied = V.demiGueule + 1.3;
      mur[0] ??= [Math.max(bordG[0], pied), Y_RAYON];
      mur[M] ??= [Math.min(bordD[0], -pied), Y_RAYON];
      const ok = mur.map((x, m) => (x ? m : -1)).filter((m) => m >= 0);
      const P = [], C = [], ouvert = [], gencive = [];
      for (let m = 0; m <= M; m++) {
        const a = (m / M) * Math.PI;
        let p = mur[m];
        if (!p) {
          // joue : en ligne droite entre les deux parois voisines (elle ne sort pas de la gueule)
          const g = ok.filter((k) => k < m).at(-1), dr = ok.find((k) => k > m), t = (m - g) / (dr - g);
          p = [mur[g][0] + (mur[dr][0] - mur[g][0]) * t, mur[g][1] + (mur[dr][1] - mur[g][1]) * t];
        }
        // jamais dans le dégagement des karts
        const r = Math.hypot(p[0], p[1] - Y_RAYON), rMin = rDegage(a);
        if (r < rMin) p = [Math.cos(a) * rMin, Y_RAYON + Math.sin(a) * rMin];
        P.push(p);
        C.push(rayons[m]?.couleur ?? BOUCHE);
        ouvert.push(!rayons[m]);
        // la gencive au-dessus d'une joue : la paroi mesurée la plus proche vers le palais
        const haut = m < M / 2 ? ok.find((k) => k > m && rayons[k]) : ok.filter((k) => k < m && rayons[k]).at(-1);
        gencive.push(haut != null ? mur[haut] : p);
      }
      anneaux.push({ d, P, C, ouvert, gencive });
    }
    const fond = anneaux.length ? anneaux.at(-1).d : V.dGorge; // dernière coupe de la bouche
    const dPli = fond + 1.5; // repli de chair qui marque l'entrée de la gorge
    if (import.meta.env.DEV) window.__gorge = { coupes, anneaux, fond };

    /** Anneau de la gorge à d : points (l, y) m = 0..M et leurs couleurs. */
    const flesh = new THREE.Color();
    function anneau(d) {
      let A;
      if (!anneaux.length) A = { P: Array.from({ length: M + 1 }, (_, m) => paroiLY(V.dTube, m)), C: Array(M + 1).fill(BOUCHE), ouvert: Array(M + 1).fill(0) };
      else {
        const u = Math.max(0, Math.min(anneaux.length - 1, d - anneaux[0].d)), k = Math.min(anneaux.length - 2, Math.floor(u)), f = u - k;
        const a0 = anneaux[Math.max(0, k)], a1 = anneaux[Math.min(anneaux.length - 1, k + 1)];
        const mel = (p, q) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
        // devant, les joues sont repliées contre la gencive : elles se déplient vers le fond, leur
        // bord dessine un coin de bouche en biais (pas de bord droit, rien devant les crocs)
        const deplie = doux(V.dGorge, V.dGorge + 5, d);
        A = {
          P: a0.P.map((p, m) => {
            const q = mel(p, a1.P[m]), g = mel(a0.gencive[m], a1.gencive[m]);
            const o = (+a0.ouvert[m] + (+a1.ouvert[m] - +a0.ouvert[m]) * f) * (1 - deplie);
            return [q[0] + (g[0] - q[0]) * o, q[1] + (g[1] - q[1]) * o];
          }),
          C: a0.C.map((c, m) => c.clone().lerp(a1.C[m], f)),
          ouvert: a0.ouvert.map((x, m) => +x + (+a1.ouvert[m] - +x) * f),
        };
      }
      const t = doux(fond, V.dJoint, d); // vers la forme du tunnel
      const tc = doux(V.dGorge + 4, fond + 2, d); // des couleurs de la bouche vers celles de la chair
      const sombre = doux(V.dJoint - 4, V.dJoint, d); // le pli sombre où commence le tunnel
      const pli = 1 - 0.09 * Math.exp(-(((d - dPli) / 0.9) ** 2));
      const P = [], C = [];
      for (let m = 0; m <= M; m++) {
        const T = paroiLY(d, m);
        let l = A.P[m][0] + (T[0] - A.P[m][0]) * t, y = A.P[m][1] + (T[1] - A.P[m][1]) * t;
        // replis de chair (fixes) sur les joues et la gorge, effacés au raccord avec le tunnel
        const bosse = 1 + (0.035 * Math.sin(d * 1.3 + m * 2.1) + 0.02 * Math.sin(d * 3.1 - m * 1.3)) * (1 - t) * Math.min(1, A.ouvert[m] + t * 4 + 0.3);
        l *= pli * bosse;
        y = Y_RAYON + (y - Y_RAYON) * pli * bosse;
        // jamais dans le dégagement des karts
        const a = Math.atan2(y - Y_RAYON, l), r = Math.hypot(l, y - Y_RAYON), rMin = rDegage(a);
        if (r < rMin && a > 0) [l, y] = [Math.cos(a) * rMin, Y_RAYON + Math.sin(a) * rMin];
        P.push([l, y]);
        flesh.copy(m >= 7 && m <= 8 ? CHAIR[3] : CHAIR[0]).lerp(CHAIR[1], 0.5 * (m % 2));
        const c = A.C[m].clone().lerp(flesh, tc).lerp(CHAIR[2], sombre);
        // le bord des joues (au ras des crocs) plus sombre, comme une lèvre
        c.lerp(LEVRE, A.ouvert[m] * (1 - doux(V.dGorge, V.dGorge + 4, d)));
        if (pli < 0.99) c.multiplyScalar(1 - (1 - pli) * 4); // le repli est plus sombre
        c.multiplyScalar(1 + 0.12 * Math.sin(d * 2.3 + m * 1.9) * (1 - sombre)); // chair marbrée
        C.push(c);
      }
      return { P, C };
    }

    // 2. le maillage : anneaux tous les 0,5 m, avec un pied qui descend sous la route
    const pos = [], col = [], dPas = 0.5;
    const nA = Math.round((V.dJoint - V.dGorge) / dPas);
    const pts = [];
    for (let k = 0; k <= nA; k++) {
      const d = V.dGorge + k * dPas, { P, C } = anneau(d);
      // (le pied suit la joue quand elle est encore repliée)
      const ligne = [[P[0][0], P[0][1] - 0.9], ...P, [P[M][0], P[M][1] - 0.9]].map(([l, y]) => point(d, l, y));
      pts.push({ d, ligne, couleurs: [C[0], ...C, C[M]] });
    }
    for (let k = 0; k < nA; k++) {
      const a = pts[k], b = pts[k + 1];
      for (let j = 0; j < M + 2; j++) {
        const sommets = [[a, j], [b, j], [a, j + 1], [b, j], [b, j + 1], [a, j + 1]];
        for (const [s, jj] of sommets) {
          const p = s.ligne[jj], c = s.couleurs[jj];
          pos.push(p.x, p.y, p.z);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const gorge = new THREE.Mesh(g, matChair);
    gorge.name = "gorge";
    trex.add(gorge);

    // 3. murs invisibles : jamais plus large que la gorge au ras de la route
    for (let k = Math.ceil(V.dGorge / pas); k * pas <= V.dJoint; k++) {
      const { P } = anneau(k * pas);
      let gauche = Infinity, droite = Infinity;
      for (const [l, y] of P) if (y < 1.8) l > 0 ? (gauche = Math.min(gauche, l)) : (droite = Math.min(droite, -l));
      piste.limiter(gueule + k, Math.max(V.demiGueule, Math.min(gauche, droite) - 1.3));
    }

    // 4. où creuser la tête : là où la gorge passe devant les parois de la bouche (les bosses du
    //    modèle qui dépasseraient en taches sombres), le fond de la bouche, puis le tunnel
    const PAS_C = 0.25, cache = [], dCreuse = V.dGorge + 7;
    for (let d = dCreuse; d <= V.dJoint + PAS_C; d += PAS_C) cache.push(anneau(d).P);
    const dedansPoly = (P, l, y) => {
      // polygone : l'anneau fermé par le sol
      const poly = [...P, [P[M][0], -0.3], [P[0][0], -0.3]];
      let dedans = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if (yi > y !== yj > y && l < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
      }
      return dedans;
    };
    return (d, l, y) => {
      if (y < -0.3 || d < dCreuse) return false;
      if (d <= V.dJoint) {
        if (Math.abs(l) > 13 || y > 14) return false;
        return dedansPoly(cache[Math.min(cache.length - 1, Math.round((d - dCreuse) / PAS_C))], l, y);
      }
      const { W, H } = paroi(d);
      return (l / W) ** 2 + (y / H) ** 2 < 1.0;
    };
  }

  // ======================= ambiance et rugissement =======================
  let scene = null, camera = null, ciel = null, soleil = null, dehors = null;
  accroche.onBeforeRender = (r, sc, cam) => {
    if (scene === sc) return;
    scene = sc;
    camera = cam;
    sc.traverse((o) => {
      if (o.isHemisphereLight && !ciel) ciel = o;
      if (o.isDirectionalLight && !soleil) soleil = o;
    });
  };
  const cA = new THREE.Color(), cB = new THREE.Color(), fondVentre = new THREE.Color(AMBIANCE_VENTRE.fond);
  // le dôme du ciel (premier enfant du décor, voir construireDecor) : caché dans le ventre
  const dome = groupe.children.find((o) => o.isMesh && o.material?.side === THREE.BackSide && o.geometry?.parameters?.radius >= 500);
  function ambiance(f) {
    if (!scene?.fog || !ciel || !soleil) return;
    if (f <= 0) {
      if (dehors) {
        scene.fog.color.setHex(dehors.brouillard[0]);
        [scene.fog.near, scene.fog.far] = [dehors.brouillard[1], dehors.brouillard[2]];
        ciel.color.setHex(dehors.ciel[0]);
        ciel.groundColor.setHex(dehors.ciel[1]);
        ciel.intensity = dehors.ciel[2];
        soleil.intensity = dehors.soleil;
        scene.background = dehors.fond;
        if (dome) dome.visible = dehors.dome;
        dehors = null;
      }
      return;
    }
    dehors ??= {
      brouillard: [scene.fog.color.getHex(), scene.fog.near, scene.fog.far],
      ciel: [ciel.color.getHex(), ciel.groundColor.getHex(), ciel.intensity],
      soleil: soleil.intensity,
      fond: scene.background,
      dome: dome?.visible ?? true,
    };
    scene.background = f > 0.9 ? fondVentre : dehors.fond;
    if (dome) dome.visible = f > 0.9 ? false : dehors.dome;
    const A = AMBIANCE_VENTRE, D = dehors, mel = (x, y) => x + (y - x) * f;
    scene.fog.color.copy(cA.setHex(D.brouillard[0]).lerp(cB.setHex(A.brouillard[0]), f));
    scene.fog.near = mel(D.brouillard[1], A.brouillard[1]);
    scene.fog.far = mel(D.brouillard[2], A.brouillard[2]);
    ciel.color.copy(cA.setHex(D.ciel[0]).lerp(cB.setHex(A.ciel[0]), f));
    ciel.groundColor.copy(cA.setHex(D.ciel[1]).lerp(cB.setHex(A.ciel[1]), f));
    ciel.intensity = mel(D.ciel[2], A.ciel[2]);
    soleil.intensity = mel(D.soleil, A.soleil);
  }

  let t = 0, indiceCam = gueule, arme = true;
  const o = new THREE.Object3D();
  function update(dt) {
    t += dt;
    // bulles qui palpitent
    for (let n = 0; n < NB_BULLES; n++) {
      const b = infoBulles[n];
      o.position.copy(b.p);
      o.scale.setScalar(b.s * (1 + 0.18 * Math.sin(t * 2.2 + b.ph)));
      o.updateMatrix();
      bulles.setMatrixAt(n, o.matrix);
    }
    bulles.instanceMatrix.needsUpdate = true;

    // la caméra est-elle dans le ventre ? l'ambiance suit en douceur (entrée et sortie)
    let f = 0;
    if (camera) {
      const p = camera.position, q = local(p.x, p.z, indiceCam);
      indiceCam = q.indice;
      if (q.d > -5 && q.d < D_FIN + 5) {
        const { W, H } = paroi(Math.max(V.dTube, q.d));
        if (Math.abs(q.l) < W + 1 && p.y < H + 1) f = doux(V.dTube - 6, V.dTube + 12, q.d) * doux(0, 32, D_FIN - q.d);
      }
    }
    ambiance(f);

    // le T-rex rugit quand le joueur arrive devant sa gueule (une fois par passage)
    for (const k of piste.humains ?? []) {
      const ph = k.phys;
      if (!ph || ph.indice < 0) continue;
      let e = (gueule - ph.indice + N) % N;
      if (e > N / 2) e -= N;
      const dAvant = e * pas;
      if (arme && dAvant < 30 && dAvant > 0) {
        arme = false;
        audio.croc?.();
      } else if (dAvant > 60 || dAvant < -D_FIN) arme = true;
    }
  }

  if (import.meta.env.DEV) window.__trex = { point, local, paroi, D_FIN, gueule, sortie, update };
  return { update };
}
