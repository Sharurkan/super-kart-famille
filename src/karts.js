import * as THREE from "three";
import { textureRond } from "./textures.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Tous les karts ont exactement les mêmes performances : seul le look change.
// Repère local : avant du kart = +Z, haut = +Y.

export const KARTS = ["classique", "fusee", "pompier", "licorne", "dino", "baignoire", "formule"];

/** Couleur principale de chaque kart (fonds des menus). */
export const COULEURS_KARTS = {
  classique: "#e8322f", fusee: "#5b8def", pompier: "#d62828",
  licorne: "#f783ac", dino: "#40c057", baignoire: "#74c0fc", formule: "#ff922b",
};

// ---------------------------------------------------------------------------
// Karts venant de vrais modèles 3D (fichiers .glb), ex. le pack gratuit Kenney.
// Les roues doivent être des nœuds dont le nom commence par "wheel" (fl/fr = avant).
export const MODELES_GLB = {
  formule: { url: "karts/kenney/vehicle-racer.glb", longueur: 2.9, siege: [0, 0.75, -0.25], tourner: Math.PI },
};
const chargeurGLB = new GLTFLoader();
export const gabarits = new Map();

function chargerGabarit(type) {
  if (!gabarits.has(type)) {
    const info = MODELES_GLB[type];
    gabarits.set(type, chargeurGLB.loadAsync(import.meta.env.BASE_URL + info.url).then((gltf) => {
      const modele = gltf.scene;
      // matériaux plus légers (même rendu que le reste du jeu)
      modele.traverse((o) => {
        if (o.isMesh) o.material = new THREE.MeshLambertMaterial({ map: o.material.map, color: o.material.color });
      });
      // mise à l'échelle : longueur voulue, posé au sol, centré
      modele.rotation.y = info.tourner;
      const boite = new THREE.Box3().setFromObject(modele);
      const taille = boite.getSize(new THREE.Vector3());
      const s = info.longueur / Math.max(taille.x, taille.z);
      const centre = boite.getCenter(new THREE.Vector3());
      const racine = new THREE.Group();
      modele.position.set(-centre.x, -boite.min.y, -centre.z);
      racine.add(modele);
      racine.scale.setScalar(s);
      return racine;
    }));
  }
  return gabarits.get(type);
}

function constructeurGLB(type) {
  return ({ corps, roues }) => {
    chargerGabarit(type).then((gabarit) => {
      const m = gabarit.clone(true);
      corps.add(m);
      m.updateMatrixWorld(true);
      m.traverse((o) => {
        if (!o.name.startsWith("wheel")) return;
        o.rotation.order = "YXZ"; // braquage puis rotation de la roue
        const r = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()).y / 2 || 0.3;
        const roue = { pivot: o, tourne: o, rayon: r };
        (/f[lr]$/.test(o.name) ? roues.avant : roues.arriere).push(roue);
      });
    });
    return { siege: MODELES_GLB[type].siege };
  };
}

const materiaux = new Map();
export function mat(couleur) {
  if (!materiaux.has(couleur)) materiaux.set(couleur, new THREE.MeshLambertMaterial({ color: couleur, flatShading: true }));
  return materiaux.get(couleur);
}

function boite(parent, l, h, p, couleur, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(l, h, p), mat(couleur));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function cylindre(parent, rHaut, rBas, h, seg, couleur, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rHaut, rBas, h, seg), mat(couleur));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

const geoPneu = new THREE.CylinderGeometry(1, 1, 1, 10).rotateZ(Math.PI / 2);
const geoJante = new THREE.CylinderGeometry(1, 1, 1, 8).rotateZ(Math.PI / 2);

/** Roue : pivot (braquage) > rotation (roule) > pneu + jante. */
function roue(parent, x, y, z, r, largeur, couleurJante) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const tourne = new THREE.Group();
  const pneu = new THREE.Mesh(geoPneu, mat(0x222222));
  pneu.scale.set(largeur, r, r);
  const jante = new THREE.Mesh(geoJante, mat(couleurJante));
  jante.scale.set(largeur + 0.04, r * 0.5, r * 0.5);
  tourne.add(pneu, jante);
  pivot.add(tourne);
  parent.add(pivot);
  return { pivot, tourne, rayon: r };
}

function sphere(parent, r, couleur, x, y, z, detail = 0) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat(couleur));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function cone(parent, r, h, seg, couleur, x, y, z) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(couleur));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** 4 roues standards. */
function quatreRoues(corps, roues, jante, rAv = 0.34, rAr = 0.4, xAv = 0.85, xAr = 0.9, zAv = 0.88, zAr = -0.85) {
  roues.avant.push(roue(corps, xAv, rAv, zAv, rAv, 0.3, jante), roue(corps, -xAv, rAv, zAv, rAv, 0.3, jante));
  roues.arriere.push(roue(corps, xAr, rAr, zAr, rAr, 0.38, jante), roue(corps, -xAr, rAr, zAr, rAr, 0.38, jante));
}

function volant(parent, x, y, z, couleur = 0x222222) {
  const g = new THREE.Group();
  const anneau = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 6, 12), mat(couleur));
  g.add(anneau);
  const colonne = cylindre(g, 0.04, 0.04, 0.45, 5, 0x555555, 0, 0, 0.22);
  colonne.rotation.x = Math.PI / 2;
  g.position.set(x, y, z);
  g.rotation.x = 0.6; // volant penché vers le pilote, colonne qui descend vers l'avant
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------------------
const CONSTRUCTEURS = {
  classique({ corps, roues }) {
    const rouge = 0xe8322f, blanc = 0xffffff, noir = 0x2b2b2b;
    boite(corps, 1.3, 0.14, 2.5, noir, 0, 0.26, 0); // châssis
    boite(corps, 1.05, 0.34, 1.5, rouge, 0, 0.47, 0.3); // carrosserie
    boite(corps, 1.25, 0.26, 0.55, rouge, 0, 0.4, 1.22); // nez
    boite(corps, 1.75, 0.2, 0.22, blanc, 0, 0.3, 1.55); // pare-chocs avant
    boite(corps, 0.9, 0.36, 0.32, rouge, 0, 0.78, 0.38); // tableau de bord (cache les jambes)
    for (const s of [1, -1]) boite(corps, 0.3, 0.3, 1.2, rouge, s * 0.72, 0.4, -0.1); // pontons
    boite(corps, 0.85, 0.14, 0.7, noir, 0, 0.6, -0.4); // assise
    boite(corps, 0.9, 0.62, 0.16, noir, 0, 0.88, -0.78); // dossier
    boite(corps, 0.8, 0.42, 0.42, 0x9aa0a6, 0, 0.6, -1.1); // moteur
    for (const s of [1, -1]) {
      const pot = cylindre(corps, 0.08, 0.1, 0.4, 6, 0x666666, s * 0.25, 0.55, -1.38);
      pot.rotation.x = Math.PI / 2;
    }
    boite(corps, 1.7, 0.07, 0.4, rouge, 0, 1.02, -1.22); // aileron
    for (const s of [1, -1]) boite(corps, 0.07, 0.3, 0.07, noir, s * 0.5, 0.85, -1.2);
    // pastille numéro
    const num = cylindre(corps, 0.2, 0.2, 0.03, 12, blanc, 0, 0.54, 1.2);
    num.rotation.x = 0.2;
    volant(corps, 0, 1.0, 0.18);
    quatreRoues(corps, roues, 0xffd34d);
    return { siege: [0, 0.55, -0.42] };
  },

  fusee({ corps, roues }) {
    const blanc = 0xf1f3f5, rouge = 0xe8322f, bleu = 0x3b6fd8, noir = 0x2b2b2b;
    boite(corps, 1.2, 0.14, 2.4, noir, 0, 0.26, 0);
    const fut = cylindre(corps, 0.52, 0.52, 2.2, 10, blanc, 0, 0.62, -0.05);
    fut.rotation.x = Math.PI / 2;
    const nez = cone(corps, 0.52, 0.9, 10, rouge, 0, 0.62, 1.5);
    nez.rotation.x = Math.PI / 2;
    const bague = cylindre(corps, 0.54, 0.54, 0.16, 10, bleu, 0, 0.62, 0.7);
    bague.rotation.x = Math.PI / 2;
    const hublot = cylindre(corps, 0.2, 0.2, 0.06, 10, 0x8fd3ff, 0, 1.05, 0.95);
    hublot.rotation.x = -0.5;
    // ailerons
    for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
      const ai = boite(corps, 0.08, 0.6, 0.6, rouge, Math.sin(a) * 0.65, 0.62 + Math.cos(a) * 0.65, -0.95);
      ai.rotation.z = -a;
    }
    // tuyère et flamme
    const tuyere = cylindre(corps, 0.3, 0.42, 0.3, 10, 0x777777, 0, 0.62, -1.3);
    tuyere.rotation.x = Math.PI / 2;
    const flamme = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.8, 8), new THREE.MeshBasicMaterial({ color: 0xffa94d }));
    flamme.position.set(0, 0.62, -1.8);
    flamme.rotation.x = -Math.PI / 2;
    corps.add(flamme);
    boite(corps, 0.8, 0.5, 0.15, noir, 0, 1.1, -0.72); // dossier
    volant(corps, 0, 1.18, 0.2);
    quatreRoues(corps, roues, bleu, 0.3, 0.36);
    return { siege: [0, 0.82, -0.42] };
  },

  pompier({ corps, roues }) {
    const rouge = 0xd62828, blanc = 0xffffff, jaune = 0xffd43b, noir = 0x2b2b2b, gris = 0xadb5bd;
    boite(corps, 1.4, 0.16, 2.6, noir, 0, 0.3, 0);
    boite(corps, 1.4, 0.5, 2.5, rouge, 0, 0.6, -0.05); // caisse
    boite(corps, 1.42, 0.1, 2.52, jaune, 0, 0.62, -0.05); // bande jaune
    boite(corps, 1.3, 0.35, 0.7, rouge, 0, 1.0, 0.85); // capot
    boite(corps, 1.1, 0.22, 0.05, 0x8fd3ff, 0, 1.05, 1.21); // pare-brise
    boite(corps, 1.6, 0.22, 0.2, gris, 0, 0.42, 1.32); // pare-chocs
    for (const s of [1, -1]) sphere(corps, 0.1, 0xfff3bf, s * 0.5, 0.65, 1.32); // phares
    // gyrophares
    boite(corps, 0.3, 0.15, 0.2, 0x339af0, -0.25, 1.25, 0.95);
    boite(corps, 0.3, 0.15, 0.2, 0xff4d4d, 0.25, 1.25, 0.95);
    // échelle
    for (const s of [1, -1]) boite(corps, 0.07, 0.07, 1.4, blanc, s * 0.3, 1.25, -0.75);
    for (let k = 0; k < 6; k++) boite(corps, 0.6, 0.05, 0.05, blanc, 0, 1.25, -0.15 - k * 0.24);
    for (const s of [1, -1]) boite(corps, 0.08, 0.4, 0.08, gris, s * 0.3, 1.02, -1.3);
    // enrouleur de tuyau
    const tuyau = cylindre(corps, 0.22, 0.22, 0.2, 10, jaune, 0.78, 0.65, -0.7);
    tuyau.rotation.z = Math.PI / 2;
    boite(corps, 0.85, 0.5, 0.15, noir, 0, 1.05, -0.65); // dossier
    volant(corps, 0, 1.25, 0.32);
    quatreRoues(corps, roues, blanc, 0.38, 0.42, 0.85, 0.85, 0.85, -0.85);
    return { siege: [0, 0.85, -0.3] };
  },

  licorne({ corps, roues }) {
    const blanc = 0xfff5fa, rose = 0xf783ac, violet = 0xb197fc, or = 0xffc933, noir = 0x2b2b2b;
    boite(corps, 1.2, 0.14, 2.4, 0xd0bfff, 0, 0.26, 0);
    boite(corps, 1.15, 0.5, 1.9, blanc, 0, 0.55, 0);
    sphere(corps, 0.6, blanc, 0, 0.6, -0.85, 1);
    // cou et tête
    const cou = boite(corps, 0.5, 0.8, 0.45, blanc, 0, 1.0, 1.0);
    cou.rotation.x = 0.35;
    const tete = boite(corps, 0.48, 0.42, 0.75, blanc, 0, 1.42, 1.32);
    tete.rotation.x = 0.25;
    boite(corps, 0.38, 0.3, 0.2, rose, 0, 1.3, 1.7); // museau
    for (const s of [1, -1]) {
      sphere(corps, 0.07, noir, s * 0.25, 1.5, 1.42); // yeux
      cone(corps, 0.07, 0.2, 4, blanc, s * 0.14, 1.72, 1.12); // oreilles
    }
    const corne = cone(corps, 0.07, 0.5, 6, or, 0, 1.8, 1.42);
    corne.rotation.x = 0.4;
    // crinière et queue arc-en-ciel
    const arc = [0xff6b6b, 0xffa94d, 0xffd43b, 0x69db7c, 0x74c0fc, violet];
    arc.forEach((c, k) => boite(corps, 0.14, 0.22, 0.2, c, 0, 1.55 - k * 0.12, 1.1 - k * 0.08));
    arc.forEach((c, k) => {
      const q = boite(corps, 0.16, 0.12, 0.35, c, 0, 0.95 - k * 0.1, -1.35 - k * 0.05);
      q.rotation.x = -0.5 + k * 0.15;
    });
    // ailes
    for (const s of [1, -1]) {
      const aile = boite(corps, 0.06, 0.4, 0.8, violet, s * 0.65, 0.95, -0.1);
      aile.rotation.z = s * 0.5;
    }
    boite(corps, 0.85, 0.55, 0.15, rose, 0, 0.95, -0.75); // dossier
    volant(corps, 0, 1.05, 0.35, rose);
    quatreRoues(corps, roues, violet);
    return { siege: [0, 0.75, -0.4] };
  },

  dino({ corps, roues }) {
    const vert = 0x40c057, fonce = 0x2b8a3e, orange = 0xff922b, blanc = 0xffffff, noir = 0x2b2b2b;
    boite(corps, 1.2, 0.14, 2.4, fonce, 0, 0.26, 0);
    boite(corps, 1.15, 0.5, 1.9, vert, 0, 0.55, -0.05);
    boite(corps, 0.9, 0.2, 1.6, 0xd8f5a2, 0, 0.36, 0); // ventre
    // long cou + tête qui dépasse devant, gueule ouverte
    const cou = boite(corps, 0.42, 0.7, 0.4, vert, 0, 1.05, 0.95);
    cou.rotation.x = 0.5;
    boite(corps, 0.55, 0.42, 0.6, vert, 0, 1.45, 1.3); // crâne
    boite(corps, 0.5, 0.22, 0.55, vert, 0, 1.35, 1.75); // museau
    boite(corps, 0.46, 0.12, 0.7, 0xff8787, 0, 1.18, 1.62); // langue / gueule
    boite(corps, 0.48, 0.12, 0.75, fonce, 0, 1.08, 1.6); // mâchoire
    for (const s of [1, -1]) {
      sphere(corps, 0.12, blanc, s * 0.24, 1.66, 1.25);
      sphere(corps, 0.065, noir, s * 0.26, 1.68, 1.35);
      sphere(corps, 0.035, noir, s * 0.1, 1.44, 2.03); // narines
      for (let k = 0; k < 3; k++) {
        const dent = cone(corps, 0.045, 0.12, 4, blanc, s * 0.18, 1.2, 1.9 - k * 0.15);
        dent.rotation.x = Math.PI;
      }
    }
    // taches
    for (const [x, z] of [[0.58, 0.4], [-0.58, 0.1], [0.58, -0.5], [-0.58, -0.6]]) boite(corps, 0.03, 0.18, 0.25, fonce, x, 0.62, z);
    // pics sur le dos
    cone(corps, 0.12, 0.28, 4, orange, 0, 1.78, 1.15);
    for (let k = 0; k < 3; k++) cone(corps, 0.16 - k * 0.03, 0.36 - k * 0.06, 4, orange, 0, 0.98 - k * 0.12, -1.0 - k * 0.32);
    // queue
    const queue = cone(corps, 0.35, 1.3, 6, vert, 0, 0.6, -1.55);
    queue.rotation.x = -Math.PI / 2 - 0.15;
    // petits bras
    for (const s of [1, -1]) boite(corps, 0.12, 0.12, 0.3, vert, s * 0.6, 0.75, 0.6);
    boite(corps, 0.85, 0.5, 0.15, fonce, 0, 1.0, -0.75); // dossier
    volant(corps, 0, 1.05, 0.25);
    quatreRoues(corps, roues, orange);
    return { siege: [0, 0.72, -0.4] };
  },

  baignoire({ corps, roues }) {
    const blanc = 0xf8f9fa, or = 0xffc933, bleu = 0x74c0fc, jaune = 0xffd43b;
    boite(corps, 1.2, 0.14, 2.3, 0xced4da, 0, 0.3, 0);
    // la baignoire : fond + bords + bouts arrondis
    boite(corps, 1.3, 0.15, 2.2, blanc, 0, 0.45, 0);
    for (const s of [1, -1]) boite(corps, 0.16, 0.7, 2.2, blanc, s * 0.65, 0.75, 0);
    for (const z of [1.1, -1.1]) {
      const bout = cylindre(corps, 0.65, 0.65, 0.7, 10, blanc, 0, 0.75, z);
      bout.scale.set(1, 1, 0.35);
    }
    boite(corps, 1.15, 0.05, 2.05, bleu, 0, 0.98, 0); // eau
    // mousse
    const mousse = [[0.3, 0.5], [-0.35, 0.6], [0.1, 0.85], [-0.2, 0.25], [0.4, 0.05], [-0.4, -0.2], [0.35, -0.6], [-0.1, -0.9]];
    for (const [x, z] of mousse) sphere(corps, 0.18 + Math.abs(x) * 0.15, 0xffffff, x, 1.05, z, 1);
    // robinet doré + pieds en or
    cylindre(corps, 0.05, 0.05, 0.4, 6, or, 0, 1.2, 1.15);
    const bec = cylindre(corps, 0.05, 0.05, 0.3, 6, or, 0, 1.38, 1.02);
    bec.rotation.x = Math.PI / 2;
    for (const sx of [1, -1]) for (const sz of [1, -1]) sphere(corps, 0.1, or, sx * 0.45, 0.3, sz * 0.6);
    // canard en plastique
    sphere(corps, 0.16, jaune, 0.45, 1.18, 0.75, 1);
    sphere(corps, 0.1, jaune, 0.45, 1.36, 0.85, 1);
    cone(corps, 0.05, 0.12, 4, 0xff922b, 0.45, 1.34, 0.98).rotation.x = Math.PI / 2;
    volant(corps, 0, 1.25, 0.45, bleu);
    quatreRoues(corps, roues, or, 0.32, 0.36);
    return { siege: [0, 0.78, -0.35] };
  },
};

for (const type of Object.keys(MODELES_GLB)) CONSTRUCTEURS[type] = constructeurGLB(type);

const texOmbre = textureRond();
const geoOmbre = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const matOmbre = new THREE.MeshBasicMaterial({ map: texOmbre, transparent: true, depthWrite: false });

/**
 * Crée un kart.
 * groupe : position + direction ; corps : dérapage / roulis / rebonds ; siege : où poser le pilote.
 */
export function creerKart(type = "classique") {
  const groupe = new THREE.Group();
  const corps = new THREE.Group();
  groupe.add(corps);
  const roues = { avant: [], arriere: [] };
  const info = CONSTRUCTEURS[type]({ corps, roues });
  const siege = new THREE.Group();
  siege.position.set(...info.siege);
  corps.add(siege);

  const ombre = new THREE.Mesh(geoOmbre, matOmbre);
  ombre.scale.set(2.4, 1, 3.4);
  ombre.position.y = 0.05;
  groupe.add(ombre);

  return { groupe, corps, siege, roues, ombre };
}
