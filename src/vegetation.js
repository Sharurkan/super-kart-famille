import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Végétation en vrais modèles 3D : Stylized Nature MegaKit de Quaternius (CC0), rassemblés et
// allégés avec Blender dans public/nature/jurassique.glb, et modèles réalistes dans
// public/nature/realiste.glb (rochers scannés et fougère de Poly Haven, CC0 ; cycas "Sago Palm"
// de Valykor, CC-BY 4.0) préparés par outils/blender/pack_realiste.py.
// Chaque modèle est dessiné en InstancedMesh : un seul appel de dessin par pièce,
// même avec des centaines de fougères.

// Hauteur voulue (mètres) pour chaque modèle du fichier
export const TAILLES = {
  Fern_1: 2.6,
  Plant_1: 1.6,
  Plant_1_Big: 4.5,
  Plant_7: 1.8,
  Plant_7_Big: 5.5,
  CommonTree_1: 15,
  CommonTree_2: 13,
  CommonTree_3: 12,
  Pine_1: 17,
  Pine_2: 15,
  DeadTree_1: 10,
  Bush_Common: 2.4,
  Rock_Medium_1: 2.6,
  Rock_Medium_2: 2.2,
  Rock_Medium_3: 3,
  Grass_Common_Tall: 1.3,
  Grass_Wispy_Tall: 1.4,
  // arbres lointains (très simplifiés)
  Pine_5: 16,
  CommonTree_5: 12,
  // petits détails au bord de la route
  Mushroom_Common: 1.8, // champignons géants (le modèle est une petite touffe)
  Flower_3_Group: 2.4,
  Flower_4_Group: 2.4,
  Clover_1: 0.6,
  Clover_2: 0.65,
  Pebble_Round_1: 0.22,
  Pebble_Round_2: 0.22,
  Pebble_Round_3: 0.22,
  Pebble_Round_4: 0.22,
  Pebble_Round_5: 0.22,
  Pebble_Square_1: 0.28,
  Pebble_Square_2: 0.28,
  Pebble_Square_3: 0.28,
  RockPath_Square_Small_2: 0.22,
  RockPath_Round_Small_1: 0.18,
  // modèles réalistes (public/nature/realiste.glb, voir outils/blender/pack_realiste.py)
  Fougere: 1.05, // fougère basse et large (fern_02, Poly Haven)
  Cycas: 3.2, // cycas (Sago Palm de Valykor)
  Gros_Rocher: 3.4, // grand rocher moussu (rock_moss_set_01)
  Rocher_Mousse_A: 2.2,
  Rocher_Mousse_B: 1.6,
  Rocher_Mousse_C: 1.8,
  Rocher_07: 1.8,
  Caillou_A: 0.3,
  Caillou_B: 0.26,
};

// Anciens noms -> modèles réalistes. Les rochers Quaternius sont aussi posés par le T-rex, le
// diplodocus et le ravin (sans garde de la route) : leur remplaçant garde exactement la même
// place au sol ("place" = rayon au sol de l'ancien rocher, en mètres, mesuré sur le modèle).
const REMPLACEMENTS = {
  Rock_Medium_1: { nom: "Rocher_Mousse_A", place: 0.66 * 2.6 },
  Rock_Medium_2: { nom: "Rocher_Mousse_C", place: 0.78 * 2.2 },
  Rock_Medium_3: { nom: "Rocher_07", place: 0.75 * 3 },
  Pebble_Round_1: { nom: "Caillou_A" },
  Pebble_Round_2: { nom: "Caillou_B" },
  Pebble_Round_3: { nom: "Caillou_A" },
  Pebble_Round_4: { nom: "Caillou_B" },
  Pebble_Round_5: { nom: "Caillou_A" },
  Pebble_Square_1: { nom: "Caillou_B" },
  Pebble_Square_2: { nom: "Caillou_A" },
  Pebble_Square_3: { nom: "Caillou_B" },
};

// Filtres (comme en CSS) appliqués aux textures de certains modèles Quaternius :
//  - feuilles violettes tournées vers le vert (Plant_1 a déjà des feuilles vertes : la tourner les rendait violettes) ;
//  - plantes et arbres aux couleurs de dessin animé un peu moins saturés, pour aller avec les
//    plantes et rochers réalistes (sans texture : la couleur du matériau est désaturée pareil).
const VIOLET_EN_VERT = "hue-rotate(-150deg) saturate(0.9)";
const DOUX = "saturate(0.78) brightness(0.96)", TRES_DOUX = "saturate(0.68) brightness(0.92)";
const FILTRES = {
  Plant_7: VIOLET_EN_VERT, Plant_7_Big: VIOLET_EN_VERT,
  Fern_1: TRES_DOUX, Plant_1: TRES_DOUX, Plant_1_Big: TRES_DOUX, Grass_Common_Tall: DOUX,
  CommonTree_1: DOUX, CommonTree_2: DOUX, CommonTree_3: DOUX, Pine_1: DOUX, Pine_2: DOUX, Pine_5: DOUX, CommonTree_5: DOUX,
};
const texturesTeintees = new Map();

/** Même effet qu'un filtre "saturate(s) brightness(b)" sur une couleur unie. */
function adoucir(couleur, filtre) {
  if (/hue-rotate/.test(filtre)) return;
  const s = +(filtre.match(/saturate\(([\d.]+)\)/)?.[1] ?? 1), b = +(filtre.match(/brightness\(([\d.]+)\)/)?.[1] ?? 1);
  const hsl = couleur.getHSL({});
  couleur.setHSL(hsl.h, hsl.s * s, hsl.l * b);
}

function teinter(texture, filtre) {
  const cle = texture.uuid + filtre;
  if (!texturesTeintees.has(cle)) {
    const img = texture.image;
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.filter = filtre;
    g.drawImage(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = texture.colorSpace;
    t.flipY = texture.flipY;
    t.wrapS = texture.wrapS;
    t.wrapT = texture.wrapT;
    texturesTeintees.set(cle, t);
  }
  return texturesTeintees.get(cle);
}

// Les deux fichiers de modèles : pack Quaternius (stylisé) et pack réaliste (scans, cycas, fougère)
const FICHIERS = ["nature/jurassique.glb", "nature/realiste.glb"];
let chargement = null;

/** Charge les fichiers une fois ; renvoie { nom: [{ geometrie, materiau }] } normalisés (hauteur 1, posés au sol). */
function chargerModeles() {
  if (!chargement) {
    const chargeur = new GLTFLoader();
    chargement = Promise.all(FICHIERS.map((f) => chargeur.loadAsync(import.meta.env.BASE_URL + f))).then((gltfs) => {
      const modeles = {};
      const racines = gltfs.flatMap((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        return gltf.scene.children;
      });
      for (const racine of racines) {
        const pieces = [];
        // Blender ajoute parfois ".001", que le chargeur transforme en "001" : on le retire
        const nomPropre = racine.name.replace(/\.?\d{3}$/, "");
        const boite = new THREE.Box3().setFromObject(racine);
        const h = Math.max(0.001, boite.max.y - boite.min.y);
        const centre = boite.getCenter(new THREE.Vector3());
        const inv = new THREE.Matrix4().copy(racine.matrixWorld).invert();
        racine.traverse((o) => {
          if (!o.isMesh) return;
          // géométrie dans le repère du modèle, ramenée à une hauteur de 1, posée au sol et centrée
          const g = o.geometry.clone();
          g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
          const local = new THREE.Vector3().copy(centre).applyMatrix4(inv);
          const minLocal = new THREE.Vector3().copy(boite.min).applyMatrix4(inv);
          g.translate(-local.x, -minLocal.y, -local.z);
          g.scale(1 / h, 1 / h, 1 / h);
          const ancien = o.material;
          const feuilles = ancien.alphaTest > 0 || ancien.transparent || ancien.alphaMap;
          const map = ancien.map && FILTRES[nomPropre] ? teinter(ancien.map, FILTRES[nomPropre]) : ancien.map;
          const m = new THREE.MeshLambertMaterial({
            map: map ?? null,
            color: ancien.color,
            alphaTest: feuilles ? Math.max(0.4, ancien.alphaTest || 0.5) : 0,
            side: feuilles ? THREE.DoubleSide : THREE.FrontSide,
            // relief des modèles réalistes (scans) ; les modèles Quaternius n'en ont pas
            normalMap: ancien.normalMap ?? null,
          });
          if (m.normalMap) m.normalScale.copy(ancien.normalScale);
          if (m.map) m.map.anisotropy = 4;
          if (!ancien.map && FILTRES[nomPropre]) adoucir(m.color, FILTRES[nomPropre]);
          pieces.push({ geometrie: g, materiau: m });
        });
        // rayon au sol (pour une hauteur de 1) : 85 % des sommets sont plus près de l'axe
        // (le bout des feuilles très fines ne compte pas)
        const d = [];
        for (const { geometrie } of pieces) {
          const p = geometrie.attributes.position;
          for (let k = 0; k < p.count; k++) d.push(Math.hypot(p.getX(k), p.getZ(k)));
        }
        d.sort((a, b) => a - b);
        pieces.rayon = d.length ? d[Math.floor(d.length * 0.85)] : 0.3;
        modeles[nomPropre] = pieces;
      }
      return modeles;
    });
  }
  return chargement;
}

/**
 * Plante un modèle à plusieurs endroits (asynchrone).
 * liste : [{ x, z, s (échelle autour de 1), r (rotation), sy (aplatissement, facultatif), y (enfoncement, facultatif) }]
 * garde (facultatif) : voir gardeRoute ; chaque plante y est vérifiée avec sa vraie taille
 * (connue seulement une fois le modèle chargé), puis gardée, déplacée ou retirée.
 */
export function planter(groupe, nom, liste, garde = null) {
  if (!liste.length) return;
  chargerModeles().then((modeles) => {
    // ancien nom remplacé par un modèle réaliste (même place au sol pour les rochers)
    const remplace = REMPLACEMENTS[nom];
    if (remplace) nom = remplace.nom;
    const pieces = modeles[nom];
    if (!pieces) return console.warn("modèle de végétation introuvable :", nom);
    const h = remplace?.place ? remplace.place / pieces.rayon : TAILLES[nom] ?? 3;
    if (garde) {
      liste = liste.flatMap((p) => {
        const e = h * (p.s ?? 1);
        const ok = garde.verifier(p.x, p.z, pieces.rayon * e, e * (p.sy ?? 1), nom);
        return ok ? [{ ...p, x: ok.x, z: ok.z }] : [];
      });
      if (!liste.length) return;
    }
    const o = new THREE.Object3D();
    for (const { geometrie, materiau } of pieces) {
      const im = new THREE.InstancedMesh(geometrie, materiau, liste.length);
      im.name = nom;
      liste.forEach((p, i) => {
        const e = h * (p.s ?? 1);
        o.position.set(p.x, p.y ?? 0, p.z);
        o.rotation.set(0, p.r ?? 0, 0);
        o.scale.set(e, e * (p.sy ?? 1), e);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      groupe.add(im);
    }
  });
}

// ---------------------------------------------------------------------------
// Garde de la route : aucune plante (ou rocher, nid, dinosaure) ne doit déborder sur la
// route ni cacher la route à la caméra du kart. Les règles ne sont appliquées qu'au
// chargement des modèles : à ce moment le looping, le ravin, le diplodocus et la tête de
// T-rex ont tous été posés sur la piste.
const CAM_RECUL = 7.2, CAM_HAUT = 3.1; // comme CameraPoursuite

/**
 * gardeRoute(piste).verifier(x, z, rayon, hauteur, nom) -> { x, z } (éventuellement
 * repoussé loin de la route) ou null (retiré). gardeRoute(piste).bilan : compte par modèle.
 */
export function gardeRoute(piste) {
  const { N, pas, cx, cz, nx, nz, tx, tz, demi, marge } = piste;
  const bordure = demi + 1.4; // fin des bordures rouges et blanches
  const barriere = demi + marge + 0.8; // derrière les boudins
  const bilan = {};
  const dans = (i, debut, fin) => ((i - debut + N) % N) <= ((fin - debut + N) % N);
  const ecart = (i, j) => { const d = (i - j + N) % N; return d > N / 2 ? d - N : d; };

  /** Raison du refus à cet endroit, ou "" si la place est bonne. */
  function probleme(x, z, r, h) {
    const { indice: i, lateral, long } = piste.localiser(x, z);
    const lat = Math.abs(lateral);
    const plat = h <= 0.4, bas = h <= 1.0;
    // 1. la route et ses bordures (plus une marge), les plantes hautes derrière les barrières
    if (lat - r < bordure + (plat ? 0 : bas ? 0.3 : 1.2)) return "route";
    if (!bas && lat < barriere) return "route";
    // dans les entonnoirs, même les petites plantes restent derrière les rochers et les plots
    const lim = piste.limiteLaterale(i);
    if (lim < demi + marge - 1.5 && lat < barriere && lat - r < lim + 2.6) return "entonnoir";
    const L = piste.looping;
    if (L && dans(i, (L.prise - 4 + N) % N, (L.rendu + 4) % N) && lat - r < barriere) return "looping";
    // 2. le dos du diplodocus et la tête du T-rex (mesurés sur les modèles placés : ±15 m et ±22 m)
    const D = piste.diplodocus;
    if (D && dans(i, (D.indice - 3 + N) % N, (D.fin + 3) % N) && lat - r < 16.5) return "diplodocus";
    const T = piste.teteTrex;
    if (T && Math.abs(ecart(i, T.indice)) <= Math.round(18 / pas) && lat - r < 23.5) return "trex";
    // 3. le ravin : rien qui pende au-dessus du vide (rectangle aux bouts arrondis, bords bruités)
    const V = piste.ravin;
    if (V) {
      const W = ((V.fin - V.debut + N) % N) * pas, R = W / 2, B = 40;
      const s = ecart(i, V.debut) * pas + long, l = lateral;
      const m = r + 1.5;
      if (Math.abs(l) <= B) {
        if (s > -4.5 - m && s < W + 4.5 + m) return "ravin";
      } else if (Math.hypot(s - R, Math.abs(l) - B) < R + 1.5 + m) return "ravin";
    }
    // 4. la vue de la caméra : un trait de la caméra (derrière le kart) jusqu'à la route
    //    devant ne doit pas traverser la plante (virages serrés surtout)
    if (h > 1.2 && lat < 45 && cacheLaRoute(i, x, z, Math.max(0.5, r * 0.6), h)) return "vue";
    return "";
  }

  function cacheLaRoute(i0, x, z, r, h) {
    const n0 = Math.round(45 / pas), n1 = Math.round(8 / pas);
    for (let dj = -n0; dj <= n1; dj += 2) {
      const j = (i0 + dj + N) % N, jr = (j - 6 + N) % N; // la caméra suit avec un peu de retard
      for (const lk of [-7, 0, 7]) {
        const ax = cx[j] + nx[j] * lk - tx[jr] * CAM_RECUL, az = cz[j] + nz[j] * lk - tz[jr] * CAM_RECUL;
        for (let m = 0; m <= 40; m += 6) {
          const k = (j + Math.round(m / pas)) % N;
          const bx = cx[k] + nx[k] * lk, bz = cz[k] + nz[k] * lk, by = m === 0 ? 1.1 : 0.6;
          const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          if (Math.hypot(ax + dx * t - x, az + dz * t - z) < r && CAM_HAUT + (by - CAM_HAUT) * t < h) return true;
        }
      }
    }
    return false;
  }

  function verifier(x, z, r, h, nom = "?") {
    const b = (bilan[nom] ??= { plantes: 0, deplacees: 0, retirees: 0, raisons: {} });
    b.plantes++;
    let raison = probleme(x, z, r, h);
    if (!raison) return { x, z };
    b.raisons[raison] = (b.raisons[raison] ?? 0) + 1;
    // on essaie de la repousser loin de la route (la forêt garde sa densité)
    const { indice: i, lateral } = piste.localiser(x, z);
    const cote = Math.sign(lateral) || 1;
    for (let d = 4; d <= 24; d += 4) {
      const nxp = x + nx[i] * cote * d, nzp = z + nz[i] * cote * d;
      if (!probleme(nxp, nzp, r, h)) {
        b.deplacees++;
        return { x: nxp, z: nzp };
      }
    }
    b.retirees++;
    return null;
  }

  const garde = { verifier, bilan };
  if (import.meta.env.DEV) window.__auditVegetation = bilan;
  return garde;
}
