import * as THREE from "three";

// Dessins des personnages (scripts/decoupe_sprites.py, puis outils/blender/volant_pilotes.py) :
// - <nom>_face.png : dessin d'origine, pour les têtes (classement, mini-carte) ;
// - <nom>_face_assis.webp / <nom>_dos_assis.webp : le pilote assis, poings ramenés pile sur
//   l'anneau du volant 3D du kart (karts.js) ;
// - <nom>_mains.webp : les poings seuls, posés devant le volant 3D quand on voit le pilote de face ;
// - <nom>_face_volant.webp : portrait des menus, avec le même volant rendu dans Blender.
// Les <nom>_dos.png d'origine ne servent qu'à refaire ces images.
const urls = import.meta.glob(["../assets/personnages/*_face.png", "../assets/personnages/*.webp"], {
  eager: true,
  query: "?url",
  import: "default",
});
const chargeur = new THREE.TextureLoader();
const cache = new Map();

export const PERSONNAGES = ["viggo", "harry", "maman", "bryan", "mamy"];

/** cote : "face" (dessin d'origine), "face_volant" (portrait au volant), "face_assis", "dos_assis", "mains". */
export function urlSprite(nom, cote) {
  const base = `../assets/personnages/${nom}_${cote}`;
  return urls[base + ".png"] ?? urls[base + ".webp"];
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

// Panneau de 1,6 m posé 0,15 m sous le creux du siège : ceinture au niveau du baquet, casque qui
// dépasse du dossier. Sur les dessins « assis », les poings sont à (168, 372) et (344, 372) sur
// 512 px, soit ±0,275 m du milieu et 0,2875 m au-dessus du siège : c'est là que karts.js pose
// les côtés de l'anneau du volant (rayon 0,275 m), 0,19 m devant le panneau.
const TAILLE = 1.6;
const BAS = -0.15;
export const POSITION_POINGS = { y: BAS + (TAILLE * (512 - 372)) / 512, z: 0.19 };
const geo = new THREE.PlaneGeometry(TAILLE, TAILLE).translate(0, TAILLE / 2, 0);
// Le panneau suit l'axe du kart : il ne se tourne vers la caméra que d'une fraction de l'angle
// (30 %) pour rester lisible de profil, sans paraître assis de travers ni lâcher le volant.
const SUIVI = 0.3;
// Les poings (calque « mains ») sont dessinés juste devant l'anneau, en vue de face.
const AVANCE_MAINS = POSITION_POINGS.z + 0.08;
const v = new THREE.Vector3();
const enveloppe = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Pilote : un panneau dessiné assis dans le baquet, aligné sur le kart, avec la vue de face ou
 * de dos selon le côté d'où on le regarde.
 */
export function creerPilote(nom) {
  const face = materiau(nom, "face_assis");
  const dos = materiau(nom, "dos_assis");
  const mesh = new THREE.Mesh(geo, dos);
  mesh.position.y = BAS; // le bas du dessin (jambes coupées) s'enfonce dans le siège
  // Les poings, recopiés devant l'anneau du volant 3D : placés sur le rayon caméra -> poing pour
  // tomber exactement sur le dessin, mais plus près de la caméra que le volant.
  const mains = new THREE.Mesh(geo, materiau(nom, "mains"));
  mains.visible = false;
  mesh.add(mains);

  return {
    mesh,
    /** yawParent : rotation Y totale du parent (kart + dérapage). */
    orienter(camera, yawParent) {
      mesh.getWorldPosition(v);
      const versCamera = Math.atan2(camera.position.x - v.x, camera.position.z - v.z);
      const delta = enveloppe(versCamera - yawParent);
      const deFace = Math.cos(delta) > 0;
      const base = deFace ? 0 : Math.PI;
      mesh.rotation.y = base + enveloppe(delta - base) * SUIVI;
      mesh.material = deFace ? face : dos;

      mains.visible = false;
      if (!deFace || !camera.isCamera) return; // (fausse caméra des loopings : pas de calque)
      mesh.updateMatrixWorld();
      mesh.worldToLocal(v.copy(camera.position));
      if (v.z < AVANCE_MAINS * 1.5) return;
      // point du panneau q -> c + (q - c)·k : même image à l'écran, mais avancé de AVANCE_MAINS
      const k = 1 - AVANCE_MAINS / v.z;
      mains.position.copy(v).multiplyScalar(1 - k);
      mains.scale.setScalar(k);
      mains.visible = true;
    },
  };
}
