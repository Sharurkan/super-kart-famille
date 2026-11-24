import * as THREE from "three";

// Sprites 2D des personnages (générés par scripts/decoupe_sprites.py) :
// - <nom>_face.png : dessin d'origine, pour les têtes (classement, mini-carte) ;
// - <nom>_face_volant.png / <nom>_dos_volant.png : le même dessin avec un volant 3D rendu dans
//   Blender (outils/blender/volant_pilotes.py) dans les mains, pour le pilote assis dans son kart
//   et les portraits des menus. Les <nom>_dos.png d'origine ne servent qu'à refaire ces images
//   (après scripts/decoupe_sprites.py, relancer outils/blender/volant_pilotes.py).
const urls = import.meta.glob(["../assets/personnages/*_face.png", "../assets/personnages/*_volant.png"], {
  eager: true,
  query: "?url",
  import: "default",
});
const chargeur = new THREE.TextureLoader();
const cache = new Map();

export const PERSONNAGES = ["viggo", "harry", "maman", "bryan", "mamy"];

/** cote : "face" (dessin d'origine), "face_volant" ou "dos_volant". */
export function urlSprite(nom, cote) {
  return urls[`../assets/personnages/${nom}_${cote}.png`];
}

function materiau(nom, cote) {
  const cle = `${nom}_${cote}`;
  if (!cache.has(cle)) {
    const t = chargeur.load(urlSprite(nom, cote));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    // alphaTest + alphaToCoverage : bords lisses grâce à l'anti-crénelage, sans tri coûteux
    cache.set(cle, new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.5, alphaToCoverage: true }));
  }
  return cache.get(cle);
}

// Taille du panneau : sur le dessin, la ceinture est à 13 % du bas, les épaules à 42 % et le
// haut du casque tout en haut. À 1.6 m, posé 0.15 m sous le creux du siège, la ceinture est au
// niveau du baquet, les épaules à hauteur du volant et le casque dépasse bien du dossier,
// comme un enfant dans un vrai kart (avant : 2.2 m, il dominait tout le kart).
const TAILLE = 1.6;
const geo = new THREE.PlaneGeometry(TAILLE, TAILLE).translate(0, TAILLE / 2, 0);
const v = new THREE.Vector3();

/**
 * Pilote en "billboard" : un panneau qui tourne autour de l'axe vertical pour
 * toujours faire face à la caméra, avec la vue de face ou de dos selon l'angle.
 */
export function creerPilote(nom) {
  // le volant 3D du kart est caché (karts.js) : c'est celui du dessin, toujours dans les mains
  const face = materiau(nom, "face_volant");
  const dos = materiau(nom, "dos_volant");
  const mesh = new THREE.Mesh(geo, dos);
  mesh.position.y = -0.15; // le bas du sprite (jambes coupées) s'enfonce dans le siège

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
