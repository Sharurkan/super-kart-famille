import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Végétation en vrais modèles 3D (Stylized Nature MegaKit de Quaternius, CC0),
// rassemblés et allégés avec Blender dans public/nature/jurassique.glb.
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
};

// Certaines plantes du pack ont des feuilles violettes : on fait tourner leur teinte vers le vert (degrés)
const TEINTES = { Plant_1: -150, Plant_1_Big: -150, Plant_7: -150, Plant_7_Big: -150 };
const texturesTeintees = new Map();

function teinter(texture, degres) {
  const cle = texture.uuid + degres;
  if (!texturesTeintees.has(cle)) {
    const img = texture.image;
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.filter = `hue-rotate(${degres}deg) saturate(0.9)`;
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

let chargement = null;

/** Charge le fichier une fois ; renvoie { nom: [{ geometrie, materiau }] } normalisés (hauteur 1, posés au sol). */
function chargerModeles() {
  if (!chargement) {
    chargement = new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "nature/jurassique.glb").then((gltf) => {
      const modeles = {};
      gltf.scene.updateMatrixWorld(true);
      for (const racine of gltf.scene.children) {
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
          const map = ancien.map && TEINTES[nomPropre] ? teinter(ancien.map, TEINTES[nomPropre]) : ancien.map;
          const m = new THREE.MeshLambertMaterial({
            map: map ?? null,
            color: ancien.color,
            alphaTest: feuilles ? Math.max(0.4, ancien.alphaTest || 0.5) : 0,
            side: feuilles ? THREE.DoubleSide : THREE.FrontSide,
          });
          if (m.map) m.map.anisotropy = 4;
          pieces.push({ geometrie: g, materiau: m });
        });
        modeles[nomPropre] = pieces;
      }
      return modeles;
    });
  }
  return chargement;
}

/**
 * Plante un modèle à plusieurs endroits (asynchrone).
 * liste : [{ x, z, s (échelle autour de 1), r (rotation) }]
 */
export function planter(groupe, nom, liste) {
  if (!liste.length) return;
  chargerModeles().then((modeles) => {
    const pieces = modeles[nom];
    if (!pieces) return console.warn("modèle de végétation introuvable :", nom);
    const h = TAILLES[nom] ?? 3;
    const o = new THREE.Object3D();
    for (const { geometrie, materiau } of pieces) {
      const im = new THREE.InstancedMesh(geometrie, materiau, liste.length);
      liste.forEach((p, i) => {
        o.position.set(p.x, 0, p.z);
        o.rotation.set(0, p.r ?? 0, 0);
        o.scale.setScalar(h * (p.s ?? 1));
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      groupe.add(im);
    }
  });
}
