import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

// Vrais dinosaures animés.
//  - modèles réalistes texturés (Sketchfab, CC-BY 4.0, voir public/CREDITS.txt) :
//    Velociraptor et Triceratops (outils/blender/preparer_raptor_trice.sh), T-rex, Stégosaure,
//    Parasaurolophus et sauropode du troupeau (outils/blender/preparer_dinos3.sh) ;
//  - en cas d'échec de chargement, on retombe sur le pack gratuit CC0 de Quaternius (couleurs unies).
// hauteur : taille voulue en mètres (le kart fait ~2,5 m de long).
export const DINOS = {
  Trex: { hauteur: 7 },
  Apatosaurus: { hauteur: 9 },
  Stegosaurus: { hauteur: 4.2 },
  Triceratops: { hauteur: 3.6 },
  Parasaurolophus: { hauteur: 4.8 },
  Velociraptor: { hauteur: 2.2 },
};

// Modèles texturés (ils regardent vers +Z comme les Quaternius) : fichier, force de la normal map,
// os racine dont la marche avance (on la remet sur place pour qu'ils ne dérivent pas).
// Les animations y portent directement les noms du jeu : Idle, Walk, Run, Attack, Eat.
// alias : animation absente du modèle → [animation jouée à la place, vitesse].
// hauteur : remplace celle de DINOS (proportions différentes du modèle Quaternius).
// mesure : instant de « Idle » où l'on mesure la hauteur (le sauropode broute au début, cou baissé).
// loin : version allégée pour les troupeaux éloignés (creerDino(nom, { detail: "loin" })), ou montrée
// à la place de la détaillée quand le dinosaure s'éloigne (detail: "auto", même squelette).
// Triangles par dinosaure : T-rex 5 968 (loin 2 028), Stégosaure 5 949 (1 982),
// Parasaurolophus 3 933 (1 515), sauropode 6 908 (2 301), Velociraptor 2 712, Triceratops 2 211.
const TEXTURES = {
  Velociraptor: { fichier: "velociraptor-pbr.glb", relief: 1 },
  Triceratops: { fichier: "triceratops-lp.glb", relief: 0.25, racine: "Root001_01" },
  // « Randaling T- Rex, animated! » (quander) : Idle, Run, Attack (rugit), Eat (tête au sol, fabriqué) ;
  // marche = course ralentie
  Trex: { fichier: "trex-realiste.glb", loin: "trex-realiste-loin.glb", relief: 1, alias: { Walk: ["Run", 0.55] } },
  // « PBR Stegasaurus (Animated) » (Ferocious Industries) : Idle, Walk, Run, Attack (rugit), Eat
  Stegosaurus: { fichier: "stego-realiste.glb", loin: "stego-realiste-loin.glb", relief: 1 },
  // « Parasaurolophus » (ichigo15) : Idle (à quatre pattes), Attack (se dresse), Eat (broute, fabriqué) ; pas de marche
  Parasaurolophus: { fichier: "para-realiste.glb", loin: "para-realiste-loin.glb", relief: 0.8, hauteur: 3.6, alias: { Walk: ["Idle", 1], Run: ["Idle", 1] } },
  // « Brachiosaurus_AR card » (Zinaida.Kovrova) : Idle (broute, lève le cou, regarde autour), Eat (broute) ; pas de marche
  Apatosaurus: { fichier: "sauropode-troupeau.glb", loin: "sauropode-troupeau-loin.glb", relief: 0.8, hauteur: 8, mesure: 7, alias: { Attack: ["Idle", 1], Walk: ["Idle", 1], Run: ["Idle", 1] } },
};

// Marche « sur place » : sur l'os racine, la composante de position qui varie le plus
// (l'avancée) est figée à sa valeur moyenne ; le petit balancement vertical reste.
function surPlace(clip, racine) {
  const piste = clip.tracks.find((t) => t.name === racine + ".position");
  if (!piste) return;
  const v = piste.values, n = v.length / 3;
  let axe = 0, ecartMax = -1;
  for (let c = 0; c < 3; c++) {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n; i++) { min = Math.min(min, v[i * 3 + c]); max = Math.max(max, v[i * 3 + c]); }
    if (max - min > ecartMax) { ecartMax = max - min; axe = c; }
  }
  let somme = 0;
  for (let i = 0; i < n; i++) somme += v[i * 3 + axe];
  for (let i = 0; i < n; i++) v[i * 3 + axe] = somme / n;
}

const chargeur = new GLTFLoader();
const modeles = new Map();
const url = (f) => `${import.meta.env.BASE_URL}dinos/${f}`;

// Sphère englobante de chaque maillage animé, valable pour toutes ses animations : réunion des sphères
// de quelques poses de chaque clip, un peu agrandie. Elle sert à écarter les dinosaures hors champ
// (creerDino(nom, { troupeau: true }) ; ailleurs, frustumCulled reste à false).
function enveloppes(scene, clips) {
  const mailles = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) mailles.push(o); });
  if (!mailles.length) return;
  // pose actuelle, remise à la fin (les clips laissent les os où ils les ont mis)
  const poses = [];
  scene.traverse((o) => poses.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  const mixer = new THREE.AnimationMixer(scene), s = new THREE.Sphere();
  const union = new Map(mailles.map((o) => [o, new THREE.Sphere()]));
  for (const clip of clips) {
    const action = mixer.clipAction(clip).play();
    for (let k = 0; k < 6; k++) {
      mixer.setTime((k / 6) * clip.duration);
      scene.updateMatrixWorld(true);
      for (const o of mailles) {
        o.skeleton.update();
        o.computeBoundingSphere();
        const u = union.get(o);
        if (u.isEmpty()) u.copy(o.boundingSphere); else u.union(s.copy(o.boundingSphere));
      }
    }
    action.stop();
  }
  for (const o of mailles) { o.boundingSphere = union.get(o); o.boundingSphere.radius *= 1.15; }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  for (const [o, p, q, e] of poses) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(e); }
}

function preparer(gltf, texture) {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const ancien = o.material;
    if (texture) {
      // texture de couleur + relief, sans reflets métalliques
      o.material = new THREE.MeshPhongMaterial({
        map: ancien.map, normalMap: ancien.normalMap, shininess: 12, specular: 0x1a1a1a, side: ancien.side,
        flatShading: !o.geometry.attributes.normal, // triceratops « low poly » : facettes, sans normales stockées
      });
      if (ancien.normalMap) o.material.normalScale.setScalar(texture.relief);
    } else {
      // matériaux simples et lisses, comme le reste du jeu
      o.material = new THREE.MeshPhongMaterial({ color: ancien.color, shininess: 30, specular: 0x222222 });
    }
    ancien.dispose();
    o.frustumCulled = false; // les squelettes animés sortent parfois de leur boîte
  });
  const scene = new THREE.Group();
  scene.add(gltf.scene);
  if (texture) {
    if (texture.racine) for (const clip of gltf.animations) if (clip.name === "Walk" || clip.name === "Run") surPlace(clip, texture.racine);
    // mesuré dans la pose « Idle » (la pose de repos de ces modèles n'est pas debout sur le sol)
    const idle = gltf.animations.find((a) => a.name === "Idle");
    if (idle) new THREE.AnimationMixer(gltf.scene).clipAction(idle).play().getMixer().setTime(texture.mesure ?? 0);
  }
  enveloppes(scene, gltf.animations);
  scene.updateMatrixWorld(true);
  scene.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); } });
  const boite = new THREE.Box3().setFromObject(scene);
  return { scene, animations: gltf.animations, hauteur: boite.max.y - boite.min.y, sol: boite.min.y, texture };
}

function charger(nom) {
  if (!modeles.has(nom)) {
    const quaternius = () => chargeur.loadAsync(url(`${nom}.glb`)).then((g) => preparer(g, null));
    const texture = TEXTURES[nom];
    modeles.set(nom, texture
      ? chargeur.loadAsync(url(texture.fichier)).then((g) => preparer(g, texture)).catch((e) => {
        console.warn(`dino ${nom} : modèle texturé indisponible, version simple`, e);
        return quaternius();
      })
      : quaternius());
  }
  return modeles.get(nom);
}

// Version « loin » (troupeaux éloignés) : ~3 fois moins de triangles, Idle / Eat / Walk seulement
// (les autres animations retombent sur Idle), sans normal map. Sinon, la version normale.
function chargerLoin(nom) {
  const texture = TEXTURES[nom];
  if (!texture?.loin) return charger(nom);
  const cle = nom + "-loin";
  if (!modeles.has(cle)) {
    modeles.set(cle, chargeur.loadAsync(url(texture.loin)).then((g) => preparer(g, texture)).catch((e) => {
      console.warn(`dino ${nom} : version « loin » indisponible`, e);
      return charger(nom);
    }));
  }
  return modeles.get(cle);
}

// Doubles allégés (detail: "auto") : les maillages de la version « loin » rattachés au squelette du
// clone détaillé (même squelette, mêmes os et même pose de liaison : voir outils/blender/preparer_dinos3.sh).
// Un seul mixer, un seul calcul des os ; on montre l'un ou l'autre selon la distance.
function doubler(objet, loin) {
  const allegees = new Map();
  loin.traverse((o) => { if (o.isSkinnedMesh) allegees.set(o.name, o); });
  const proches = [];
  objet.traverse((o) => { if (o.isSkinnedMesh && allegees.has(o.name)) proches.push(o); });
  const doubles = proches.map((o) => {
    const L = allegees.get(o.name);
    const d = new THREE.SkinnedMesh(L.geometry, L.material);
    d.name = o.name + "-loin";
    d.position.copy(o.position);
    d.quaternion.copy(o.quaternion);
    d.scale.copy(o.scale);
    d.bindMode = o.bindMode;
    d.bind(o.skeleton, o.bindMatrix);
    d.boundingSphere = L.boundingSphere?.clone() ?? null;
    d.frustumCulled = o.frustumCulled;
    d.visible = false;
    o.parent.add(d);
    return d;
  });
  return { proches, doubles };
}

// Mise à jour des animations des troupeaux (troupeau: true) : une image sur 2, 3 ou 4 selon la
// distance (le temps écoulé est cumulé), une sur 8 hors champ. De près, à chaque image.
const CADENCE = [[120, 1], [220, 2], [350, 3], [Infinity, 4]];
const HORS_CHAMP = 8;
let nDinos = 0;
const _frustum = new THREE.Frustum(), _m4 = new THREE.Matrix4(), _sphere = new THREE.Sphere(), _centre = new THREE.Vector3();

/**
 * Crée un dinosaure animé (asynchrone).
 * options : { hauteur, animation: "Idle" | "Walk" | "Attack" | "Eat" | ..., vitesse, detail, troupeau }
 *  - detail: "loin" : version allégée seulement (~3 fois moins de triangles) ;
 *  - detail: "auto" : version détaillée de près, allégée au-delà de `seuil` m (par défaut 10 × la hauteur) ;
 *    sans changement de squelette ni d'animation (le mixer anime les deux) ;
 *  - troupeau: true : écarté hors champ (sphère englobante de toutes ses animations), animation moins
 *    souvent au loin (CADENCE), os recalculés seulement quand la pose ou la place a changé.
 *    Le mixer doit alors être avancé par animer(dt, camera), pas directement.
 * Renvoie { objet, mixer, clips, animer(dt, camera), choisirDetail(camera) } : animer (ou mixer.update
 * hors troupeau) doit être appelé à chaque image ; choisirDetail suffit si l'on avance le mixer soi-même.
 */
export async function creerDino(nom, options = {}) {
  const auto = options.detail === "auto";
  const [m, mLoin] = await Promise.all([options.detail === "loin" ? chargerLoin(nom) : charger(nom), auto ? chargerLoin(nom) : null]);
  const objet = SkeletonUtils.clone(m.scene);
  const hauteur = options.hauteur ?? m.texture?.hauteur ?? DINOS[nom].hauteur;
  const echelle = hauteur / m.hauteur;
  const racine = new THREE.Group();
  objet.scale.setScalar(echelle);
  objet.position.y = -m.sol * echelle;
  racine.add(objet);
  const mixer = new THREE.AnimationMixer(objet);
  let anim = options.animation ?? "Idle", vitesse = 1;
  // Quaternius : « Armature|Triceratops_Idle » ; modèles texturés : « Idle »
  const trouver = (n) => m.animations.find((a) => a.name === n || a.name.endsWith("_" + n));
  const alias = m.texture?.alias?.[anim];
  if (!trouver(anim) && alias) [anim, vitesse] = alias;
  const clip = trouver(anim) ?? trouver("Idle") ?? m.animations[0];
  const action = mixer.clipAction(clip);
  action.timeScale = (options.vitesse ?? 1) * vitesse;
  action.play();
  mixer.setTime(Math.random() * clip.duration); // pas tous synchronisés

  // niveau de détail (detail: "auto"), avec un peu d'hystérésis pour ne pas clignoter à la limite
  const niveaux = auto && mLoin && mLoin !== m ? doubler(objet, mLoin.scene) : null;
  const seuil = options.seuil ?? 10 * hauteur;
  let allege = false;
  const position = () => _centre.setFromMatrixPosition(racine.matrixWorld);
  function choisirDetail(camera) {
    if (!niveaux || !camera) return;
    const d = position().distanceTo(camera.position);
    if (allege === d < seuil * (allege ? 0.95 : 1.05)) {
      allege = !allege;
      for (const o of niveaux.proches) o.visible = !allege;
      for (const o of niveaux.doubles) o.visible = allege;
    }
  }

  if (!options.troupeau) return { objet: racine, mixer, clips: m.animations, choisirDetail, animer: (dt, camera) => { choisirDetail(camera); mixer.update(dt); } };

  // --- troupeau : hors champ, cadence d'animation, os ---
  const os = new Set();
  objet.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    if (o.boundingSphere) o.frustumCulled = true;
    os.add(o.skeleton);
  });
  // os recalculés (au rendu) seulement si la pose a changé ou si le dinosaure a bougé (marcheurs)
  let pose = 0;
  for (const sq of os) {
    let vuePose = -1;
    const vu = new THREE.Matrix4();
    sq.update = function () {
      if (vuePose === pose && vu.equals(racine.matrixWorld)) return;
      vuePose = pose;
      vu.copy(racine.matrixWorld);
      THREE.Skeleton.prototype.update.call(this);
    };
  }
  // sphère du dinosaure entier (repère de la racine), pour le test hors champ
  const enveloppe = new THREE.Box3().setFromObject(racine).getBoundingSphere(new THREE.Sphere());
  enveloppe.radius *= 1.3;
  let cumul = 0, attente = nDinos++ % 4; // décalés : pas tous mis à jour à la même image
  function animer(dt, camera) {
    cumul += dt;
    let pas = 1;
    if (camera) {
      choisirDetail(camera);
      const d = position().distanceTo(camera.position);
      pas = CADENCE.find(([dMax]) => d < dMax)[1];
      _frustum.setFromProjectionMatrix(_m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      if (!_frustum.intersectsSphere(_sphere.copy(enveloppe).applyMatrix4(racine.matrixWorld))) pas = HORS_CHAMP;
    }
    if (++attente < pas) return;
    attente = 0;
    mixer.update(cumul);
    cumul = 0;
    pose++;
  }
  return { objet: racine, mixer, clips: m.animations, choisirDetail, animer };
}
