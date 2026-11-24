import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { brulable } from "./lave.js";

// Végétation en vrais modèles 3D : Stylized Nature MegaKit de Quaternius (CC0), rassemblés et
// allégés avec Blender dans public/nature/jurassique.glb, et modèles réalistes dans
// public/nature/realiste.glb (rochers scannés et fougère de Poly Haven, CC0 ; cycas "Sago Palm"
// de Valykor, CC-BY 4.0) préparés par outils/blender/pack_realiste.py.
// Chaque modèle est dessiné en InstancedMesh : un seul appel de dessin par pièce,
// même avec des centaines de fougères.
// Les arbres et le sous-bois de la jungle sont des « imposteurs » (photos d'arbres réalistes
// Poly Haven sous 8 angles) : voir planterImposteurs et planterJungle en bas du fichier.
// (jurassique.glb ne contient plus que les plantes Quaternius encore plantées : arbres, rochers et
// cailloux Quaternius retirés avec outils/blender/elaguer_glb.mjs ; les anciens noms de rochers et
// cailloux sont remplacés par les modèles réalistes, voir REMPLACEMENTS.)

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

/** Rayon réel au sol (m, à l'échelle 1) d'un rocher posé sans garde (entonnoirs, ravin), ou null. */
export function placeRocher(nom) {
  return REMPLACEMENTS[nom]?.place ?? null;
}

// Les rochers (même les cailloux et les pierres plates des sentiers) restent hors de portée des
// karts : on ne peut ni rouler dessus ni les traverser (aucun n'a de collision). La portée d'un
// kart = la limite latérale où il peut rouler (piste.limiteLaterale, plus étroite dans les
// entonnoirs) + sa demi-largeur et un peu de marge.
const ROCHER = /Rock|Rocher|Caillou|Pebble/;
export const MARGE_ROCHER = 1.3;
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
          brulable(m); // se calcine dans le monde en lave (lave.js)
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

/** Les modèles des deux fichiers ({ nom: [{ geometrie, materiau }] }, hauteur 1, posés au sol) ; ex. la météorite (rocher scanné). */
export const chargerModelesNature = () => chargerModeles();

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
 * gardeRoute(piste).verifier(x, z, rayon, hauteur, nom, deplacer = true) -> { x, z } (éventuellement
 * repoussé loin de la route) ou null (retiré). gardeRoute(piste).bilan : compte par modèle.
 * gardeRoute(piste).probleme(x, z, rayon, hauteur, rocher) -> raison du refus ou "" (sans rien compter).
 * Les rochers (nom Rock, Rocher, Caillou, Pebble) sont en plus tenus hors de portée des karts.
 */
export function gardeRoute(piste) {
  const { N, pas, cx, cz, nx, nz, tx, tz, demi, marge } = piste;
  const bordure = demi + 1.4; // fin des bordures rouges et blanches
  const barriere = demi + marge + 0.8; // derrière les boudins
  const bilan = {};
  const dans = (i, debut, fin) => ((i - debut + N) % N) <= ((fin - debut + N) % N);
  const ecart = (i, j) => { const d = (i - j + N) % N; return d > N / 2 ? d - N : d; };

  /** Raison du refus à cet endroit, ou "" si la place est bonne. */
  function probleme(x, z, r, h, rocher = false) {
    const { indice: i, lateral, long } = piste.localiser(x, z);
    const lat = Math.abs(lateral);
    const plat = h <= 0.4, bas = h <= 1.0;
    // 1. la route et ses bordures (plus une marge), les plantes hautes derrière les barrières
    if (lat - r < bordure + (plat ? 0 : bas ? 0.3 : 1.2)) return "route";
    if (!bas && lat < barriere) return "route";
    const lim = piste.limiteLaterale(i);
    // les rochers, même plats, jamais là où un kart peut rouler (l'herbe du bord compte)
    if (rocher && lat - r < lim + MARGE_ROCHER) return "voie";
    // dans les entonnoirs, même les petites plantes restent derrière les rochers et les plots
    if (lim < demi + marge - 1.5 && lat < barriere && lat - r < lim + 2.6) return "entonnoir";
    const L = piste.looping;
    if (L && dans(i, (L.prise - 4 + N) % N, (L.rendu + 4) % N) && lat - r < barriere) return "looping";
    // 2. le dos du diplodocus (mesuré sur le modèle placé : ±15 m)
    const D = piste.diplodocus;
    if (D && dans(i, (D.indice - 3 + N) % N, (D.fin + 3) % N) && lat - r < 16.5) return "diplodocus";
    // autres grands décors posés sur la route (ex. l'aquarium, le T-rex couché) : [{ debut, fin, demi }]
    // (demiPlus / demiMoins facultatifs : emprise différente de chaque côté, latéral > 0 / < 0)
    for (const Z of piste.zonesDecor ?? []) if (dans(i, Z.debut, Z.fin) && lat - r < ((lateral > 0 ? Z.demiPlus : Z.demiMoins) ?? Z.demi)) return "decor";
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

  function verifier(x, z, r, h, nom = "?", deplacer = true) {
    const b = (bilan[nom] ??= { plantes: 0, deplacees: 0, retirees: 0, raisons: {} });
    b.plantes++;
    const rocher = ROCHER.test(nom);
    let raison = probleme(x, z, r, h, rocher);
    if (!raison) return { x, z };
    b.raisons[raison] = (b.raisons[raison] ?? 0) + 1;
    // forêt dense : l'arbre est simplement retiré (pas de paquets d'arbres repoussés au bord)
    if (!deplacer) { b.retirees++; return null; }
    // on essaie de la repousser loin de la route (la forêt garde sa densité)
    const { indice: i, lateral } = piste.localiser(x, z);
    const cote = Math.sign(lateral) || 1;
    for (let d = 4; d <= 24; d += 4) {
      const nxp = x + nx[i] * cote * d, nzp = z + nz[i] * cote * d;
      if (!probleme(nxp, nzp, r, h, rocher)) {
        b.deplacees++;
        return { x: nxp, z: nzp };
      }
    }
    b.retirees++;
    return null;
  }

  const garde = { verifier, probleme, bilan };
  if (import.meta.env.DEV) window.__auditVegetation = bilan;
  return garde;
}

// ---------------------------------------------------------------------------
// Imposteurs : arbres et grandes plantes réalistes (Poly Haven, CC0) photographiés sous 8 angles
// par Blender (outils/blender/impostors_rendre.py), rangés dans un seul atlas
// (outils/blender/impostors_atlas.py -> public/nature/arbres.webp + arbres.json).
// Dans le jeu, chaque arbre n'est qu'un rectangle (2 triangles) qui se tourne vers la caméra
// autour de son axe vertical et montre la photo prise du côté d'où on le regarde (passage
// tramé vers la vue voisine). Toute la forêt = un seul InstancedMesh, un seul appel de dessin,
// sans transparence à trier (test alpha + alpha-to-coverage).
const VUES = 8;
// Couleur multipliée (teinte du soir, un peu moins de jaune sur les sapins et le petit arbre)
const TEINTES = {
  sapin_a: [0.74, 0.8, 0.66], sapin_b: [0.74, 0.8, 0.66], ile_a: [0.92, 0.94, 0.84], jacaranda: [1.0, 0.98, 0.9],
  petit_arbre: [0.66, 0.74, 0.56], pachira_c: [1.0, 1.0, 0.92], pachira_d: [1.0, 1.0, 0.92], calathea: [1.0, 1.0, 0.94], anthurium: [1.0, 1.0, 0.94],
};
let chargementImposteurs = null;

function chargerImposteurs() {
  chargementImposteurs ??= Promise.all([
    fetch(import.meta.env.BASE_URL + "nature/arbres.json").then((r) => r.json()),
    new THREE.TextureLoader().loadAsync(import.meta.env.BASE_URL + "nature/arbres.webp"),
  ]).then(([info, texture]) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const noms = Object.keys(info.sprites);
    const vues = [];
    for (const nom of noms) for (const v of info.sprites[nom].vues) vues.push(new THREE.Vector4(...v));
    const materiau = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, alphaToCoverage: true });
    materiau.onBeforeCompile = (sh) => {
      sh.uniforms.uVues = { value: vues };
      sh.uniforms.uTaille = { value: new THREE.Vector2(...info.taille) };
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>
          attribute float aSprite;
          uniform vec4 uVues[${vues.length}];
          varying vec2 vUv0;
          varying vec2 vUv1;
          varying float vMelange;`)
        .replace("#include <project_vertex>", `
          // pied de l'arbre, taille et rotation de l'instance
          vec4 centre = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec3 axeX = (modelMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
          float sx = length(axeX), sy = length((modelMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
          // le rectangle tourne autour de l'axe vertical pour faire face à la caméra
          vec2 versCam = cameraPosition.xz - centre.xz;
          versCam /= max(length(versCam), 1e-4);
          vec3 droite = vec3(versCam.y, 0.0, -versCam.x);
          vec4 mvPosition = viewMatrix * vec4(centre.xyz + droite * position.x * sx + vec3(0.0, position.y * sy, 0.0), 1.0);
          gl_Position = projectionMatrix * mvPosition;
          // photo prise du côté d'où on regarde l'arbre (rotation de l'instance comprise)
          float angle = atan(versCam.x, versCam.y) - atan(-axeX.z, axeX.x);
          float f = fract(angle / 6.2831853) * ${VUES}.0;
          float k0 = floor(f);
          vMelange = smoothstep(0.3, 0.7, f - k0);
          int base = int(aSprite + 0.5) * ${VUES};
          vec4 r0 = uVues[base + int(k0)];
          vec4 r1 = uVues[base + int(mod(k0 + 1.0, ${VUES}.0))];
          vUv0 = r0.xy + uv * r0.zw;
          vUv1 = r1.xy + uv * r1.zw;`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>
          uniform vec2 uTaille;
          varying vec2 vUv0;
          varying vec2 vUv1;
          varying float vMelange;`)
        .replace("#include <map_fragment>", `
          vec4 c0 = texture2D(map, vUv0), c1 = texture2D(map, vUv1);
          // passage tramé d'une vue à l'autre (pas de transparence partielle)
          float bruit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          vec4 sampledDiffuseColor = vMelange > bruit ? c1 : c0;
          // de loin (petites mipmaps) les feuilles fines disparaîtraient : on renforce l'alpha
          vec2 ddx = dFdx(vUv0 * uTaille), ddy = dFdy(vUv0 * uTaille);
          float lod = 0.5 * log2(max(max(dot(ddx, ddx), dot(ddy, ddy)), 1e-8));
          sampledDiffuseColor.a = min(1.0, sampledDiffuseColor.a * (1.0 + max(lod, 0.0) * 0.35));
          diffuseColor *= sampledDiffuseColor;`);
    };
    brulable(materiau); // les arbres se calcinent dans le monde en lave (lave.js)
    return { info, noms, materiau };
  });
  return chargementImposteurs;
}

/**
 * Plante des imposteurs (asynchrone, un seul InstancedMesh). Renvoie une promesse.
 * liste : [{ x, z, sprite (nom), h (hauteur en m), r (rotation), c (luminosité, facultatif) }]
 * garde (facultatif) : gardeRoute ; les arbres refusés sont retirés (pas déplacés).
 */
export function planterImposteurs(groupe, liste, garde = null) {
  return chargerImposteurs().then(({ info, noms, materiau }) => {
    if (garde) liste = liste.filter((p) => garde.verifier(p.x, p.z, info.sprites[p.sprite].rayon * p.h * 0.55, p.h, p.sprite, false));
    if (!liste.length) return null;
    const geo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const sprites = new Float32Array(liste.length);
    const im = new THREE.InstancedMesh(geo, materiau, liste.length);
    im.name = "Imposteurs";
    im.frustumCulled = false; // les rectangles tournent dans le shader : la boîte calculée serait fausse
    const o = new THREE.Object3D(), couleur = new THREE.Color();
    liste.forEach((p, i) => {
      const s = info.sprites[p.sprite];
      o.position.set(p.x, s.bas * p.h - 0.15, p.z);
      o.rotation.set(0, p.r ?? 0, 0);
      o.scale.set(s.largeur * p.h, s.hauteur * p.h, 1);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
      const t = TEINTES[p.sprite] ?? [1, 1, 1], c = p.c ?? 1;
      im.setColorAt(i, couleur.setRGB(t[0] * c, t[1] * c, t[2] * c, THREE.SRGBColorSpace));
      sprites[i] = noms.indexOf(p.sprite);
    });
    geo.setAttribute("aSprite", new THREE.InstancedBufferAttribute(sprites, 1));
    groupe.add(im);
    return im;
  });
}

// ---------------------------------------------------------------------------
// Jungle : une forêt très dense (mur d'arbres et de sous-bois le long des barrières), qui
// s'ouvre à quelques endroits sur de grandes plaines (on y voit les dinosaures et le volcan).
// [sprite, hauteur min, hauteur max, poids]
const SOUS_BOIS = [["anthurium", 1.6, 3.0, 3], ["calathea", 1.5, 2.8, 3], ["pachira_c", 2.0, 3.5, 2], ["pachira_d", 3.0, 5.5, 3]];
const ARBRES_PROCHES = [["ile_a", 9, 14, 6], ["petit_arbre", 7, 11, 3], ["pachira_d", 4.5, 7, 2], ["sapin_a", 17, 25, 3], ["sapin_b", 13, 19, 3], ["jacaranda", 13, 19, 1]];
const ARBRES_LOIN = [["sapin_a", 18, 26, 4], ["sapin_b", 14, 20, 3], ["ile_a", 11, 16, 4], ["jacaranda", 15, 22, 2]];
const ARBRES_PLAINE = [["jacaranda", 14, 21, 1], ["ile_a", 11, 15, 1]];

function auHasardPondere(rnd, liste) {
  let t = rnd() * liste.reduce((s, e) => s + e[3], 0);
  for (const e of liste) if ((t -= e[3]) <= 0) return e;
  return liste[liste.length - 1];
}

/**
 * Plante la jungle autour de la piste (asynchrone, renvoie une promesse).
 * plaines : [{ debut, fin (indices), cote (+1/-1 : signe du latéral), largeur (m) }]
 * exclusions : [{ x, z, r }] (pied du volcan, troupeaux...)
 * La garde de la route retire ce qui gêne (route, vue de la caméra, ravin, grands décors).
 */
export function planterJungle(groupe, piste, rnd, garde, { plaines = [], exclusions = [], trouee = null } = {}) {
  const { N, cx, cz, nx, nz } = piste;
  const barriere = piste.demi + piste.marge + 0.8;
  const ecart = (i, j) => { const d = (i - j + N) % N; return d > N / 2 ? d - N : d; };
  const RAMPE = 28; // échantillons de transition jungle -> plaine
  /** 0 = jungle, 1 = plaine ; lisiere : bande de forêt touffue au fond de la plaine */
  function ouverture(i, lat) {
    let o = 0, lisiere = false;
    for (const P of plaines) {
      if (Math.sign(lat) !== P.cote) continue;
      const long = (P.fin - P.debut + N) % N, d = ecart(i, P.debut);
      if (d < -RAMPE || d > long + RAMPE) continue;
      const t = Math.max(0, Math.min(1, Math.min(d + RAMPE, long + RAMPE - d) / RAMPE));
      const fond = Math.max(0, Math.min(1, (P.largeur - Math.abs(lat)) / 30));
      o = Math.max(o, t * t * (3 - 2 * t) * fond);
      if (t > 0.5 && Math.abs(lat) > P.largeur - 30 && Math.abs(lat) < P.largeur + 40) lisiere = true;
    }
    return { o, lisiere };
  }
  // repère local rapide : échantillon le plus proche (recherche grossière puis fine)
  function local(x, z) {
    let m = 0, dMin = Infinity;
    for (let i = 0; i < N; i += 6) { const d = (x - cx[i]) ** 2 + (z - cz[i]) ** 2; if (d < dMin) { dMin = d; m = i; } }
    for (let k = -6; k <= 6; k++) { const i = (m + k + N) % N; const d = (x - cx[i]) ** 2 + (z - cz[i]) ** 2; if (d < dMin) { dMin = d; m = i; } }
    return { i: m, lat: (x - cx[m]) * nx[m] + (z - cz[m]) * nz[m], d: Math.sqrt(dMin) };
  }
  const C = 3, R = piste.rayon + 290; // grille de 3 m sur toute la carte, un tirage par case
  const arbres = [];
  const ajouter = (x, z, e, d, sombre = 1) => arbres.push({ x, z, sprite: e[0], h: e[1] + rnd() * (e[2] - e[1]), r: rnd() * 6.283, c: (0.86 + rnd() * 0.16) * sombre, d });
  for (let gx = -R; gx < R; gx += C) {
    for (let gz = -R; gz < R; gz += C) {
      const x = piste.centre.x + gx + rnd() * C, z = piste.centre.z + gz + rnd() * C;
      const { i, lat, d } = local(x, z);
      if (d < barriere || d > 290) continue;
      if (exclusions.some((e) => (x - e.x) ** 2 + (z - e.z) ** 2 < e.r * e.r)) continue;
      if (trouee?.(x, z)) continue; // trouée : on y voit le volcan depuis la route
      const { o, lisiere } = ouverture(i, lat);
      // densités (arbres par m²) selon la distance à la route
      let dSous = (d < 30 ? 0.28 : d < 80 ? 0.05 : 0) * (1 - 0.92 * o);
      let dArbre = d < 35 ? 1 / 14 : d < 60 ? 1 / 22 : d < 90 ? 1 / 40 : d < 170 ? 1 / 95 : 1 / 220;
      let liste = d < 90 ? ARBRES_PROCHES : ARBRES_LOIN;
      // plaine : presque rien, quelques grands arbres isolés ; au fond, la lisière touffue
      dArbre = dArbre * (1 - o) + (lisiere ? 1 / 45 : 0) + o / 2500;
      if (o > 0.5) liste = ARBRES_PLAINE;
      // (plusieurs plantes par case quand c'est très touffu)
      for (let n = dSous * C * C; n > 0; n--) if (rnd() < n) ajouter(x + (rnd() - 0.5) * C, z + (rnd() - 0.5) * C, auHasardPondere(rnd, SOUS_BOIS), d);
      if (rnd() < dArbre * C * C) ajouter(x, z, auHasardPondere(rnd, liste), d, d > 170 ? 0.92 : 1);
    }
  }
  // du plus près de la route au plus loin : les arbres de devant cachent ceux de derrière
  // et le GPU ne colorie pas deux fois les mêmes pixels
  arbres.sort((a, b) => a.d - b.d);
  // pour le décor : ce point est-il dans la forêt dense (arbres de 10 à 25 m) ? (ex. la météorite
  // vérifie que les arbres ne cachent pas le volcan) ; rapide : quelques centaines d'opérations
  piste.dansJungle = (x, z) => {
    const { i, lat, d } = local(x, z);
    if (d < barriere || d > 290) return false;
    if (exclusions.some((e) => (x - e.x) ** 2 + (z - e.z) ** 2 < e.r * e.r)) return false;
    return ouverture(i, lat).o < 0.5;
  };
  return planterImposteurs(groupe, arbres, garde);
}
