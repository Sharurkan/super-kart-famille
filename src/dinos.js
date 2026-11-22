import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

// Vrais dinosaures animés (pack gratuit CC0 de Quaternius, convertis en GLB).
// hauteur : taille voulue en mètres (le kart fait ~2,5 m de long).
export const DINOS = {
  Trex: { hauteur: 7 },
  Apatosaurus: { hauteur: 9 },
  Stegosaurus: { hauteur: 4.2 },
  Triceratops: { hauteur: 3.6 },
  Parasaurolophus: { hauteur: 4.8 },
  Velociraptor: { hauteur: 2.2 },
};

const chargeur = new GLTFLoader();
const modeles = new Map();

function charger(nom) {
  if (!modeles.has(nom)) {
    modeles.set(nom, chargeur.loadAsync(`${import.meta.env.BASE_URL}dinos/${nom}.glb`).then((gltf) => {
      // matériaux simples et lisses, comme le reste du jeu
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const ancien = o.material;
        o.material = new THREE.MeshPhongMaterial({ color: ancien.color, shininess: 30, specular: 0x222222 });
        o.frustumCulled = false; // les squelettes animés sortent parfois de leur boîte
      });
      const boite = new THREE.Box3().setFromObject(gltf.scene);
      return { scene: gltf.scene, animations: gltf.animations, hauteur: boite.max.y - boite.min.y, sol: boite.min.y };
    }));
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
  const clip = m.animations.find((a) => a.name.endsWith("_" + anim)) ?? m.animations[0];
  const action = mixer.clipAction(clip);
  action.timeScale = options.vitesse ?? 1;
  action.play();
  mixer.setTime(Math.random() * clip.duration); // pas tous synchronisés
  return { objet: racine, mixer, clips: m.animations };
}
