import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { planter } from "./vegetation.js";
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
  dTube: 11, // m après les lèvres : début du tunnel de chair (fond de la gueule)
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
  const ROCHERS = ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"];
  const rochers = ROCHERS.map(() => []);
  for (let k = 0; k <= nEntonnoir - 2; k += 2) {
    const j = (gueule - nEntonnoir + k + N) % N;
    const lim = piste.limiteLaterale(j) + 1.6;
    if (lim > piste.demi + piste.marge) continue;
    for (const s of [1, -1]) {
      rochers[(k / 2 + (s > 0 ? 0 : 1)) % 3].push({ x: cx[j] + nx[j] * s * lim, z: cz[j] + nz[j] * s * lim, s: 0.9 + ((k * 7) % 5) * 0.08, y: -0.2, r: k * 1.7 + s });
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
  const M = 16; // segments de la voûte
  const dDebutTube = V.dTube - 1.5;
  let accroche = null; // le maillage du tunnel : il retrouve la scène et la caméra au rendu
  const nTube = Math.ceil((D_FIN - dDebutTube) / pas);
  const ptParoi = (d, m, v) => {
    const { W, H } = paroi(d), a = (m / M) * Math.PI;
    // petites bosses de chair (fixes) pour que ça ne fasse pas un tuyau lisse
    const b = 1 + 0.035 * Math.sin(d * 0.9 + m * 1.7) + 0.025 * Math.sin(d * 2.3 - m * 3.1);
    return point(d, Math.cos(a) * W * b, Math.sin(a) * H * b, v);
  };
  {
    const pos = [], col = [];
    const c1 = new THREE.Color(0x9c2238), c2 = new THREE.Color(0xc23a58), c3 = new THREE.Color(0x6a1428), c4 = new THREE.Color(0xe0708a);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
    for (let k = 0; k < nTube; k++) {
      const d0 = dDebutTube + k * pas, d1 = Math.min(D_FIN, d0 + pas);
      for (let m = 0; m < M; m++) {
        // bandes de chair, plis sombres réguliers, et un ruban plus clair en haut
        const c = k % 12 < 2 ? c3 : m >= 7 && m <= 8 ? c4 : (m + (k >> 2)) % 2 ? c1 : c2;
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
    const tube = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true, emissive: 0x2a0610 }));
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
      const d = V.dTube + 4 + rnd() * (D_FIN - V.dTube - 8), m = 2 + rnd() * (M - 4);
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
    // 3. la gorge : on creuse dans la tête le passage du tunnel (triangles dans la voûte)
    tete.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const dedans = (x, y, z) => {
      if (y < -0.3) return false;
      const q = local(x, z, iTete);
      // les dents du bas qui barrent la route (la langue sert de route) : on roule entre les crocs
      if (q.d > -4 && q.d < V.dTube && Math.abs(q.l) < V.demiGueule + 1.1 && y < 3.2) return true;
      if (q.d < V.dTube - 1) return false;
      const { W, H } = paroi(q.d);
      return (q.l / W) ** 2 + (y / H) ** 2 < 1.0;
    };
    modele.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, pa = g.attributes.position, idx = g.index ? g.index.array : null;
      const nTri = (idx ? idx.length : pa.count) / 3, garde = [];
      const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      for (let t = 0; t < nTri; t++) {
        const ids = [0, 1, 2].map((c) => (idx ? idx[t * 3 + c] : t * 3 + c));
        ids.forEach((id, c) => P[c].fromBufferAttribute(pa, id).applyMatrix4(o.matrixWorld));
        // sommets, milieux des côtés et centre : un grand triangle qui barre la gorge est aussi enlevé
        const essais = [P[0], P[1], P[2], v.addVectors(P[0], P[1]).multiplyScalar(0.5).clone(), v.addVectors(P[1], P[2]).multiplyScalar(0.5).clone(), v.addVectors(P[0], P[2]).multiplyScalar(0.5).clone(), v.addVectors(P[0], P[1]).add(P[2]).multiplyScalar(1 / 3).clone()];
        if (!essais.some((p) => dedans(p.x, p.y, p.z))) garde.push(...ids);
      }
      if (idx) g.setIndex(garde);
      else {
        const nouv = new Float32Array(garde.length * 3);
        garde.forEach((id, k) => nouv.set([pa.getX(id), pa.getY(id), pa.getZ(id)], k * 3));
        g.setAttribute("position", new THREE.BufferAttribute(nouv, 3));
      }
      g.computeVertexNormals();
    });
    piste.teteTrex.objet = tete;
    trex.add(tete);
  });

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
