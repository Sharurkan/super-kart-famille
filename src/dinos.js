import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

// Vrais dinosaures animés.
//  - pack gratuit CC0 de Quaternius (convertis en GLB), couleurs unies ;
//  - Velociraptor et Triceratops plus réalistes, texturés (Sketchfab, CC-BY 4.0, voir les crédits
//    du projet), préparés avec outils/blender/preparer_raptor_trice.sh. En cas d'échec de
//    chargement, on retombe sur la version Quaternius.
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
const TEXTURES = {
  Velociraptor: { fichier: "velociraptor-pbr.glb", relief: 1 },
  Triceratops: { fichier: "triceratops-lp.glb", relief: 0.25, racine: "Root001_01" },
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
    if (idle) new THREE.AnimationMixer(gltf.scene).clipAction(idle).play().getMixer().setTime(0);
  }
  scene.updateMatrixWorld(true);
  scene.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); } });
  const boite = new THREE.Box3().setFromObject(scene);
  return { scene, animations: gltf.animations, hauteur: boite.max.y - boite.min.y, sol: boite.min.y };
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

/**
 * Crée un dinosaure animé (asynchrone).
 * options : { hauteur, animation: "Idle" | "Walk" | "Attack" | ..., vitesse }
 * Renvoie { objet, mixer } ; le mixer doit être mis à jour à chaque image.
 */
export async function creerDino(nom, options = {}) {
  const m = await charger(nom);
  const objet = SkeletonUtils.clone(m.scene);
  const echelle = (options.hauteur ?? DINOS[nom].hauteur) / m.hauteur;
  const racine = new THREE.Group();
  objet.scale.setScalar(echelle);
  objet.position.y = -m.sol * echelle;
  racine.add(objet);
  const mixer = new THREE.AnimationMixer(objet);
  const anim = options.animation ?? "Idle";
  // Quaternius : « Armature|Triceratops_Idle » ; modèles texturés : « Idle »
  const clip = m.animations.find((a) => a.name === anim || a.name.endsWith("_" + anim)) ?? m.animations[0];
  const action = mixer.clipAction(clip);
  action.timeScale = options.vitesse ?? 1;
  action.play();
  mixer.setTime(Math.random() * clip.duration); // pas tous synchronisés
  return { objet: racine, mixer, clips: m.animations };
}
