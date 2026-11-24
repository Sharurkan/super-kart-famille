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
//  - piste.zonesDecor : { nom, debut, fin, demi, demiPlus, demiMoins } = emprise au sol (échantillons debut..fin,
//    demi-largeur latérale en mètres, de chaque côté). La forêt n'y plante rien.
//  - l'objet renvoyé a update(dt) (appelé avec les mixers du décor, temps du jeu) ;
//    la caméra et la scène sont retrouvées au premier rendu (onBeforeRender).
//  - dans le tunnel, l'ambiance (brouillard, lumières) devient bleue, sans toucher course.js.

export const AQUARIUM = {
  debut: 0.729, // fraction du tour (virages du bas, après la tête de T-rex)
  fin: 0.836, // ~138 m de tunnel (échantillons 816 → 936) : il suit le grand virage à droite du bas
  demiTunnel: 16.5, // demi-largeur du tunnel (les barrières sont à 14,8 m)
  hautTunnel: 8, // hauteur du sommet de la voûte
  // Le bassin n'est pas symétrique : côté intérieur du virage (+l), le rayon de la route n'est que
  // de ~39 m ; côté extérieur (−l), il y a toute la place pour les boucles du mosasaure géant.
  demi: 28, // demi-largeur du bassin côté intérieur du virage (+l)
  demiExt: 48, // demi-largeur du bassin côté extérieur du virage (−l)
  haut: 24, // hauteur des vitres (depuis la route du fond) ; l'eau s'arrête un peu en dessous
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

/** Ambiance sous l'eau (mêmes clés que AMBIANCE_VENTRE de ventre.js). */
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
  const Wp = A.demi, Wm = A.demiExt, H = A.haut, a = A.demiTunnel, h = A.hautTunnel, D = A.profondeur;
  const Wc = (c) => (c > 0 ? Wp : Wm); // demi-largeur du bassin du côté c (±1)
  const AIRE = (Wp + Wm - 2 * a) / (2 * (28 - a)); // (densités réglées pour l'ancien bassin de ±28 m)
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
    { nom: "aquarium", debut: i0 - 2, fin: i1 + 2, demi: Math.max(Wp, Wm) + 2, demiPlus: Wp + 2, demiMoins: Wm + 2 },
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
    const W = Wc(c);
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
    for (const c of [-1, 1]) poteaux.push(new THREE.BoxGeometry(0.7, H - D, 0.7).translate(c * Wc(c), (H + D) / 2, 0).applyMatrix4(repere(i0 + ((i1 - i0) * k) / nbPoteaux)));

  // --- les deux bouts : façade en béton percée par le tunnel (sous le sol), vitre au-dessus ---
  // (repère d'un bout : x = latéral +l, y = haut, z = le long de la route)
  const facade = new THREE.Shape();
  facade.moveTo(-Wm, 0);
  facade.lineTo(-a - 0.3, 0);
  for (let k = 0; k <= 20; k++) facade.lineTo(-(a + 0.3) * Math.cos((Math.PI * k) / 20), (h + 0.3) * Math.sin((Math.PI * k) / 20));
  facade.lineTo(Wp, 0);
  facade.lineTo(Wp, D);
  facade.lineTo(-Wm, D);
  const largeur = Wp + Wm, milieu = (Wp - Wm) / 2; // largeur totale du bassin, latéral de son milieu
  const bouts = [], facades = [], portiques = [];
  for (const s of [i0, i1]) {
    const m = repere(s);
    bouts.push(new THREE.PlaneGeometry(largeur, H - D).translate(milieu, (H + D) / 2, 0).applyMatrix4(m));
    const f = new THREE.ShapeGeometry(facade);
    // UV en mètres (texture de pierre de la tranchée)
    const p = f.attributes.position, uvf = f.attributes.uv;
    for (let k = 0; k < p.count; k++) uvf.setXY(k, p.getX(k) / 4, p.getY(k) / 4);
    facades.push(f.applyMatrix4(m));
    // portique : arche épaisse autour de l'entrée du tunnel
    const pts = [];
    for (let k = 0; k <= 20; k++) pts.push(new THREE.Vector3((a + 0.5) * Math.cos((Math.PI * k) / 20), (h + 0.5) * Math.sin((Math.PI * k) / 20), 0));
    portiques.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.6, 6, false).applyMatrix4(m));
    poteaux.push(new THREE.BoxGeometry(largeur + 0.7, 0.9, 0.7).translate(milieu, H - 0.25, 0).applyMatrix4(m));
    // corniche au-dessus de l'entrée, au niveau du sol
    margelles.push(new THREE.BoxGeometry(largeur + 1.4, 0.6, 1.4).translate(milieu, D + 0.25, 0).applyMatrix4(m));
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
    const bord = (s, c) => (s >= i0 && s <= i1 ? Wc(c) + 0.3 : latHaut(s) + 0.35);
    for (let s = sA + 1; s <= sB - 1; s++) {
      if (s === i0 || s === i1) {
        // marche nette contre la façade du bassin
        const avant = s === i0 ? latHaut(s) + 0.35 : Wp + 0.3, apres = s === i0 ? Wp + 0.3 : latHaut(s) + 0.35;
        contour.push(point(s, avant, 0, v).clone(), point(s, apres, 0, v).clone());
      } else contour.push(point(s, bord(s, 1), 0, v).clone());
    }
    for (let s = sB - 1; s >= sA + 1; s--) {
      if (s === i0 || s === i1) {
        const avant = s === i1 ? latHaut(s) + 0.35 : Wm + 0.3, apres = s === i1 ? Wm + 0.3 : latHaut(s) + 0.35;
        contour.push(point(s, -avant, 0, v).clone(), point(s, -apres, 0, v).clone());
      } else contour.push(point(s, -bord(s, -1), 0, v).clone());
    }
    percerSol(groupe, contour);
  }

  // --- fond de sable (reflets d'eau qui bougent) et surface de l'eau ---
  const sable = new THREE.MeshLambertMaterial({ color: 0xd8c690, emissive: 0x8fe3ff, emissiveMap: caustique, emissiveIntensity: 0.7, side: THREE.DoubleSide });
  for (const c of [-1, 1]) {
    const fond = new THREE.Mesh(grille(2, (s, b, v) => point(s, c * (a + 0.4 + b * (Wc(c) - a - 0.4)), 0.07, v)), sable);
    aq.add(fond);
  }
  const surface = new THREE.Mesh(
    grille(6, (s, b, v) => point(s, -Wm + largeur * b, EAU, v)),
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
  // (densités réglées pour 75 m de bassin, multipliées par DENS : même aspect quelle que soit la longueur)
  const DENS = ((i1 - i0) * pas) / 75;
  const rayons = [];
  for (let k = 0; k < Math.round(9 * DENS); k++) {
    const s = i0 + 4 + rnd() * (i1 - i0 - 8);
    const dessus = k % 3 === 0; // certains tombent sur la voûte
    const c = rnd() < 0.5 ? -1 : 1, l = dessus ? (rnd() - 0.5) * a : c * (a + 3 + rnd() * (Wc(c) - a - 6));
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
  while (algues.length < Math.round(48 * DENS * AIRE)) {
    const s = i0 + 2 + rnd() * (i1 - i0 - 4), c = rnd() < 0.5 ? -1 : 1, l = c * (a + 1.5 + rnd() * (Wc(c) - a - 3));
    const p = point(s, l, 0);
    algues.push({ x: p.x, z: p.z, s: 0.8 + rnd() * 0.8, sy: 3 + rnd() * 8, r: rnd() * 6, couleur: verts[Math.floor(rnd() * verts.length)] });
  }
  aq.add(instances(algue, matAlgue, algues));
  // rochers : vrais rochers scannés de la forêt (sans la garde : on est dans le bassin)
  const rochers = (nom, n, e) => {
    const liste = [];
    for (let k = 0; k < n; k++) {
      const s = i0 + 3 + rnd() * (i1 - i0 - 6), c = rnd() < 0.5 ? -1 : 1, l = c * (a + 3 + rnd() * (Wc(c) - a - 6));
      const p = point(s, l, 0);
      liste.push({ x: p.x, y: -0.1, z: p.z, s: e * (0.7 + rnd() * 0.6), r: rnd() * 6.3 });
    }
    planter(aq, nom, liste);
  };
  rochers("Gros_Rocher", Math.round(2 * DENS * AIRE), 1.1);
  rochers("Rocher_07", Math.round(3 * DENS * AIRE), 1.4);
  rochers("Rocher_Mousse_B", Math.round(3 * DENS * AIRE), 1.5);

  // --- bulles : colonnes qui montent du fond et du pied de la voûte ---
  const NB_COL = Math.round(14 * DENS), PAR_COL = 9;
  const colonnes = [];
  for (let k = 0; k < NB_COL; k++) {
    const s = i0 + 3 + rnd() * (i1 - i0 - 6), c = k % 2 ? -1 : 1;
    const l = k < NB_COL * 0.43 ? c * (a + 0.8) : c * (a + 3 + rnd() * (Wc(c) - a - 6));
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

  // Le mosasaure géant (57 m) nage sur un grand 8 au-dessus de la voûte : deux boucles rondes
  // (rayon 26 m, mesuré dans le monde) près des bouts du bassin (à ~16 m des vitres des bouts),
  // reliées par deux lignes droites qui se croisent au milieu, en travers de la route (~50°). Les
  // boucles passent aussi en travers de la route : au fond (presque à angle droit) et à l'entrée.
  // Elles sont décalées vers l'extérieur du virage, où le bassin est plus large (AQUARIUM.demiExt).
  // Il ne glisse pas sur le chemin comme un bâton : sa colonne vertébrale se plie pour le suivre
  // (creerMosasaure : nager(dt, vitesse, cap)), la tête devant, la queue dans ses traces.
  // M.p = abscisse (m, mesurée dans le monde) de la racine du cou sur le chemin.
  // Le moment "waouh" : quand le kart arrive, il règle sa vitesse pour passer en travers de la
  // route (gueule ouverte) ~55 m devant la caméra (assez loin pour le voir en entier : la caméra
  // regarde un peu vers le bas, champ de 66°), puis vise le passage suivant s'il a le temps.
  // contraindre() vérifie à chaque image que tout son corps (os réels, avec leur rayon) reste
  // dans l'eau et le remet dedans s'il le fallait (filet de sécurité).
  const LONG = (i1 - i0) * pas; // longueur du bassin (m, sur la ligne du milieu)
  const ECH = LONGUEUR_MOSASAURE / 19; // (mesures faites sur le modèle de 19 m, voir POINTS_CORPS)
  // hauteur du repère du mosasaure : le dessous des nageoires avant (2,82 m sous l'axe à 19 m,
  // gueule ouverte comprise) passe au-dessus de la voûte ; le haut de la queue (1,58 m) sous la surface
  const ONDULE = 0.25; // (m) petite ondulation verticale du chemin
  const Y_HAUT = h + 2.82 * ECH + 0.9 + ONDULE; // (+ le roulis dans les virages, qui baisse une nageoire)
  const BOUCLE = { sN: 40, sF: LONG - 40, l: -10, r: 26 }; // centres des boucles (m le long de la route, latéral), rayon
  const NB_CH = 1400;
  const CH = (() => {
    const centre = (sm) => point(i0 + sm / pas, BOUCLE.l, 0);
    const CN = centre(BOUCLE.sN), CF = centre(BOUCLE.sF), r = BOUCLE.r;
    const d = new THREE.Vector3().subVectors(CF, CN), dist = d.length();
    const base = Math.atan2(d.z, d.x), ang = Math.acos((2 * r) / dist); // tangentes intérieures (elles se croisent)
    const sur = (C, A) => new THREE.Vector3(C.x + r * Math.cos(A), 0, C.z + r * Math.sin(A));
    const brut = [];
    const arc = (C, a0, a1, sens) => {
      let da = a1 - a0;
      while (sens * da <= 0) da += sens * 2 * Math.PI;
      const n = Math.ceil((Math.abs(da) * r) / 0.4);
      for (let k = 0; k < n; k++) brut.push(sur(C, a0 + (da * k) / n));
    };
    const ligne = (P, Q) => {
      const n = Math.ceil(P.distanceTo(Q) / 0.4);
      for (let k = 0; k < n; k++) brut.push(P.clone().lerp(Q, k / n));
    };
    const tN1 = base + ang, tN2 = base - ang, tF1 = base + Math.PI + ang, tF2 = base + Math.PI - ang;
    arc(CN, tN1, tN2, 1); // boucle de l'entrée (par le côté loin du milieu)
    ligne(sur(CN, tN2), sur(CF, tF2));
    arc(CF, tF2, tF1, -1); // boucle du fond, dans l'autre sens (c'est un 8)
    ligne(sur(CF, tF1), sur(CN, tN1));
    // table à pas constant (m du monde) : position, direction, et repère de la piste (sm, l)
    const cum = [0];
    for (let k = 1; k <= brut.length; k++) cum.push(cum[k - 1] + brut[k - 1].distanceTo(brut[k % brut.length]));
    const perim = cum[brut.length], pts = [];
    let j = 0, indice = Math.round((i0 + i1) / 2);
    for (let k = 0; k <= NB_CH; k++) {
      const u = (k / NB_CH) * perim;
      while (cum[j + 1] < u && j < brut.length - 1) j++;
      const f = (u - cum[j]) / (cum[j + 1] - cum[j] || 1);
      const P = brut[j].clone().lerp(brut[(j + 1) % brut.length], f);
      const L = local(P, indice);
      indice = L.indice;
      pts.push({ x: P.x, z: P.z, s: (L.s - i0) * pas, l: L.l, tx: 0, tz: 0 });
    }
    for (let k = 0; k <= NB_CH; k++) {
      const A = pts[(k - 1 + NB_CH) % NB_CH], B = pts[(k + 1) % NB_CH], n = Math.hypot(B.x - A.x, B.z - A.z);
      pts[k].tx = (B.x - A.x) / n;
      pts[k].tz = (B.z - A.z) / n;
    }
    pts.perim = perim;
    return pts;
  })();
  const PERIM = CH.perim;
  // passages en travers de la route : là où le latéral change de signe ({ p : abscisse du chemin, s : sm })
  const TRAVERSEES = [];
  for (let k = 0; k < NB_CH; k++) {
    const A1 = CH[k], A2 = CH[k + 1];
    if (A1.l !== 0 && Math.sign(A1.l) === Math.sign(A2.l)) continue;
    const f = A1.l / (A1.l - A2.l || 1);
    TRAVERSEES.push({ p: ((k + f) / NB_CH) * PERIM, s: A1.s + (A2.s - A1.s) * f });
  }
  const AVANCE = 55; // (m) il traverse la route à cette distance devant la caméra (plus près, il sortirait du haut de l'écran)
  /** Point du chemin à l'abscisse p (m) : { x, z, tx, tz } (repère du bassin). */
  function chemin(p, r = {}) {
    const u = ((((p % PERIM) + PERIM) % PERIM) / PERIM) * NB_CH, k = Math.min(NB_CH - 1, Math.floor(u)), f = u - k;
    const A1 = CH[k], A2 = CH[k + 1];
    r.x = A1.x + (A2.x - A1.x) * f;
    r.z = A1.z + (A2.z - A1.z) * f;
    r.tx = A1.tx + (A2.tx - A1.tx) * f;
    r.tz = A1.tz + (A2.tz - A1.tz) * f;
    const n = Math.hypot(r.tx, r.tz);
    r.tx /= n;
    r.tz /= n;
    return r;
  }
  const M = { p: TRAVERSEES[0].p + 60, v: 9, indice: Math.round((i0 + i1) / 2), pos: new THREE.Vector3(), dir: new THREE.Vector3(), roulis: 0, corrige: 0, filet: new THREE.Vector3(), decal: new THREE.Vector3(), cible: null, derniere: null, faites: new Set() };
  const c0 = {}, c1 = {}, dirAvant = new THREE.Vector3(), decale = new THREE.Vector3();
  /** Angle (rad, autour de la verticale) de la direction du chemin à d mètres de la racine du cou (d < 0 : derrière). */
  function cap(d) {
    chemin(M.p, c0);
    chemin(M.p + d, c1);
    return Math.atan2(c0.tz * c1.tx - c0.tx * c1.tz, c0.tx * c1.tx + c0.tz * c1.tz);
  }

  // --- filet de sécurité : chaque os du corps (avec son rayon : latéral, dessous, dessus) reste
  // dans le volume d'eau, hors du tunnel ; sinon tout le mosasaure est décalé pour l'y remettre.
  const R = { bout: 0, vitre: 0, haut: 0, tunnel: 0 };
  const mL = 0.35; // marge (m) en plus du rayon de chaque os
  // près des vitres des bouts, un échantillon ne fait pas la même longueur au latéral l (virage) :
  // longueur réelle d'un mètre de piste à chaque bout, par mètre de latéral (de −Wm à +Wp)
  const echBout = [i0, i1].map((s) => {
    const t = [], pA = new THREE.Vector3(), pB = new THREE.Vector3();
    for (let l = -Wm; l <= Wp; l++) t.push(point(s + 1, l, 0, pA).distanceTo(point(s - 1, l, 0, pB)) / (2 * pas));
    return t;
  });
  const ech = (t, l) => t[THREE.MathUtils.clamp(Math.round(l + Wm), 0, Wm + Wp)];
  const pCorps = [], qCorps = new THREE.Vector3(), qRef = new THREE.Vector3(), deplace = new THREE.Vector3();
  /** Ramène le point P (os de rayons r) dans l'eau : renvoie l'indice de piste proche ; q = point corrigé. */
  function dansLeau(P, r, indice, q) {
    const L = local(P, indice);
    let s = L.s, l = L.l, y = P.y;
    const m = r[0] + mL;
    s = THREE.MathUtils.clamp(s, i0 + m / pas / ech(echBout[0], l), i1 - m / pas / ech(echBout[1], l)); if (s !== L.s) R.bout++;
    l = THREE.MathUtils.clamp(l, -Wm + m, Wp - m); if (l !== L.l) R.vitre++;
    y = THREE.MathUtils.clamp(y, r[1] + mL, EAU - r[2] - mL); if (y !== P.y) R.haut++;
    // hors de la voûte gonflée du rayon de l'os
    const ea = a + m, eh = h + r[1] + mL, e = (l / ea) ** 2 + (y / eh) ** 2;
    if (e < 1) { R.tunnel++;
      const f = 1 / Math.sqrt(Math.max(e, 1e-6));
      l *= f;
      y *= f;
    }
    if (s === L.s && l === L.l && y === P.y) q.copy(P);
    // (déplacement mesuré dans le repère de la piste : la petite différence entre localiser et
    // point() à grand latéral, dans le virage, s'annule)
    else point(s, l, y, q).sub(point(L.s, L.l, P.y, qRef)).add(P);
    return L.indice;
  }
  function contraindre() {
    const n = moso.corps(pCorps); // os du corps (repère du monde) et leurs rayons
    if (!n) return false;
    for (let k = 0; k < n; k++) pCorps[k].p.y += D; // repère du bassin
    let corrige = false;
    M.filet.set(0, 0, 0);
    for (let it = 0; it < 4; it++) {
      deplace.set(0, 0, 0);
      let indice = M.indice;
      for (let k = 0; k < n; k++) {
        indice = dansLeau(pCorps[k].p, pCorps[k].r, indice, qCorps);
        qCorps.sub(pCorps[k].p);
        if (qCorps.lengthSq() > deplace.lengthSq()) deplace.copy(qCorps);
      }
      if (deplace.lengthSq() < 1e-8) break;
      corrige = true;
      for (let k = 0; k < n; k++) pCorps[k].p.add(deplace);
      moso.objet.position.add(deplace);
      M.filet.add(deplace);
      M.decal.add(deplace);
    }
    return corrige;
  }

  /** Distance (m, en avant sur le chemin) du mosasaure au passage c. */
  const jusqua = (c) => (((c.p - M.p) % PERIM) + PERIM) % PERIM;
  // passages visés de préférence : ceux du milieu et du fond (celui de l'entrée est en partie
  // caché par la façade quand le kart est encore dans la tranchée)
  const ORDRE = [...TRAVERSEES].sort((x, y) => (x.s < 25) - (y.s < 25) || x.s - y.s);
  const journal = []; // (essais) passages faits : écart devant la caméra au moment du passage

  function nagerMosasaure(dt, sCam, vCam) {
    if (sCam === null || sCam > i1) { M.faites.clear(); M.cible = M.derniere = null; }
    let vDes = 9; // croisière : un géant de 57 m avance vite (en m/s) même tranquille
    const sCamM = sCam === null ? null : (sCam - i0) * pas;
    if (sCamM !== null) {
      const temps = (c) => (c.s - AVANCE - sCamM) / Math.max(6, vCam); // dans combien de temps le kart sera à AVANCE m du passage
      // Le kart arrive : passer en travers de la route quand il sera à AVANCE m du passage. On
      // garde la cible tant qu'elle reste jouable (la vitesse se recale à chaque image), puis on
      // vise le passage suivant devant le kart s'il y en a un qu'on peut encore rejoindre.
      if (M.cible) {
        const tK = temps(M.cible);
        if (tK < 0.2) { M.faites.add(M.cible); M.derniere = M.cible; M.cible = null; }
        else {
          const v = jusqua(M.cible) / tK;
          if (v > 34) M.cible = null; // (le kart a beaucoup accéléré : on en cherche une autre)
          else vDes = Math.max(1, v); // (il peut presque s'arrêter pour attendre le kart)
        }
      }
      if (!M.cible)
        for (const c of ORDRE) {
          if (M.faites.has(c)) continue;
          const tK = temps(c);
          if (tK < 0.6) continue;
          const v = jusqua(c) / tK;
          if (v >= 1 && v <= 28) { M.cible = c; vDes = v; break; }
        }
    }
    // (grosse inertie : il change de vitesse en ~1 s)
    M.v += (vDes - M.v) * Math.min(1, dt * 1.6);
    const pAvant = M.p;
    M.p = (M.p + M.v * dt) % PERIM;
    if (import.meta.env.DEV && sCamM !== null)
      for (const c of TRAVERSEES)
        if ((((c.p - pAvant) % PERIM) + PERIM) % PERIM <= M.v * dt) journal.push({ s: +c.s.toFixed(1), devant: +(c.s - sCamM).toFixed(1), vise: c === M.cible || c === M.derniere, t: +t.toFixed(1) });
    // gueule : grande ouverte en passant devant le kart, quelques bâillements sinon
    let dApex = 99;
    for (const c of [M.cible, M.derniere]) if (c) dApex = Math.min(dApex, Math.abs(((M.p - c.p + PERIM * 1.5) % PERIM) - PERIM / 2));
    const traverse = sCamM !== null && dApex < 30 && sCamM < LONG;
    moso.ouverture = traverse ? 0.75 : 0.08 + 0.12 * Math.max(0, Math.sin(t * 0.5) * Math.sin(t * 0.17)) ** 2;
    // position : la racine du cou sur le chemin, le corps orienté selon le chemin à cet endroit
    chemin(M.p, c0);
    dirAvant.copy(M.dir);
    M.pos.set(c0.x, Y_HAUT + ONDULE * Math.sin((4 * Math.PI * M.p) / PERIM), c0.z);
    M.dir.set(c0.tx, 0, c0.tz);
    M.indice = local(M.pos, M.indice).indice;
    // un peu penché vers l'intérieur des virages (vitesse de rotation autour de la verticale)
    const omega = dt > 0 && dirAvant.lengthSq() > 0 ? (dirAvant.z * M.dir.x - dirAvant.x * M.dir.z) / dt : 0;
    M.roulis += (THREE.MathUtils.clamp(-omega * M.v * 0.03, -0.04, 0.04) - M.roulis) * Math.min(1, dt * 1.5);
    const obj = moso.objet;
    obj.position.copy(M.pos);
    aq.updateWorldMatrix(true, false);
    obj.lookAt(v3.copy(M.pos).add(M.dir).applyMatrix4(aq.matrixWorld)); // (lookAt vise un point du monde)
    obj.rotateZ(M.roulis);
    // la racine du cou (et non le milieu du modèle) est posée sur le chemin
    obj.position.sub(decale.set(moso.racine.x, 0, moso.racine.z).applyQuaternion(obj.quaternion));
    // décalage du filet de sécurité : il revient doucement à zéro (pas de saut quand il lâche)
    M.decal.multiplyScalar(Math.max(0, 1 - dt * 0.7));
    obj.position.add(M.decal);
    moso.nager(dt, M.v, cap);
    if (contraindre()) M.corrige++;
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
      if (C.s > i0 - 170 / pas && C.s < i1 + 10 / pas && C.l < Wp + 20 && C.l > -Wm - 20) sCam = C.s;
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
      const y = b.cote ? 4 + 2.5 * Math.sin(ph * 1.3) : h + 2.8 + 0.6 * Math.sin(ph * 2); // (sous le ventre du mosasaure)
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

  const retour = { update, objet: aq, mosasaure: moso, nage: M, R, traversees: TRAVERSEES, journal, chemin: CH, eau: { Wp, Wm, H, EAU, a, h, D, i0, i1, sA, sB, Y_HAUT, AVANCE } };
  if (import.meta.env.DEV) {
    window.__aquarium = retour; // (nage, chemin, eau : pour les essais)
  }
  return retour;
}

// ---------------------------------------------------------------------------
// Mosasaure : creerMosasaure() renvoie { objet, ouverture, racine, nager(dt, vitesse, cap), corps(liste) }
// avec la tête vers +z (57 m de long, échelle comprise) : l'aquarium le déplace, l'oriente et lui
// donne le chemin à suivre (cap), sa colonne vertébrale se plie pour le suivre.
//
// Vrai modèle : public/aquarium/mosasaure.glb, d'après « Mosasaurus » d'Alexey Zaika
// (https://sketchfab.com/3d-models/mosasaurus-684754a2ad8c46aca0634326b53d1f04, CC-BY 4.0),
// préparé par outils/blender/preparer_mosasaure.sh (≈5 600 triangles, un cycle de nage « Nager »
// qui boucle, mâchoire = os Bone.026). En attendant le chargement (ou s'il échoue), c'est le
// mosasaure en formes simples ci-dessous qui nage.
const LONGUEUR_MOSASAURE = 57; // m (×3 : un vrai monstre vu du tunnel)
// Points du filet de sécurité (aquarium : contraindre) : [os, latéral, dessous, dessus] = rayons
// autour de l'os (en m sur le modèle de 19 m), mesurés sur les sommets du modèle animé (nage, gueule
// ouverte) autour de la colonne, avec un peu de marge ; le latéral sert dans toutes les directions
// horizontales. 87 = bout de la mâchoire (il bouge avec elle), 45 = crâne, 25…23 = cou, 1/3/4 =
// nageoires avant, 5…12 = dos (7…9 : nageoires arrière), 14…17 et 19…22 = les deux lobes de la queue
// (fins : petit rayon) ; [os, …, parent, d] = point prolongé de d au-delà de l'os (bouts des lobes).
const POINTS_CORPS = [
  [87, 0.9, 0.6, 0.6], [45, 0.9, 1.0, 0.6], [25, 1.0, 1.5, 1.0], [24, 1.1, 1.5, 1.0], [23, 1.2, 1.5, 1.0],
  [1, 3.4, 2.7, 1.1], [3, 3.4, 2.7, 1.1], [4, 3.0, 1.9, 1.1], [5, 1.1, 1.3, 1.0], [6, 1.0, 1.1, 0.9],
  [7, 2.3, 2.0, 0.9], [8, 2.4, 2.1, 0.8], [9, 2.4, 2.1, 0.7], [10, 0.6, 0.7, 0.6], [11, 0.45, 0.7, 0.6], [12, 0.45, 0.7, 0.6],
  [14, 0.45, 0.6, 0.6], [15, 0.45, 0.6, 0.6], [16, 0.5, 0.6, 0.5], [17, 0.5, 0.6, 0.45], [17, 0.4, 0.4, 0.2, 16, 1.0],
  [19, 0.45, 0.6, 0.6], [20, 0.45, 0.6, 0.6], [21, 0.5, 0.6, 0.6], [22, 0.5, 0.5, 0.6], [22, 0.4, 0.3, 0.4, 21, 1.0],
];
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
  const ECH = LONGUEUR_MOSASAURE / 19;
  let colonne = null, osCorps = null; // (voir plus bas, une fois le modèle chargé)
  const vProlonge = new THREE.Vector3(), qObj = new THREE.Quaternion(), qP = new THREE.Quaternion(), axe = new THREE.Vector3(0, 1, 0);

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
      // Colonne vertébrale, mesurée dans le repère du mosasaure (pivot pas encore accroché : son
      // repère du monde est celui de objet). La racine du cou (os 2) est le point posé sur le chemin ;
      // chaque os de la colonne est tourné (autour de la verticale) pour que le segment qu'il porte
      // suive la direction du chemin à son milieu : tête 1 → 23 → 24, queue 2 → 3 … 12 → lobes 13 et 18.
      pivot.updateMatrixWorld(true);
      const os = {};
      scene.traverse((o) => {
        const m = o.isBone && /^Bone\.?(\d{3})_/.exec(o.name);
        if (m) os[+m[1]] = o;
      });
      const p = (n) => os[n].getWorldPosition(new THREE.Vector3());
      if ([1, 2, 12, 13, 18, 23, 24].every((n) => os[n])) {
        const z = (n) => p(n).z;
        const entree = (n, zMil, parent) => ({ os: os[n], zMil, parent, cum: 0, q: new THREE.Quaternion(), qInv: new THREE.Quaternion() });
        colonne = [];
        const e1 = entree(1, (z(1) + z(23)) / 2, null), e23 = entree(23, (z(23) + z(24)) / 2, e1);
        colonne.push(e1, e23, entree(24, z(24) + 1.4 * ECH, e23));
        let parent = null;
        for (let n = 2; n <= 12; n++) {
          if (!os[n]) break;
          const e = entree(n, (z(n) + z(n === 12 ? 13 : n + 1)) / 2, parent);
          colonne.push(e);
          parent = e;
        }
        colonne.push(entree(13, z(13) - 0.8 * ECH, parent), entree(18, z(18) - 0.8 * ECH, parent));
        const r = p(2);
        moso.racine = { x: r.x, z: r.z };
      }
      osCorps = POINTS_CORPS.filter(([n, , , , m]) => os[n] && (!m || os[m])).map(([n, lat, bas, haut, m, d]) => ({ os: os[n], r: [lat, bas, haut].map((x) => x * ECH), parent: m ? os[m] : null, d: (d ?? 0) * ECH }));
      objet.remove(provisoire.objet);
      objet.add(pivot);
    })
    .catch((e) => console.warn("Mosasaure GLB indisponible, on garde le provisoire :", e));

  const pointsProvisoire = Array.from({ length: 11 }, (_, k) => (0.5 - k / 10) * LONGUEUR_MOSASAURE * 0.92);
  const moso = {
    objet,
    ouverture: 0.12,
    racine: { x: 0, z: LONGUEUR_MOSASAURE * 0.29 }, // racine du cou (repère du mosasaure), posée sur le chemin
    /**
     * Avance le cycle de nage (fréquence de la queue selon la vitesse en m/s) et plie la colonne
     * vertébrale le long du chemin : cap(d) = angle (rad, autour de la verticale) de la direction du
     * chemin à d mètres de la racine du cou (d < 0 : derrière), par rapport à celle de la racine.
     */
    nager(dt, vitesse = 9, cap = null) {
      if (!mixer) {
        provisoire.ouverture = moso.ouverture;
        provisoire.nager(dt, vitesse / ECH);
        return;
      }
      // on défait la pliure de l'image précédente (le mixer n'écrit pas les pistes qui ne bougent pas)
      if (colonne) for (const e of colonne) e.os.quaternion.premultiply(e.qInv);
      // un géant bat lentement de la queue : cycle de 1,33 s à vitesse 1 → ~4 s à 9 m/s, ~2,3 s à 25 m/s
      mixer.update((dt * (0.9 + vitesse * 0.075)) / 4.71);
      if (colonne && cap) {
        // rotation autour de la verticale du mosasaure, exprimée dans le repère du parent de chaque os
        // (l'axe ne change pas quand les os d'avant ont déjà été tournés autour de cette même verticale)
        objet.getWorldQuaternion(qObj).invert();
        for (const e of colonne) {
          e.cum = cap(e.zMil - moso.racine.z);
          e.os.parent.getWorldQuaternion(qP).premultiply(qObj).invert();
          e.q.setFromAxisAngle(axe.set(0, 1, 0).applyQuaternion(qP).normalize(), e.cum - (e.parent ? e.parent.cum : 0));
          e.qInv.copy(e.q).invert();
          e.os.quaternion.premultiply(e.q);
        }
      }
      // ouverture lissée (s'ouvre en ~0,5 s, se referme un peu plus vite), toujours depuis la pose de repos
      ouv += (moso.ouverture - ouv) * Math.min(1, dt * (moso.ouverture > ouv ? 4 : 6));
      if (machoire) machoire.quaternion.copy(reposMachoire).multiply(qOuv.setFromAxisAngle(AXE_MACHOIRE, ouv * SENS_MACHOIRE));
    },
    /** Os du corps dans le repère du monde, avec leurs rayons : liste[k] = { p, r } ; renvoie leur nombre. */
    corps(liste) {
      objet.updateMatrixWorld(true);
      const n = osCorps ? osCorps.length : pointsProvisoire.length;
      for (let k = 0; k < n; k++) {
        const e = (liste[k] ??= { p: new THREE.Vector3(), r: null });
        if (osCorps) {
          const o = osCorps[k];
          e.p.setFromMatrixPosition(o.os.matrixWorld);
          if (o.parent) e.p.addScaledVector(vProlonge.setFromMatrixPosition(o.parent.matrixWorld).sub(e.p).normalize(), -o.d);
          e.r = o.r;
        } else {
          e.p.set(0, 0, pointsProvisoire[k]).applyMatrix4(objet.matrixWorld);
          e.r = [3 * ECH, 2.2 * ECH, 1.6 * ECH];
        }
      }
      return n;
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
  objet.scale.setScalar(1.3 * (LONGUEUR_MOSASAURE / 19)); // même longueur que le vrai modèle

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
