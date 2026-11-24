import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { planter } from "./vegetation.js";
import { audio } from "./audio.js";
import { percerSol } from "./decor.js";

// Aquarium géant du circuit Dinosaures, enterré : la route descend dans une tranchée (murs de
// soutènement en pierre), passe dans un tunnel de verre au fond d'un énorme bassin (sable,
// algues, rochers, bulles, bancs de poissons) où nage un mosasaure, puis remonte au niveau du
// sol. De la jungle, on voit un grand bassin vitré qui dépasse un peu du sol.
//
// Le tunnel suit le virage de la route : chaque pièce est construite dans le repère de la
// piste (s = échantillon, l = latéral, y = hauteur au-dessus de la route du fond), voir
// point() ; le groupe de l'aquarium est descendu de AQUARIUM.profondeur.
//
// Accroches :
//  - piste.abaisser() : la route (et sa physique) descend dans la tranchée, voir piste.js.
//  - percerSol() (decor.js) : trou dans le grand sol au-dessus de la tranchée et du bassin.
//  - piste.zonesDecor : { nom, debut, fin, demi } = emprise au sol (échantillons debut..fin,
//    demi-largeur latérale en mètres). La forêt n'y plante rien.
//  - l'objet renvoyé a update(dt) (appelé avec les mixers du décor, temps du jeu) ;
//    la caméra et la scène sont retrouvées au premier rendu (onBeforeRender).
//  - dans le tunnel, l'ambiance (brouillard, lumières) devient bleue, sans toucher course.js.

export const AQUARIUM = {
  debut: 0.729, // fraction du tour (virages du bas, après la tête de T-rex)
  fin: 0.787, // ~75 m de tunnel
  demiTunnel: 16.5, // demi-largeur du tunnel (les barrières sont à 14,8 m)
  hautTunnel: 8, // hauteur du sommet de la voûte
  demi: 28, // demi-largeur du bassin
  haut: 16, // hauteur des vitres (depuis la route du fond) ; l'eau s'arrête un peu en dessous
  profondeur: 10, // la route du fond est 10 m sous le sol : le bassin dépasse de 6 m
  rampeAvant: 86, // longueur de la descente (m) : pente max ~15 %
  rampeApres: 100, // longueur de la remontée (m) : pente max ~13 %
  murTranchee: 18, // latéral du pied des murs de la tranchée (les barrières sont à 14,8 m)
  fruitMur: 0.22, // le mur penche vers l'extérieur de 22 cm par mètre de hauteur
};

/** Montée douce de 0 à 1 (pente en trapèze : elle augmente sur q, reste constante, diminue). */
function rampe(u, q = 0.25) {
  u = Math.min(1, Math.max(0, u));
  const g = u < q ? (u * u) / (2 * q) : u <= 1 - q ? u - q / 2 : 1 - q - ((1 - u) * (1 - u)) / (2 * q);
  return g / (1 - q);
}

/** Ambiance sous l'eau (mêmes clés que AMBIANCE_INTERIEUR de interieur.js). */
const AMBIANCE_EAU = {
  brouillard: [0x1d7fae, 5, 80],
  ciel: [0xa6ecff, 0x1a5a7a, 2.0],
  soleil: 0.7,
};

const COULEURS_POISSONS = [0xffd43b, 0xff922b, 0x9ad8f0];

export function installerAquarium(groupe, piste) {
  const { N, pas, cx, cz, nx, nz } = piste;
  const A = AQUARIUM;
  const i0 = Math.round(N * A.debut), i1 = Math.round(N * A.fin);
  const W = A.demi, H = A.haut, a = A.demiTunnel, h = A.hautTunnel, D = A.profondeur;
  const EAU = H - 0.6; // surface de l'eau
  const rnd = aleatoire(7);

  // --- profil de la route : descente, fond plat sous le bassin, remontée ---
  const sA = i0 - 3 - Math.round(A.rampeAvant / pas); // début de la descente
  const sB = i1 + 3 + Math.round(A.rampeApres / pas); // fin de la remontée
  const nA = i0 - 3 - sA, nB = sB - (i1 + 3);
  piste.abaisser(sA, sB, (m) => {
    const s = sA + m;
    if (s < i0 - 3) return -D * rampe(m / nA);
    if (s > i1 + 3) return -D * rampe((sB - s) / nB);
    return -D;
  });
  const prof = (s) => {
    const i = Math.floor(s), f = s - i, p = piste.profil;
    return p[i] + (p[i + 1] - p[i]) * f;
  };
  /** Latéral du mur de la tranchée à la hauteur y (monde) quand la route est à yr. */
  const latMur = (y, yr) => A.murTranchee + A.fruitMur * (y - yr);
  const latHaut = (s) => latMur(0, prof(s)); // haut du mur, au niveau du sol

  (piste.zonesDecor ??= []).push(
    { nom: "aquarium", debut: i0 - 2, fin: i1 + 2, demi: W + 2 },
    { nom: "tranchee", debut: sA - 3, fin: sB + 3, demi: latMur(0, -D) + 2.5 },
  );

  const aq = new THREE.Group();
  aq.name = "aquarium";
  aq.position.y = -D; // tout le bassin est construit depuis la route du fond (y = 0)
  groupe.add(aq);
  const tranchee = new THREE.Group();
  tranchee.name = "tranchee aquarium";
  groupe.add(tranchee);

  // --- repère de la piste ---
  /** Point du monde à l'échantillon s (fractionnaire), latéral l, hauteur y. */
  function point(s, l, y, v = new THREE.Vector3()) {
    const i = Math.min(N - 2, Math.max(0, Math.floor(s))), f = s - i;
    const px = cx[i] + (cx[i + 1] - cx[i]) * f, pz = cz[i] + (cz[i + 1] - cz[i]) * f;
    let ex = nx[i] + (nx[i + 1] - nx[i]) * f, ez = nz[i] + (nz[i + 1] - nz[i]) * f;
    const n = Math.hypot(ex, ez);
    ex /= n; ez /= n;
    return v.set(px + ex * l, y, pz + ez * l);
  }
  /** Repère (latéral, haut, avant) à l'échantillon i : pour poser une pièce dessinée en (l, y, 0). */
  function repere(s) {
    const i = Math.round(s);
    const n = new THREE.Vector3(nx[i], 0, nz[i]), t = new THREE.Vector3(piste.tx[i], 0, piste.tz[i]);
    return new THREE.Matrix4().makeBasis(n, new THREE.Vector3(0, 1, 0), t).setPosition(point(s, 0, 0));
  }
  /** Coordonnées piste d'un point du monde (indice proche pour aller vite). */
  function local(p, indice) {
    const r = piste.localiser(p.x, p.z, indice);
    return { s: r.indice + r.long / pas, l: r.lateral, indice: r.indice };
  }
  /** Hauteur de la voûte du tunnel au latéral l (0 en dehors). */
  const voute = (l) => (Math.abs(l) < a ? h * Math.sqrt(1 - (l / a) ** 2) : 0);

  /**
   * Grille le long du tunnel (ou de debut à fin) : fn(s, b, v) place le sommet (b de 0 à 1 en
   * travers). UV : vue du dessus, ou (longueur, hauteur) pour un mur (mur = true).
   */
  function grille(nb, fn, uvEchelle = 8, { debut = i0, fin = i1, pasS = 2, mur = false } = {}) {
    const ns = Math.ceil((fin - debut) / pasS);
    const pos = [], uv = [], idx = [], v = new THREE.Vector3();
    for (let k = 0; k <= ns; k++) {
      const s = debut + ((fin - debut) * k) / ns;
      for (let j = 0; j <= nb; j++) {
        fn(s, j / nb, v);
        pos.push(v.x, v.y, v.z);
        if (mur) uv.push((s * pas) / uvEchelle, v.y / uvEchelle);
        else uv.push(v.x / uvEchelle, v.z / uvEchelle);
      }
    }
    for (let k = 0; k < ns; k++)
      for (let j = 0; j < nb; j++) {
        const p = k * (nb + 1) + j, q = p + nb + 1;
        idx.push(p, q, p + 1, p + 1, q, q + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const caustique = textureCaustique();
  const caustique2 = caustique.clone();
  caustique2.repeat.set(0.7, 0.7);
  const metal = new THREE.MeshLambertMaterial({ color: 0x2f4650 });
  const beton = new THREE.MeshLambertMaterial({ color: 0x9aa3a6, side: THREE.DoubleSide });

  // --- tunnel de verre ---
  const tunnel = new THREE.Mesh(grille(14, (s, b, v) => point(s, a * Math.cos(Math.PI * b), h * Math.sin(Math.PI * b), v)), verre(0x9fe3ff, 0.12, 0.6));
  tunnel.renderOrder = 4;
  aq.add(tunnel);
  // arceaux tous les ~5 m et bordures en béton au pied de la voûte
  const arceau = (rayon) => {
    const pts = [];
    for (let k = 0; k <= 18; k++) pts.push(new THREE.Vector3(a * Math.cos((Math.PI * k) / 18), h * Math.sin((Math.PI * k) / 18), 0));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, rayon, 4, false);
  };
  const arceaux = [];
  const nbArceaux = Math.round(((i1 - i0) * pas) / 5.5);
  for (let k = 1; k < nbArceaux; k++) arceaux.push(arceau(0.16).applyMatrix4(repere(i0 + ((i1 - i0) * k) / nbArceaux)));
  aq.add(new THREE.Mesh(mergeGeometries(arceaux), metal));
  for (const c of [-1, 1]) aq.add(new THREE.Mesh(grille(1, (s, b, v) => point(s, c * (a + 0.25), b * 0.7, v)), beton));

  // --- bassin : murs enterrés (sous le sol), vitres au-dessus, poteaux, rebord ---
  // (D = niveau du sol dans le repère du bassin)
  const murBassin = new THREE.MeshLambertMaterial({ color: 0x6f8f99, emissive: 0x3fa0c0, emissiveMap: caustique, emissiveIntensity: 0.35, side: THREE.DoubleSide });
  const margelles = [];
  for (const c of [-1, 1]) {
    const vitre = new THREE.Mesh(grille(1, (s, b, v) => point(s, c * W, D + b * (H - D), v)), verre(0x177fbd, 0.58, 0.9));
    vitre.renderOrder = 2;
    aq.add(vitre);
    aq.add(new THREE.Mesh(grille(2, (s, b, v) => point(s, c * W, b * D, v)), murBassin));
    aq.add(new THREE.Mesh(grille(1, (s, b, v) => point(s, c * (W + 0.05), H - 0.7 + b * 0.9, v)), new THREE.MeshLambertMaterial({ color: 0x2f4650, side: THREE.DoubleSide })));
    // margelle au ras du sol, le long des vitres (cache le bord du trou dans le sol)
    margelles.push(grille(1, (s, b, v) => point(s, c * (W - 0.2 + b * 1.6), D + 0.06, v)));
  }
  const poteaux = [];
  const nbPoteaux = Math.round(((i1 - i0) * pas) / 9);
  for (let k = 0; k <= nbPoteaux; k++)
    for (const c of [-1, 1]) poteaux.push(new THREE.BoxGeometry(0.7, H - D, 0.7).translate(c * W, (H + D) / 2, 0).applyMatrix4(repere(i0 + ((i1 - i0) * k) / nbPoteaux)));

  // --- les deux bouts : façade en béton percée par le tunnel (sous le sol), vitre au-dessus ---
  const facade = new THREE.Shape();
  facade.moveTo(-W, 0);
  facade.lineTo(-a - 0.3, 0);
  for (let k = 0; k <= 20; k++) facade.lineTo(-(a + 0.3) * Math.cos((Math.PI * k) / 20), (h + 0.3) * Math.sin((Math.PI * k) / 20));
  facade.lineTo(W, 0);
  facade.lineTo(W, D);
  facade.lineTo(-W, D);
  const bouts = [], facades = [], portiques = [];
  for (const s of [i0, i1]) {
    const m = repere(s);
    bouts.push(new THREE.PlaneGeometry(2 * W, H - D).translate(0, (H + D) / 2, 0).applyMatrix4(m));
    const f = new THREE.ShapeGeometry(facade);
    // UV en mètres (texture de pierre de la tranchée)
    const p = f.attributes.position, uvf = f.attributes.uv;
    for (let k = 0; k < p.count; k++) uvf.setXY(k, p.getX(k) / 4, p.getY(k) / 4);
    facades.push(f.applyMatrix4(m));
    // portique : arche épaisse autour de l'entrée du tunnel
    const pts = [];
    for (let k = 0; k <= 20; k++) pts.push(new THREE.Vector3((a + 0.5) * Math.cos((Math.PI * k) / 20), (h + 0.5) * Math.sin((Math.PI * k) / 20), 0));
    portiques.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.6, 6, false).applyMatrix4(m));
    poteaux.push(new THREE.BoxGeometry(2 * W + 0.7, 0.9, 0.7).translate(0, H - 0.25, 0).applyMatrix4(m));
    // corniche au-dessus de l'entrée, au niveau du sol
    margelles.push(new THREE.BoxGeometry(2 * W + 1.4, 0.6, 1.4).translate(0, D + 0.25, 0).applyMatrix4(m));
  }
  aq.add(new THREE.Mesh(mergeGeometries(poteaux), metal));
  aq.add(new THREE.Mesh(mergeGeometries(portiques), new THREE.MeshLambertMaterial({ color: 0xffb627 })));
  const finVitres = new THREE.Mesh(mergeGeometries(bouts), verre(0x177fbd, 0.6, 0.9));
  finVitres.renderOrder = 6;
  aq.add(finVitres);
  const texPierre = texturePierre();
  const pierre = new THREE.MeshLambertMaterial({ map: texPierre, side: THREE.DoubleSide });
  aq.add(new THREE.Mesh(mergeGeometries(facades), pierre));
  const matMargelle = new THREE.MeshLambertMaterial({ color: 0xb9b2a3 });
  aq.add(new THREE.Mesh(mergeGeometries(margelles.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { g.deleteAttribute("uv"); g.computeVertexNormals(); return g; })), matMargelle));

  // --- la tranchée : murs de soutènement en pierre, corniche, fond de gravier ---
  // (dans le repère du monde : la route y descend selon piste.profil)
  const yr = (s) => prof(s);
  const portionsMur = [[sA, i0], [i1, sB]];
  const piecesMur = [], piecesCorniche = [];
  for (const [d, f] of portionsMur)
    for (const c of [-1, 1]) {
      const opts = { debut: d, fin: f, pasS: 1, mur: true };
      // mur : du pied (sous la route) au niveau du sol, un peu penché vers l'extérieur
      piecesMur.push(grille(3, (s, b, v) => {
        const y0 = yr(s) - 0.3, y = y0 + b * (0.0 - y0);
        return point(s, c * latMur(y, yr(s)), y, v);
      }, 4, opts));
      // corniche : petit muret au bord, au-dessus du sol
      piecesCorniche.push(grille(3, (s, b, v) => {
        const L = latHaut(s), prof4 = [[L - 0.25, -0.05], [L - 0.25, 0.55], [L + 0.9, 0.55], [L + 0.9, -0.05]];
        const [l, y] = prof4[Math.round(b * 3)];
        return point(s, c * l, y, v);
      }, 4, opts));
    }
  // fond de la tranchée de part et d'autre de la route (et sous le tunnel)
  tranchee.add(new THREE.Mesh(mergeGeometries(piecesMur), pierre));
  tranchee.add(new THREE.Mesh(mergeGeometries(piecesCorniche.map((g) => { g.deleteAttribute("uv"); return g; })), matMargelle));
  const fond = grille(4, (s, b, v) => point(s, (b - 0.5) * 2 * (A.murTranchee + 0.3), yr(s) - 0.015, v), 6, { debut: sA, fin: sB, pasS: 1 });
  tranchee.add(new THREE.Mesh(fond, new THREE.MeshLambertMaterial({ color: 0x8b8170, map: textureGravier() })));

  // --- trou dans le grand sol : tranchée + bassin ---
  {
    const contour = [], v = new THREE.Vector3();
    const bord = (s) => (s >= i0 && s <= i1 ? W + 0.3 : latHaut(s) + 0.35);
    for (let s = sA + 1; s <= sB - 1; s++) {
      if (s === i0 || s === i1) {
        // marche nette contre la façade du bassin
        const avant = s === i0 ? latHaut(s) + 0.35 : W + 0.3, apres = s === i0 ? W + 0.3 : latHaut(s) + 0.35;
        contour.push(point(s, avant, 0, v).clone(), point(s, apres, 0, v).clone());
      } else contour.push(point(s, bord(s), 0, v).clone());
    }
    for (let s = sB - 1; s >= sA + 1; s--) {
      if (s === i0 || s === i1) {
        const avant = s === i1 ? latHaut(s) + 0.35 : W + 0.3, apres = s === i1 ? W + 0.3 : latHaut(s) + 0.35;
        contour.push(point(s, -avant, 0, v).clone(), point(s, -apres, 0, v).clone());
      } else contour.push(point(s, -bord(s), 0, v).clone());
    }
    percerSol(groupe, contour);
  }

  // --- fond de sable (reflets d'eau qui bougent) et surface de l'eau ---
  const sable = new THREE.MeshLambertMaterial({ color: 0xd8c690, emissive: 0x8fe3ff, emissiveMap: caustique, emissiveIntensity: 0.7, side: THREE.DoubleSide });
  for (const c of [-1, 1]) {
    const fond = new THREE.Mesh(grille(2, (s, b, v) => point(s, c * (a + 0.4 + b * (W - a - 0.4)), 0.07, v)), sable);
    aq.add(fond);
  }
  const surface = new THREE.Mesh(
    grille(4, (s, b, v) => point(s, -W + 2 * W * b, EAU, v)),
    new THREE.MeshLambertMaterial({ color: 0x6fd6f5, emissive: 0x9eeaff, emissiveMap: caustique2, emissiveIntensity: 1.0, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }),
  );
  surface.renderOrder = 5;
  aq.add(surface);
  // reflets d'eau sur la route dans le tunnel (les bonbons restent dessus)
  const reflets = new THREE.Mesh(
    grille(2, (s, b, v) => point(s, -a + 2 * a * b, 0.06, v), 18),
    new THREE.MeshBasicMaterial({ color: 0x55c8ff, map: caustique2, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  reflets.renderOrder = 1;
  aq.add(reflets);

  // --- rayons de lumière depuis la surface ---
  const rayons = [];
  for (let k = 0; k < 9; k++) {
    const s = i0 + 4 + rnd() * (i1 - i0 - 8);
    const dessus = k % 3 === 0; // certains tombent sur la voûte
    const l = dessus ? (rnd() - 0.5) * a : (rnd() < 0.5 ? -1 : 1) * (a + 3 + rnd() * (W - a - 6));
    const y0 = voute(l) + 0.3, haut = EAU - y0, larg = 2.5 + rnd() * 3;
    const m = repere(s);
    for (const r of [0, Math.PI / 2])
      rayons.push(new THREE.PlaneGeometry(larg, haut).translate(0, haut / 2, 0).rotateY(r + rnd()).rotateZ((rnd() - 0.5) * 0.35).translate(l, y0, 0).applyMatrix4(m));
  }
  const matRayons = new THREE.MeshBasicMaterial({ color: 0xc6f5ff, map: textureRayon(), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const rayonsMesh = new THREE.Mesh(mergeGeometries(rayons), matRayons);
  rayonsMesh.renderOrder = 3;
  aq.add(rayonsMesh);

  // --- algues (ondulent dans le courant) ---
  const temps = { value: 0 };
  const algue = mergeGeometries([new THREE.PlaneGeometry(0.8, 1, 1, 5).translate(0, 0.5, 0), new THREE.PlaneGeometry(0.8, 1, 1, 5).translate(0, 0.5, 0).rotateY(Math.PI / 2)]);
  algue.deleteAttribute("uv");
  const matAlgue = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  matAlgue.onBeforeCompile = (sh) => {
    sh.uniforms.temps = temps;
    sh.vertexShader = "uniform float temps;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      float phA = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
      float hA = position.y * position.y;
      transformed.x += sin(temps * 1.3 + phA + position.y * 2.5) * 0.45 * hA;
      transformed.z += cos(temps * 1.1 + phA) * 0.3 * hA;`);
  };
  const algues = [];
  const verts = [0x2b8a3e, 0x5c940d, 0x2f9e44, 0x66a80f, 0x087f5b];
  while (algues.length < 48) {
    const s = i0 + 2 + rnd() * (i1 - i0 - 4), c = rnd() < 0.5 ? -1 : 1, l = c * (a + 1.5 + rnd() * (W - a - 3));
    const p = point(s, l, 0);
    algues.push({ x: p.x, z: p.z, s: 0.8 + rnd() * 0.8, sy: 3 + rnd() * 8, r: rnd() * 6, couleur: verts[Math.floor(rnd() * verts.length)] });
  }
  aq.add(instances(algue, matAlgue, algues));
  // rochers : vrais rochers scannés de la forêt (sans la garde : on est dans le bassin)
  const rochers = (nom, n, e) => {
    const liste = [];
    for (let k = 0; k < n; k++) {
      const s = i0 + 3 + rnd() * (i1 - i0 - 6), c = rnd() < 0.5 ? -1 : 1, l = c * (a + 3 + rnd() * (W - a - 6));
      const p = point(s, l, 0);
      liste.push({ x: p.x, y: -0.1, z: p.z, s: e * (0.7 + rnd() * 0.6), r: rnd() * 6.3 });
    }
    planter(aq, nom, liste);
  };
  rochers("Gros_Rocher", 2, 1.1);
  rochers("Rocher_07", 3, 1.4);
  rochers("Rocher_Mousse_B", 3, 1.5);

  // --- bulles : colonnes qui montent du fond et du pied de la voûte ---
  const NB_COL = 14, PAR_COL = 9;
  const colonnes = [];
  for (let k = 0; k < NB_COL; k++) {
    const s = i0 + 3 + rnd() * (i1 - i0 - 6), c = k % 2 ? -1 : 1;
    const l = k < 6 ? c * (a + 0.8) : c * (a + 3 + rnd() * (W - a - 6));
    colonnes.push({ s, l, v: 1.4 + rnd() * 0.8, ph: rnd() * 10 });
  }
  const geoBulles = new THREE.BufferGeometry();
  geoBulles.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(NB_COL * PAR_COL * 3), 3));
  const bulles = new THREE.Points(geoBulles, new THREE.PointsMaterial({ map: textureBulle(), size: 0.55, transparent: true, depthWrite: false, color: 0xe8fbff }));
  bulles.frustumCulled = false;
  bulles.renderOrder = 3;
  aq.add(bulles);

  // --- bancs de poissons ---
  const poisson = fusionCouleurs([
    { geo: new THREE.SphereGeometry(0.5, 6, 3).scale(0.32, 0.62, 1.1), couleur: 0xffffff },
    { geo: queue(), couleur: 0xffffff },
  ]);
  const bancs = COULEURS_POISSONS.map((couleur, b) => {
    const n = 22;
    const im = new THREE.InstancedMesh(poisson, new THREE.MeshLambertMaterial({ color: couleur, side: THREE.DoubleSide }), n);
    im.frustumCulled = false;
    aq.add(im);
    const membres = [];
    for (let k = 0; k < n; k++) membres.push({ x: (rnd() - 0.5) * 7, y: (rnd() - 0.5) * 3, z: (rnd() - 0.5) * 6, e: 0.7 + rnd() * 0.5, ph: rnd() * 6 });
    return { im, membres, ph: b * 2.1, cote: b === 2 ? 0 : b === 0 ? 1 : -1, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1) };
  });

  // --- le mosasaure ---
  const moso = creerMosasaure();
  aq.add(moso.objet);
  const marge = 6 / pas; // ne pas s'approcher des vitres du bout à moins de 6 m

  // --- caméra, scène et ambiance ---
  let scene = null, camera = null, ciel = null, soleil = null, dehors = null;
  tunnel.onBeforeRender = (r, sc, cam) => {
    if (scene === sc) return;
    scene = sc;
    camera = cam;
    sc.traverse((o) => {
      if (o.isHemisphereLight && !ciel) ciel = o;
      if (o.isDirectionalLight && !soleil) soleil = o;
    });
  };
  tunnel.frustumCulled = false; // pour que l'accroche soit appelée même hors champ
  const cA = new THREE.Color(), cB = new THREE.Color(), fondEau = new THREE.Color(AMBIANCE_EAU.brouillard[0]);
  // le dôme du ciel (premier enfant du décor, voir construireDecor) : caché sous l'eau
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
    // le ciel (sans brouillard) se verrait à travers l'eau : fond bleu à la place
    scene.background = f > 0.5 ? fondEau : dehors.fond;
    if (dome) dome.visible = f > 0.5 ? false : dehors.dome;
    const E = AMBIANCE_EAU, D = dehors, mel = (x, y) => x + (y - x) * f;
    scene.fog.color.copy(cA.setHex(D.brouillard[0]).lerp(cB.setHex(E.brouillard[0]), f));
    scene.fog.near = mel(D.brouillard[1], E.brouillard[1]);
    scene.fog.far = mel(D.brouillard[2], E.brouillard[2]);
    ciel.color.copy(cA.setHex(D.ciel[0]).lerp(cB.setHex(E.ciel[0]), f));
    ciel.groundColor.copy(cA.setHex(D.ciel[1]).lerp(cB.setHex(E.ciel[1]), f));
    ciel.intensity = mel(D.ciel[2], E.ciel[2]);
    soleil.intensity = mel(D.soleil, E.soleil);
  }

  // petits "bloup" de bulles quand on est dans le tunnel
  let prochainBloup = 0;
  function bloup() {
    const ctx = audio.ctx;
    if (!ctx || ctx.state !== "running" || !audio.busEffets) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    const f0 = 260 + Math.random() * 260;
    o.type = "sine";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.6, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(audio.busEffets);
    o.start(t);
    o.stop(t + 0.14);
  }

  const v3 = new THREE.Vector3(), cible = new THREE.Vector3(), o = new THREE.Object3D();
  let t = 0, sCamAvant = null, vCam = 20;

  // Le mosasaure nage sur un grand circuit ovale fermé dans le bassin (repère de la piste, en
  // mètres) : deux longueurs le long des vitres, au-dessus des côtés du tunnel, et deux
  // demi-tours au-dessus de la voûte, où il passe en travers de la
  // route. Ce circuit est dessiné pour que tout son corps (19 m, raide : il est juste orienté
  // le long du chemin) reste dans l'eau ; contraindre() le vérifie à chaque image et le remet
  // dedans s'il le fallait (filet de sécurité, voir les essais numériques).
  // Le moment "waouh" : quand le kart arrive, il règle sa vitesse sur le chemin pour passer
  // en travers de la route (demi-tour du fond, gueule ouverte) ~22 m devant la caméra.
  const LONG = ((i1 - i0) * pas); // longueur du bassin (m)
  // enveloppe du corps mesurée sur le cycle de nage (sommets du modèle animé, nageoires comprises) :
  // ±9,6 m de long, ±4,6 m de large (nageoires), 2,8 m sous l’axe, 1,6 m au-dessus ; + le roulis
  const CORPS = { demi: 9.65, lat: 4.7, bas: 3.0, haut: 2.0 };
  // Le bassin suit un virage serré (rayon ~50 m) : le côté intérieur est bien plus court que le côté
  // extérieur. Le chemin est dessiné en vrais mètres autour du milieu du bassin, puis converti en
  // abscisse de la piste avec echelle(l) = longueur réelle d’un mètre de piste au latéral l.
  const RAYON = 20, DROIT = 15, C1 = LONG / 2 - DROIT / 2, C2 = LONG / 2 + DROIT / 2; // demi-tours : centres (m) et rayon (= latéral des longueurs)
  const PERIM = 2 * DROIT + 2 * Math.PI * RAYON;
  const sMil = (i0 + i1) / 2, pA = new THREE.Vector3(), pB = new THREE.Vector3();
  const echelle = (l) => point(sMil + 1, l, 0, pA).distanceTo(point(sMil - 1, l, 0, pB)) / (2 * pas);
  const ECH = [];
  for (let l = -W; l <= W; l++) ECH.push(echelle(l));
  const ech = (l) => { const u = THREE.MathUtils.clamp(l + W, 0, 2 * W - 1e-6), k = Math.floor(u); return ECH[k] + (ECH[k + 1] - ECH[k]) * (u - k); };
  const versS = (s, l) => sMil + (s - LONG / 2) / pas / ech(l); // mètres du chemin → abscisse de la piste
  // (corps raide de 19 m : pas de plongée, il sortirait la queue de l’eau ; juste une ondulation lente)
  const Y_HAUT = h + CORPS.bas + 0.7; // au-dessus de la voûte, sous la surface
  const pApex = DROIT + Math.PI * RAYON / 2; // milieu du demi-tour du fond : en travers de la route
  const sX = C2 + RAYON; // (m) là où il croise la route (demi-tour du fond)
  const TRAVERSEES = [{ p: pApex, s: sX }, { p: pApex + PERIM / 2, s: C1 - RAYON }]; // les deux demi-tours
  const AVANCE = 22;
  /** Point du chemin à l'abscisse p (m) : { s (m), l, y } et courbure (pour s'incliner). */
  function chemin(p, r = {}) {
    p = ((p % PERIM) + PERIM) % PERIM;
    if (p < DROIT) {
      // longueur côté -l, vers le fond
      return Object.assign(r, { s: C1 + p, l: -RAYON, y: Y_HAUT, k: 0 });
    }
    p -= DROIT;
    if (p < Math.PI * RAYON) {
      const th = p / RAYON - Math.PI / 2; // demi-tour du fond, de -l vers +l
      return Object.assign(r, { s: C2 + RAYON * Math.cos(th), l: RAYON * Math.sin(th), y: Y_HAUT, k: 1 / RAYON });
    }
    p -= Math.PI * RAYON;
    if (p < DROIT) {
      return Object.assign(r, { s: C2 - p, l: RAYON, y: Y_HAUT, k: 0 });
    }
    p -= DROIT;
    const th = p / RAYON + Math.PI / 2; // demi-tour de l'entrée, de +l vers -l
    return Object.assign(r, { s: C1 + RAYON * Math.cos(th), l: RAYON * Math.sin(th), y: Y_HAUT, k: 1 / RAYON });
  }
  const M = { p: DROIT * 0.3, v: 6, indice: Math.round((i0 + i1) / 2), pos: new THREE.Vector3(), dir: new THREE.Vector3(), roulis: 0, ouv: 0.1, corrige: 0 };
  const cA1 = {}, cA2 = {}, dirAvant = new THREE.Vector3(), tete = new THREE.Vector3();
  function placerChemin(p, pos, dir) {
    chemin(p, cA1);
    chemin(p + 0.5, cA2);
    cA1.y += 0.25 * Math.sin((4 * Math.PI * p) / PERIM);
    cA2.y += 0.25 * Math.sin((4 * Math.PI * (p + 0.5)) / PERIM);
    point(versS(cA1.s, cA1.l), cA1.l, cA1.y, pos);
    point(versS(cA2.s, cA2.l), cA2.l, cA2.y, dir).sub(pos).normalize();
    return cA1.k;
  }

  // --- filet de sécurité : le corps (segment de ±CORPS.demi, section CORPS.lat × (CORPS.bas + CORPS.haut))
  // reste dans le volume d'eau, hors du tunnel. Chaque point du corps est ramené dans l'eau
  // (repère piste), puis le segment est recalé sur ces points (moindres carrés).
  const NB_PTS = 9, ptsT = [], ptsQ = [];
  for (let k = 0; k < NB_PTS; k++) { ptsT.push(-1 + (2 * k) / (NB_PTS - 1)); ptsQ.push(new THREE.Vector3()); }
  const R = { bout: 0, vitre: 0, haut: 0, tunnel: 0 };
  const mL = 0.35; // marge (m) en plus de la section du corps
  function dansLeau(P, q) {
    const L = local(P, M.indice);
    let s = L.s, l = L.l, y = P.y;
    const sMin = i0 + (CORPS.lat + mL) / pas, sMax = i1 - (CORPS.lat + mL) / pas;
    s = THREE.MathUtils.clamp(s, sMin, sMax); if (s !== L.s) R.bout++;
    l = THREE.MathUtils.clamp(l, -W + CORPS.lat + mL, W - CORPS.lat - mL); if (l !== L.l) R.vitre++;
    y = THREE.MathUtils.clamp(y, CORPS.bas + mL, EAU - CORPS.haut - mL); if (y !== P.y) R.haut++;
    // hors de la voûte gonflée de la section du corps
    const ea = a + CORPS.lat + mL, eh = h + CORPS.bas + mL, e = (l / ea) ** 2 + (y / eh) ** 2;
    if (e < 1) { R.tunnel++;
      const f = 1 / Math.sqrt(Math.max(e, 1e-6));
      l *= f;
      y *= f;
    }
    if (s === L.s && l === L.l && y === P.y) return q.copy(P), false;
    point(s, l, y, q);
    return true;
  }
  function contraindre(pos, dir) {
    let corrige = false;
    for (let it = 0; it < 6; it++) {
      let bouge = false;
      for (let k = 0; k < NB_PTS; k++) bouge = dansLeau(v3.copy(pos).addScaledVector(dir, ptsT[k] * CORPS.demi), ptsQ[k]) || bouge;
      if (!bouge) break;
      corrige = true;
      // segment le plus proche des points corrigés : centre = moyenne, direction ∝ Σ t·q
      pos.set(0, 0, 0);
      for (const q of ptsQ) pos.add(q);
      pos.multiplyScalar(1 / NB_PTS);
      tete.set(0, 0, 0);
      for (let k = 0; k < NB_PTS; k++) tete.addScaledVector(v3.copy(ptsQ[k]).sub(pos), ptsT[k]);
      if (tete.lengthSq() > 1e-6) dir.copy(tete.normalize());
    }
    return corrige;
  }

  function nagerMosasaure(dt, sCam, vCam) {
    if (sCam === null || sCam > i1) { M.fait = false; M.cible = null; }
    let vDes = 6;
    const sCamM = sCam === null ? null : (sCam - i0) * pas;
    if (sCamM !== null && !M.fait) {
      // Le kart arrive : passer en travers de la route (milieu d'un demi-tour) quand il sera à
      // AVANCE m. Celui du fond de préférence ; sinon celui de l'entrée (le kart sort du T-rex
      // ~110 m avant le bassin : il n'y a pas toujours le temps de rejoindre le premier).
      M.cible = null;
      for (const c of TRAVERSEES) {
        const tK = (c.s - AVANCE - sCamM) / Math.max(6, vCam);
        if (tK <= 0) continue;
        const v = ((((c.p - M.p) % PERIM) + PERIM) % PERIM) / tK;
        if (v >= 1.5 && v <= 18) { M.cible = c; vDes = v; break; }
      }
      if (M.cible && (M.cible.s - AVANCE - sCamM) / Math.max(6, vCam) < 0.25) M.fait = true;
    }
    M.v += (vDes - M.v) * Math.min(1, dt * 2.5);
    M.p = (M.p + M.v * dt) % PERIM;
    M.indice = local(M.pos, M.indice).indice;
    dirAvant.copy(M.dir);
    placerChemin(M.p, M.pos, M.dir);
    if (contraindre(M.pos, M.dir)) M.corrige++;
    // gueule : grande ouverte en passant devant le kart, quelques bâillements sinon
    const c = M.cible, dApex = c ? Math.abs(((M.p - c.p + PERIM * 1.5) % PERIM) - PERIM / 2) : 99;
    const traverse = sCamM !== null && dApex < 14 && sCamM < c.s;
    moso.ouverture = traverse ? 0.75 : 0.08 + 0.12 * Math.max(0, Math.sin(t * 0.7) * Math.sin(t * 0.23)) ** 2;
    // un peu penché vers l'intérieur des virages (vitesse de rotation autour de la verticale)
    const omega = dt > 0 && dirAvant.lengthSq() > 0 ? (dirAvant.z * M.dir.x - dirAvant.x * M.dir.z) / dt : 0;
    M.roulis += (THREE.MathUtils.clamp(-omega * M.v * 0.12, -0.12, 0.12) - M.roulis) * Math.min(1, dt * 2);
    moso.objet.position.copy(M.pos);
    aq.updateWorldMatrix(true, false);
    moso.objet.lookAt(v3.copy(M.pos).add(M.dir).applyMatrix4(aq.matrixWorld)); // (lookAt vise un point du monde)
    moso.objet.rotateZ(M.roulis);
    moso.nager(dt, M.v);
  }

  function update(dt) {
    t += dt;
    temps.value = t;
    caustique.offset.set(t * 0.03, t * 0.017);
    caustique2.offset.set(-t * 0.021, t * 0.026);
    matRayons.opacity = 0.18 + 0.06 * Math.sin(t * 0.8);

    // la caméra : dans le tunnel ? à quelle distance ?
    let sCam = null, f = 0;
    if (camera) {
      const p = camera.position;
      const C = local(p, -1);
      if (C.s > i0 - 170 / pas && C.s < i1 + 10 / pas && Math.abs(C.l) < W + 20) sCam = C.s;
      if (Math.abs(C.l) < a && p.y + D < voute(C.l) + 0.5) // (repère du bassin : la route du fond est à y = 0)
        f = THREE.MathUtils.clamp(((C.s - i0) * pas) / 6, 0, 1) * THREE.MathUtils.clamp(((i1 - C.s) * pas) / 6, 0, 1);
    }
    // vitesse de la caméra le long de la route (pour régler le passage du mosasaure)
    if (sCam !== null && sCamAvant !== null && dt > 0) vCam += (THREE.MathUtils.clamp(((sCam - sCamAvant) * pas) / dt, 0, 40) - vCam) * Math.min(1, dt * 4);
    sCamAvant = sCam;
    ambiance(f);
    if (f > 0.5 && t > prochainBloup) {
      bloup();
      prochainBloup = t + 0.15 + Math.random() * 0.45;
    }

    nagerMosasaure(dt, sCam, vCam);

    // bulles
    const pb = geoBulles.attributes.position;
    let n = 0;
    for (const c of colonnes)
      for (let k = 0; k < PAR_COL; k++) {
        const y0 = 0.3;
        const y = y0 + (((t * c.v + c.ph + (k * (EAU - y0)) / PAR_COL) % (EAU - y0)) + (EAU - y0)) % (EAU - y0);
        point(c.s, c.l + Math.sin(t * 3 + k * 1.7) * 0.25, y, v3);
        pb.setXYZ(n++, v3.x + Math.cos(t * 2.3 + k) * 0.2, v3.y, v3.z);
      }
    pb.needsUpdate = true;

    // poissons
    for (const b of bancs) {
      const ph = t * 0.16 + b.ph;
      const u = 0.5 + 0.38 * Math.sin(ph);
      const l = b.cote ? b.cote * (a + 5.5 + 2.5 * Math.sin(ph * 2.3)) : 6 * Math.sin(ph * 1.7);
      const y = b.cote ? 4 + 2.5 * Math.sin(ph * 1.3) : h + 4.4 + 0.9 * Math.sin(ph * 2);
      point(i0 + marge + u * (i1 - i0 - 2 * marge), l, y, cible);
      if (cible.distanceToSquared(b.pos) > 1e-6) b.dir.subVectors(cible, b.pos).normalize();
      b.pos.copy(cible);
      const yaw = Math.atan2(b.dir.x, b.dir.z);
      b.membres.forEach((m, k) => {
        o.position.set(m.x, m.y + Math.sin(t * 1.5 + m.ph) * 0.3, m.z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(b.pos);
        o.rotation.set(0, yaw + Math.sin(t * 6 + m.ph) * 0.15, 0);
        o.scale.setScalar(m.e);
        o.updateMatrix();
        b.im.setMatrixAt(k, o.matrix);
      });
      b.im.instanceMatrix.needsUpdate = true;
    }
  }

  const retour = { update, objet: aq, mosasaure: moso, nage: M, corps: CORPS, R, traversees: TRAVERSEES, eau: { W, H, EAU, a, h, D, i0, i1, sA, sB } };
  if (import.meta.env.DEV) {
    window.__aquarium = retour; // (nage, corps, eau : pour les essais)
    retour.diag = (p) => { const pos = new THREE.Vector3(), dir = new THREE.Vector3(); placerChemin(p, pos, dir); return ptsT.map((t) => { const q = pos.clone().addScaledVector(dir, t * CORPS.demi), L = local(q, M.indice); return [+((L.s - i0) * pas).toFixed(2), +L.l.toFixed(2), +q.y.toFixed(2)]; }); };
  }
  return retour;
}

// ---------------------------------------------------------------------------
// Mosasaure : creerMosasaure() renvoie { objet, ouverture, nager(dt, vitesse) } avec la tête
// vers +z (~19 m de long, échelle comprise) : l'aquarium ne fait que le déplacer et l'orienter.
//
// Vrai modèle : public/aquarium/mosasaure.glb, d'après « Mosasaurus » d'Alexey Zaika
// (https://sketchfab.com/3d-models/mosasaurus-684754a2ad8c46aca0634326b53d1f04, CC-BY 4.0),
// préparé par outils/blender/preparer_mosasaure.sh (≈5 600 triangles, un cycle de nage « Nager »
// qui boucle, mâchoire = os Bone.026). En attendant le chargement (ou s'il échoue), c'est le
// mosasaure en formes simples ci-dessous qui nage.
const LONGUEUR_MOSASAURE = 19; // m
// rotation de la mâchoire (os Bone.026, autour de son axe x local) par unité d’"ouverture" :
// le signe ouvre vers le bas (vérifié sur des captures), 1 = ~57° au maximum.
const SENS_MACHOIRE = 0.8;
let modeleMosasaure = null; // promesse partagée : le GLB n'est chargé qu'une fois

export function creerMosasaure() {
  const provisoire = creerMosasaureFormes();
  const objet = new THREE.Group();
  objet.name = "mosasaure";
  objet.add(provisoire.objet);

  let mixer = null, machoire = null, reposMachoire = null, ouv = 0.1;
  const qOuv = new THREE.Quaternion(), AXE_MACHOIRE = new THREE.Vector3(1, 0, 0);

  modeleMosasaure ??= new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "aquarium/mosasaure.glb");
  modeleMosasaure
    .then((gltf) => {
      const scene = skeletonClone(gltf.scene);
      scene.traverse((o) => {
        if (!machoire && /^Bone\.?026/.test(o.name)) machoire = o;
      });
      let clip = gltf.animations.find((c) => c.name === "Nager") ?? gltf.animations[0];
      // La mâchoire est pilotée par le jeu seul : on retire ses pistes du cycle de nage.
      // (Elles sont constantes : le mixer, qui n'écrit une valeur que si elle change, ne remettait
      // donc jamais l'os à sa pose ; la rotation d'ouverture s'ajoutait à chaque image et la
      // mâchoire tournait sur elle-même, à travers la tête.)
      if (clip && machoire) {
        clip = clip.clone();
        clip.tracks = clip.tracks.filter((t) => !t.name.startsWith(machoire.name + "."));
      }
      mixer = new THREE.AnimationMixer(scene);
      if (clip) mixer.clipAction(clip).play();
      mixer.update(0);
      scene.traverse((o) => {
        if (!o.isMesh) return;
        moso.peau = o;
        const ancien = o.material;
        // sans brouillard (bien visible de loin dans l'eau bleue) ; un peu de lumière propre
        // pour que la peau reste lisible sous l'eau, où le soleil est faible
        o.material = new THREE.MeshLambertMaterial({ map: ancien.map, emissive: 0xffffff, emissiveMap: ancien.map, emissiveIntensity: 0.12, side: THREE.DoubleSide, fog: false });
        ancien.dispose();
        o.frustumCulled = false; // la nage sort de la boîte de la pose de repos
      });
      if (machoire) reposMachoire = machoire.quaternion.clone();
      // orientation et taille mesurées sur la pose de nage : de la queue vers la tête = +z
      const pivot = new THREE.Group();
      pivot.add(scene);
      pivot.updateMatrixWorld(true);
      scene.traverse((o) => o.isSkinnedMesh && o.skeleton.update());
      const boite = new THREE.Box3().setFromObject(scene, true);
      const taille = boite.getSize(new THREE.Vector3());
      const centre = boite.getCenter(new THREE.Vector3());
      const tete = machoire ? machoire.getWorldPosition(new THREE.Vector3()) : centre.clone().add(new THREE.Vector3(0, 0, 1));
      const axe = new THREE.Vector3();
      axe.setComponent([taille.x, taille.y, taille.z].indexOf(Math.max(taille.x, taille.y, taille.z)), 1);
      if (axe.dot(tete.clone().sub(centre)) < 0) axe.negate();
      scene.position.sub(centre);
      pivot.quaternion.setFromUnitVectors(axe, new THREE.Vector3(0, 0, 1));
      pivot.scale.setScalar(LONGUEUR_MOSASAURE / Math.max(taille.x, taille.y, taille.z));
      objet.remove(provisoire.objet);
      objet.add(pivot);
    })
    .catch((e) => console.warn("Mosasaure GLB indisponible, on garde le provisoire :", e));

  const moso = {
    objet,
    ouverture: 0.12,
    /** Avance le cycle de nage (fréquence de la queue selon la vitesse en m/s). */
    nager(dt, vitesse = 7) {
      if (!mixer) {
        provisoire.ouverture = moso.ouverture;
        provisoire.nager(dt, vitesse);
        return;
      }
      // cycle de 1,33 s : ~2 s à 7 m/s, ~1,3 s à 14 m/s (comme le provisoire)
      mixer.update(dt * (1.6 + vitesse * 0.22) / 4.71);
      // ouverture lissée (s'ouvre en ~0,5 s, se referme un peu plus vite), toujours depuis la pose de repos
      ouv += (moso.ouverture - ouv) * Math.min(1, dt * (moso.ouverture > ouv ? 4 : 6));
      if (machoire) machoire.quaternion.copy(reposMachoire).multiply(qOuv.setFromAxisAngle(AXE_MACHOIRE, ouv * SENS_MACHOIRE));
    },
  };
  return moso;
}

/** Mosasaure provisoire en formes simples (repli tant que le GLB n'est pas chargé). */
function creerMosasaureFormes() {
  const temps = { value: 0 }, ouverture = { value: 0.12 };
  const DOS = new THREE.Color(0x2e4659), VENTRE = new THREE.Color(0xe6dfcc), BOUCHE = new THREE.Color(0xc2565e);
  const parties = [];

  /** Corps "lofté" : ellipses (z, rx, ry, yc) ; couleur sombre dessus, pâle dessous. */
  function loft(sections, opts = {}) {
    const R = 14, pos = [], col = [], rame = [], mach = [], idx = [];
    const c = new THREE.Color();
    sections.forEach(([z, rx, ry, yc], k) => {
      for (let j = 0; j < R; j++) {
        const th = (j / R) * Math.PI * 2, sx = Math.cos(th), sy = Math.sin(th);
        pos.push(rx * sx, yc + ry * sy, z);
        // contre-ombrage avec quelques taches
        const m = THREE.MathUtils.smoothstep(sy, -0.45, 0.15);
        c.copy(VENTRE).lerp(DOS, m);
        if (m > 0.5) c.multiplyScalar(0.88 + 0.12 * Math.sin(z * 4.1 + th * 7) * Math.sin(z * 2.3));
        if (opts.bouche && z > opts.bouche && opts.bouche_cote * sy > 0.35) c.copy(BOUCHE);
        col.push(c.r, c.g, c.b);
        rame.push(0);
        mach.push(opts.machoire ? 1 : 0);
      }
      if (k < sections.length - 1)
        for (let j = 0; j < R; j++) {
          const p = k * R + j, q = k * R + ((j + 1) % R);
          idx.push(p, q, p + R, q, q + R, p + R);
        }
    });
    // bouts fermés
    for (const [k, sens] of [[0, -1], [sections.length - 1, 1]]) {
      const [z, , , yc] = sections[k], centre = pos.length / 3;
      pos.push(0, yc, z + sens * 0.02);
      c.copy(DOS);
      col.push(c.r, c.g, c.b);
      rame.push(0);
      mach.push(opts.machoire ? 1 : 0);
      for (let j = 0; j < R; j++) {
        const p = k * R + j, q = k * R + ((j + 1) % R);
        idx.push(...(sens > 0 ? [p, q, centre] : [q, p, centre]));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("rame", new THREE.Float32BufferAttribute(rame, 1));
    g.setAttribute("machoire", new THREE.Float32BufferAttribute(mach, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    parties.push(g.toNonIndexed());
  }
  /** Pièce simple d'une couleur ; rame(x, y, z) = amplitude du battement. */
  function piece(geo, couleur, rame = () => 0, machoire = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute("uv");
    const n = g.attributes.position.count, p = g.attributes.position;
    const c = new THREE.Color(couleur), col = [], r = [], m = [];
    for (let i = 0; i < n; i++) {
      col.push(c.r, c.g, c.b);
      r.push(rame(p.getX(i), p.getY(i), p.getZ(i)));
      m.push(machoire);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("rame", new THREE.Float32BufferAttribute(r, 1));
    g.setAttribute("machoire", new THREE.Float32BufferAttribute(m, 1));
    parties.push(g);
  }

  // corps et crâne (de la queue au bout du museau)
  loft([
    [-7.0, 0.04, 0.08, 0.2], [-6.2, 0.12, 0.22, 0.14], [-5.2, 0.22, 0.38, 0.08], [-4.0, 0.36, 0.55, 0.03],
    [-2.6, 0.58, 0.78, 0], [-1.0, 0.82, 0.98, 0], [0.6, 0.95, 1.05, 0], [2.0, 0.9, 0.95, 0.02],
    [3.2, 0.7, 0.72, 0.06], [4.0, 0.6, 0.55, 0.12], [5.0, 0.48, 0.4, 0.12], [5.9, 0.34, 0.3, 0.08],
    [6.6, 0.2, 0.2, 0.04], [7.1, 0.06, 0.08, 0],
  ], { bouche: 4.3, bouche_cote: -1 });
  // mâchoire inférieure (tourne autour de son articulation)
  loft([[3.7, 0.5, 0.3, -0.42], [4.6, 0.42, 0.2, -0.42], [5.6, 0.3, 0.15, -0.36], [6.5, 0.15, 0.1, -0.28], [7.0, 0.05, 0.04, -0.24]], { machoire: true, bouche: 4.0, bouche_cote: 1 });
  // dents
  const dent = new THREE.ConeGeometry(0.055, 0.2, 4);
  for (let z = 4.5; z < 6.9; z += 0.2) {
    const rx = THREE.MathUtils.lerp(0.42, 0.1, (z - 4.5) / 2.4);
    for (const c of [-1, 1]) {
      piece(dent.clone().rotateX(Math.PI).translate(c * rx * 0.8, -0.18 - (z - 4.5) * 0.02, z), 0xfffbe8);
      if (z < 6.6) piece(dent.clone().translate(c * rx * 0.75, -0.2 - (6.6 - z) * 0.03, z + 0.08), 0xfffbe8, undefined, 1);
    }
  }
  // yeux
  for (const c of [-1, 1]) {
    piece(new THREE.SphereGeometry(0.14, 8, 6).translate(c * 0.41, 0.27, 4.95), 0xffd43b);
    piece(new THREE.SphereGeometry(0.085, 6, 5).translate(c * 0.5, 0.29, 5.0), 0x111111);
  }
  // nageoires (palettes) : avant et arrière
  const palette = (lx, lz, x, y, z, c, ang) => new THREE.SphereGeometry(1, 9, 5).scale(lx, 0.1, lz).translate(c * lx * 0.9, 0, -lz * 0.3).rotateY(c * ang).rotateZ(c * -0.25).translate(c * x, y, z);
  for (const c of [-1, 1]) {
    piece(palette(1.3, 0.5, 0.75, -0.6, 2.0, c, 0.55), 0x3b5568, (x) => Math.max(0, Math.abs(x) - 0.8));
    piece(palette(0.95, 0.38, 0.55, -0.45, -2.2, c, 0.6), 0x3b5568, (x) => Math.max(0, Math.abs(x) - 0.6));
  }
  // nageoire de queue en croissant (lobe du bas plus grand, comme les vrais mosasaures)
  const f = new THREE.Shape();
  f.moveTo(-5.7, 0.2);
  f.quadraticCurveTo(-6.8, 0.8, -7.7, 1.5);
  f.quadraticCurveTo(-7.3, 0.6, -7.1, 0.15);
  f.quadraticCurveTo(-7.5, -0.9, -7.8, -2.0);
  f.quadraticCurveTo(-6.6, -1.0, -5.8, -0.15);
  piece(new THREE.ShapeGeometry(f, 4).rotateY(-Math.PI / 2), 0x2b4152);

  const geo = mergeGeometries(parties);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }); // sans brouillard : bien visible de loin dans l'eau bleue
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.temps = temps;
    sh.uniforms.ouverture = ouverture;
    sh.vertexShader = "uniform float temps;\nuniform float ouverture;\nattribute float rame;\nattribute float machoire;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      // la mâchoire s'ouvre autour de son articulation (z = 3.7, y = -0.3)
      if (machoire > 0.5) {
        vec2 d = vec2(transformed.z - 3.7, transformed.y + 0.3);
        float ca = cos(ouverture), sa = sin(ouverture);
        transformed.z = 3.7 + d.x * ca + d.y * sa;
        transformed.y = -0.3 - d.x * sa + d.y * ca;
      }
      // ondulation : presque rien à la tête, beaucoup à la queue
      float zt = clamp((2.5 - position.z) / 10.0, 0.0, 1.0);
      transformed.x += (0.07 + 1.1 * zt * zt) * sin(position.z * 0.5 + temps);
      // battement des nageoires
      transformed.y += rame * 0.4 * sin(temps * 0.8 + position.z * 0.2);`);
  };
  const objet = new THREE.Mesh(geo, mat);
  objet.name = "mosasaure";
  objet.frustumCulled = false; // l'ondulation sort un peu de la boîte
  objet.scale.setScalar(1.3); // ~18 m : un vrai géant des mers

  let phase = 0;
  const moso = {
    objet,
    ouverture: 0.12,
    /** Avance le cycle de nage (fréquence de la queue selon la vitesse en m/s). */
    nager(dt, vitesse = 7) {
      phase += dt * (1.6 + vitesse * 0.22);
      temps.value = phase;
      ouverture.value += (moso.ouverture - ouverture.value) * Math.min(1, dt * 3);
    },
  };
  return moso;
}

// ---------------------------------------------------------------------------
/** Verre : très transparent de face, plus visible de biais (bord des vitres lisible). */
function verre(couleur, base, bord) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { couleur: { value: new THREE.Color(couleur) }, base: { value: base }, bord: { value: bord } }]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 couleur;
      uniform float base;
      uniform float bord;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float f3 = f * f * f;
        gl_FragColor = vec4(couleur + vec3(0.35) * f3 * f, base + (bord - base) * f3);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/** Reflets d'eau (cellules lumineuses), répétables. */
function textureCaustique() {
  const S = 256, rnd = aleatoire(3), pts = [];
  for (let k = 0; k < 18; k++) pts.push([rnd() * S, rnd() * S]);
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d"), img = g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9;
      for (const [px, py] of pts) {
        let dx = Math.abs(x - px), dy = Math.abs(y - py);
        dx = Math.min(dx, S - dx);
        dy = Math.min(dy, S - dy);
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      const e = Math.sqrt(d2) - Math.sqrt(d1);
      const v = Math.round(255 * Math.exp(-e / 4.5) ** 1.5);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dégradé vertical pour les rayons de lumière (clair en haut, invisible en bas et sur les côtés). */
function textureRayon() {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 128;
  const g = c.getContext("2d");
  for (let x = 0; x < 32; x++) {
    const bord = Math.sin((x / 31) * Math.PI);
    const d = g.createLinearGradient(0, 0, 0, 128);
    d.addColorStop(0, `rgba(255,255,255,${bord})`);
    d.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = d;
    g.fillRect(x, 0, 1, 128);
  }
  return new THREE.CanvasTexture(c);
}

/** Mur de grosses pierres taillées (4 m × 4 m par répétition), pour la tranchée. */
function texturePierre() {
  const S = 256, rnd = aleatoire(11);
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = "#6f6a60"; // joints
  g.fillRect(0, 0, S, S);
  const rangs = 5, hR = S / rangs;
  for (let r = 0; r < rangs; r++) {
    let x = r % 2 ? -hR * 0.6 : 0;
    while (x < S) {
      const w = hR * (1.1 + rnd() * 0.9), v = 150 + rnd() * 45;
      const t = rnd() * 14 - 7;
      g.fillStyle = `rgb(${v + t + 8},${v + t},${v - 12 + t})`;
      for (const dx of [0, S, -S]) g.fillRect(x + dx + 2, r * hR + 2, w - 4, hR - 4);
      x += w;
    }
  }
  // grain
  const img = g.getImageData(0, 0, S, S);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 22;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Gravier (fond de la tranchée). */
function textureGravier() {
  const S = 128, rnd = aleatoire(5);
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = "#9a917f";
  g.fillRect(0, 0, S, S);
  for (let k = 0; k < 900; k++) {
    const v = 110 + rnd() * 100;
    g.fillStyle = `rgb(${v},${v - 6},${v - 16})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 3, 1 + rnd() * 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textureBulle() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const d = g.createRadialGradient(16, 16, 4, 16, 16, 15);
  d.addColorStop(0, "rgba(255,255,255,0.15)");
  d.addColorStop(0.75, "rgba(255,255,255,0.5)");
  d.addColorStop(0.9, "rgba(255,255,255,0.95)");
  d.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = d;
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.arc(11, 11, 3, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(c);
}

/** Queue de poisson : un triangle plat derrière le corps. */
function queue() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.45, 0, 0.35, -0.85, 0, -0.35, -0.85], 3));
  g.computeVertexNormals();
  return g;
}

function fusionCouleurs(parties) {
  return mergeGeometries(parties.map(({ geo }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute("uv");
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  }));
}

function instances(geo, mat, liste) {
  const m = new THREE.InstancedMesh(geo, mat, liste.length);
  const o = new THREE.Object3D(), c = new THREE.Color();
  liste.forEach((p, i) => {
    o.position.set(p.x, p.y ?? 0, p.z);
    o.rotation.set(0, p.r ?? 0, 0);
    o.scale.set(p.s, p.sy ?? p.s, p.s);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
    if (p.couleur !== undefined) m.setColorAt(i, c.set(p.couleur));
  });
  return m;
}

function aleatoire(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
