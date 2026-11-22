import * as THREE from "three";

// Sprites 2D des personnages (générés par scripts/decoupe_sprites.py)
const urls = import.meta.glob("../assets/personnages/*.png", { eager: true, query: "?url", import: "default" });
const chargeur = new THREE.TextureLoader();
const cache = new Map();

export const PERSONNAGES = ["viggo", "harry", "maman", "bryan", "mamy"];

export function urlSprite(nom, cote) {
  return urls[`../assets/personnages/${nom}_${cote}.png`];
}

function materiau(nom, cote) {
  const cle = `${nom}_${cote}`;
  if (!cache.has(cle)) {
    const t = chargeur.load(urlSprite(nom, cote));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    // alphaTest : pas de tri de transparence, rapide sur tablette
    cache.set(cle, new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.5 }));
  }
  return cache.get(cle);
}

const TAILLE = 2.2;
const geo = new THREE.PlaneGeometry(TAILLE, TAILLE).translate(0, TAILLE / 2, 0);
const v = new THREE.Vector3();

/**
 * Pilote en "billboard" : un panneau qui tourne autour de l'axe vertical pour
 * toujours faire face à la caméra, avec la vue de face ou de dos selon l'angle.
 */
export function creerPilote(nom) {
  const face = materiau(nom, "face");
  const dos = materiau(nom, "dos");
  const mesh = new THREE.Mesh(geo, dos);
  mesh.position.y = -0.4; // le bas du sprite (jambes coupées) s'enfonce dans le siège

  return {
    mesh,
    /** yawParent : rotation Y totale du parent (kart + dérapage) ; yawKart : direction du kart. */
    orienter(camera, yawParent, yawKart) {
      mesh.getWorldPosition(v);
      const versCamera = Math.atan2(camera.position.x - v.x, camera.position.z - v.z);
      mesh.rotation.y = versCamera - yawParent;
      mesh.material = Math.cos(versCamera - yawKart) > 0 ? face : dos;
    },
  };
}
