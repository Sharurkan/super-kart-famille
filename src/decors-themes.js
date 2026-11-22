import * as THREE from "three";
import { instances, positions, boiteRonde } from "./decor.js";
import { fusion, matCouleurs, nuages } from "./decors-circuits.js";
import { creerDino } from "./dinos.js";
import { planter } from "./vegetation.js";
import { installerRavin } from "./ptero.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Décors des circuits Dinosaures, Jouets et Concert pop.
// Astuce couleurs : les parties "blanches" d'un objet fusionné prennent la couleur
// de chaque instance (un dino vert, un bleu, un violet...), le noir reste noir.

const B = 0xffffff; // partie qui prend la couleur de l'instance
const N = 0x222222;
const auHasard = (rnd, liste) => liste[Math.floor(rnd() * liste.length)];
const versPiste = (piste, p) => {
  const { indice } = piste.localiser(p.x, p.z);
  return Math.atan2(piste.cx[indice] - p.x, piste.cz[indice] - p.z);
};

// ---------------------------------------------------------------------------
const DENSITE_MAX = 1.1; // multiplicateur maximal du nombre de plantes quand le circuit s'allonge (budget triangles)
export function decorDino(groupe, piste, rnd, horsPiste, obstacles = []) {
  const couleursDinos = [0x69db7c, 0x4dabf7, 0xb197fc, 0xffa94d, 0x38d9a9, 0xf783ac];

  // vrais dinosaures animés (pack Quaternius), tournés vers la piste
  const mixers = [];
  const especes = ["Trex", "Apatosaurus", "Stegosaurus", "Triceratops", "Parasaurolophus", "Velociraptor"];
  const places = [
    ...positions(piste, rnd, 8, horsPiste + 6, 45), // près de la piste
    ...positions(piste, rnd, 6, 50, 95), // plus loin (les grands)
  ];
  places.forEach((p, k) => {
    const nom = k < 8 ? especes[k % especes.length] : ["Apatosaurus", "Trex", "Apatosaurus", "Stegosaurus", "Triceratops", "Apatosaurus"][k - 8];
    const anim = rnd() < 0.3 ? "Attack" : "Idle";
    creerDino(nom, { animation: anim, vitesse: 0.8 + rnd() * 0.3 }).then(({ objet, mixer }) => {
      objet.position.set(p.x, 0, p.z);
      objet.rotation.y = versPiste(piste, p) + (rnd() - 0.5) * 0.8;
      groupe.add(objet);
      mixers.push(mixer);
    });
  });

  // forêt jurassique : vrais modèles 3D (fougères géantes, plantes tropicales, arbres, rochers)
  const varie = (liste, s0, ds) => liste.map((p) => ({ ...p, s: s0 + rnd() * ds, r: rnd() * 6.3 }));
  // Circuit plus long = plus de surface à décorer. Le budget de triangles (tablette) ne permet
  // pas de multiplier les plantes autant que la longueur : on en ajoute un peu (DENSITE_MAX)
  // et on resserre les bandes autour de la route pour garder la même densité vue du kart.
  const rapport = (piste.N * piste.pas) / 714; // 714 m : longueur pour laquelle les nombres ont été réglés
  const densite = Math.min(rapport, DENSITE_MAX);
  const serre = Math.max(0.6, Math.min(1, densite / rapport));
  const nb = (n) => Math.round(n * densite);
  const zone = (n, dMin, dMax) => positions(piste, rnd, nb(n), dMin, dMin + (dMax - dMin) * serre);
  planter(groupe, "Fern_1", varie(zone(130, piste.demi + 2.6, 45), 0.7, 0.9));
  planter(groupe, "Plant_1_Big", varie(zone(45, horsPiste, 60), 0.7, 0.7));
  planter(groupe, "Plant_7_Big", varie(zone(55, horsPiste, 70), 0.7, 0.7));
  planter(groupe, "Plant_1", varie(zone(70, piste.demi + 2.6, 40), 0.8, 0.6));
  planter(groupe, "Plant_7", varie(zone(70, piste.demi + 2.6, 40), 0.8, 0.6));
  planter(groupe, "Grass_Common_Tall", varie(zone(50, piste.demi + 2.2, 35), 0.7, 0.8));
  planter(groupe, "CommonTree_1", varie(zone(10, horsPiste + 8, 95), 0.8, 0.5));
  planter(groupe, "CommonTree_2", varie(zone(10, horsPiste + 8, 95), 0.8, 0.5));
  planter(groupe, "CommonTree_3", varie(zone(10, horsPiste + 8, 95), 0.8, 0.5));
  planter(groupe, "Pine_1", varie(zone(8, horsPiste + 12, 110), 0.8, 0.5));
  planter(groupe, "Pine_2", varie(zone(8, horsPiste + 12, 110), 0.8, 0.5));
  planter(groupe, "DeadTree_1", varie(zone(3, horsPiste + 6, 80), 0.8, 0.4));
  for (const r of ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"]) planter(groupe, r, varie(zone(16, horsPiste, 100), 0.6, 1.2).map((p) => ({ ...p, y: -0.15 })));
  // arbres lointains : vrais sapins et feuillus très simplifiés (cachés par la brume)
  planter(groupe, "Pine_5", varie(positions(piste, rnd, 34, 110, 170), 0.8, 0.6));
  planter(groupe, "CommonTree_5", varie(positions(piste, rnd, 12, 110, 160), 0.8, 0.6));

  // petits détails au bord de la route : cailloux, trèfles, fleurs, champignons géants
  const cailloux = ["Pebble_Round_1", "Pebble_Round_2", "Pebble_Round_3", "Pebble_Round_4", "Pebble_Round_5", "Pebble_Square_1", "Pebble_Square_2", "Pebble_Square_3"];
  for (const c of cailloux) planter(groupe, c, varie(positions(piste, rnd, nb(8), piste.demi + 0.8, piste.demi + 5), 0.7, 0.8));
  planter(groupe, "Clover_1", varie(zone(15, piste.demi + 1.5, 30), 0.8, 0.6));
  planter(groupe, "Clover_2", varie(zone(15, piste.demi + 1.5, 30), 0.8, 0.6));
  planter(groupe, "Flower_3_Group", varie(zone(16, piste.demi + 2, 35), 0.8, 0.5));
  planter(groupe, "Flower_4_Group", varie(zone(8, piste.demi + 2, 35), 0.8, 0.5));
  planter(groupe, "Mushroom_Common", varie(zone(12, horsPiste - 1, 40), 0.8, 0.7));
  sentiers(groupe, piste, rnd, nb(4));

  // nids d'œufs (aucun modèle libre équivalent : formes simples, peu de triangles)
  const nid = fusion([
    { geo: new THREE.TorusGeometry(1, 0.35, 5, 9).rotateX(Math.PI / 2).translate(0, 0.3, 0), couleur: 0x9c7a4a },
    { geo: new THREE.SphereGeometry(0.45, 9, 7).scale(1, 1.35, 1).translate(-0.35, 0.6, 0), couleur: 0xfff3bf },
    { geo: new THREE.SphereGeometry(0.45, 9, 7).scale(1, 1.35, 1).translate(0.35, 0.6, 0.15), couleur: 0xd3f9d8 },
    { geo: new THREE.SphereGeometry(0.45, 9, 7).scale(1, 1.35, 1).translate(0, 0.6, -0.4), couleur: 0xffe8cc },
  ]);
  groupe.add(instances(nid, matCouleurs(), positions(piste, rnd, nb(14), horsPiste, 40).map((p) => ({ ...p, s: 1, r: rnd() * 6 }))));

  // volcan au loin avec sa fumée
  const angleVolcan = rnd() * Math.PI * 2;
  const xV = piste.centre.x + Math.cos(angleVolcan) * (piste.rayon + 260);
  const zV = piste.centre.z + Math.sin(angleVolcan) * (piste.rayon + 260);
  const volcan = fusion([
    { geo: new THREE.CylinderGeometry(30, 110, 120, 20).translate(0, 60, 0), couleur: 0x6b4f3a },
    { geo: new THREE.CylinderGeometry(26, 30, 6, 20).translate(0, 121, 0), couleur: 0xff6b00 },
  ]);
  groupe.add(instances(volcan, matCouleurs(), [{ x: xV, z: zV, s: 1 }]));
  const collines = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - angleVolcan), Math.cos(a - angleVolcan))) < 0.35) continue;
    const r = piste.rayon + 230 + rnd() * 70;
    collines.push({ x: piste.centre.x + Math.cos(a) * r, y: -8, z: piste.centre.z + Math.sin(a) * r, s: 70 + rnd() * 50, sy: 30 + rnd() * 25, couleur: [0x5c940d, 0x74b816, 0x82c91e][i % 3] });
  }
  groupe.add(instances(new THREE.SphereGeometry(1, 22, 13), new THREE.MeshLambertMaterial({ color: 0xffffff }), collines));
  const fumee = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0x9a9a9a, fog: false, transparent: true, opacity: 0.8 }), 14);
  groupe.add(fumee);
  nuages(groupe, piste, rnd);
  teteTrex(piste, groupe);
  diplodocus(piste, groupe); // après le T-rex : sa place ne change pas
  decorLooping(piste, groupe);
  ravinDuPtero(groupe, piste); // ligne droite du haut : le vide et le ptérodactyle

  let t = 0;
  const o = new THREE.Object3D();
  return (dt) => {
    t += dt;
    for (let k = 0; k < 14; k++) {
      const vie = (t * 0.08 + k / 14) % 1;
      o.position.set(xV + Math.sin(k * 3 + t * 0.2) * 10 * vie, 130 + vie * 90, zV + Math.cos(k * 2) * 8 * vie);
      o.scale.setScalar(10 + vie * 25);
      o.updateMatrix();
      fumee.setMatrixAt(k, o.matrix);
    }
    fumee.instanceMatrix.needsUpdate = true;
    for (const m of mixers) m.update(dt);
  };
}

// ---------------------------------------------------------------------------
export function decorJouets(groupe, piste, rnd, horsPiste) {
  const vives = [0xff6b6b, 0xffd43b, 0x4dabf7, 0x51cf66, 0xf783ac, 0xff922b, 0x9775fa];

  // grosses briques à picots
  const picots = [];
  for (const x of [-1.5, -0.5, 0.5, 1.5]) for (const z of [-0.5, 0.5]) picots.push({ geo: new THREE.CylinderGeometry(0.32, 0.32, 0.3, 20).translate(x, 2.55, z), couleur: B });
  const brique = fusion([{ geo: boiteRonde(4, 2.4, 2).translate(0, 1.2, 0), couleur: B }, ...picots]);
  const briques = [];
  for (const p of positions(piste, rnd, 50, horsPiste, 90)) {
    const c = auHasard(rnd, vives), r = rnd() * 6;
    briques.push({ ...p, s: 1, r, couleur: c });
    if (rnd() < 0.5) briques.push({ x: p.x + 0.5, y: 2.4, z: p.z + 0.3, s: 1, r: r + (rnd() < 0.5 ? Math.PI / 2 : 0), couleur: auHasard(rnd, vives) });
  }
  groupe.add(instances(brique, matCouleurs(), briques));

  // cubes de bois empilés
  const cubes = [];
  for (const p of positions(piste, rnd, 25, horsPiste, 70)) {
    const r = rnd() * 6;
    for (const [dx, dy, dz] of [[0, 0, 0], [2.1, 0, 0], [1.05, 2, 0]]) {
      cubes.push({ x: p.x + Math.cos(r) * dx, y: dy, z: p.z + Math.sin(r) * dx + dz, s: 1, r: -r, couleur: auHasard(rnd, vives) });
    }
  }
  const cube = fusion([
    { geo: boiteRonde(2, 2, 2).translate(0, 1, 0), couleur: 0xf1d3a1 },
    { geo: boiteRonde(1.4, 1.4, 2.04).translate(0, 1, 0), couleur: B },
    { geo: boiteRonde(2.04, 1.4, 1.4).translate(0, 1, 0), couleur: B },
  ]);
  groupe.add(instances(cube, matCouleurs(), cubes));

  // crayons géants couchés
  const crayon = fusion([
    { geo: new THREE.CylinderGeometry(0.5, 0.5, 6, 12).rotateZ(Math.PI / 2).translate(0, 0.5, 0), couleur: B },
    { geo: new THREE.ConeGeometry(0.5, 1.2, 12).rotateZ(-Math.PI / 2).translate(3.6, 0.5, 0), couleur: 0xf1d3a1 },
    { geo: new THREE.ConeGeometry(0.17, 0.4, 12).rotateZ(-Math.PI / 2).translate(4.05, 0.5, 0), couleur: B },
    { geo: new THREE.CylinderGeometry(0.52, 0.52, 0.5, 12).rotateZ(Math.PI / 2).translate(-3.2, 0.5, 0), couleur: 0xffc9c9 },
  ]);
  groupe.add(instances(crayon, matCouleurs(), positions(piste, rnd, 30, horsPiste, 60).map((p) => ({ ...p, s: 1, r: rnd() * 6, couleur: auHasard(rnd, vives) }))));

  // ballons à bande blanche
  const ballon = fusion([
    { geo: new THREE.IcosahedronGeometry(1.4, 2).translate(0, 1.4, 0), couleur: B },
    { geo: new THREE.TorusGeometry(1.38, 0.18, 4, 16).translate(0, 1.4, 0), couleur: 0xffffff },
  ]);
  groupe.add(instances(ballon, matCouleurs(), positions(piste, rnd, 30, horsPiste, 70).map((p) => ({ ...p, s: 0.8 + rnd() * 0.6, r: rnd() * 6, couleur: auHasard(rnd, vives) }))));

  // nounours assis, tournés vers la piste
  const brun = 0xc08552, clair = 0xf1d3a1;
  const nounours = fusion([
    { geo: new THREE.SphereGeometry(1.2, 16, 13).scale(1, 1.15, 0.9).translate(0, 1.3, 0), couleur: brun },
    { geo: new THREE.SphereGeometry(0.75, 16, 13).scale(1, 1.1, 0.4).translate(0, 1.2, 0.75), couleur: clair },
    { geo: new THREE.SphereGeometry(0.9, 16, 13).translate(0, 3.0, 0), couleur: brun },
    { geo: new THREE.SphereGeometry(0.35, 13, 10).translate(0, 2.85, 0.8), couleur: clair },
    { geo: new THREE.IcosahedronGeometry(0.12, 1).translate(0, 2.95, 1.12), couleur: N },
    { geo: new THREE.IcosahedronGeometry(0.1, 1).translate(0.32, 3.25, 0.78), couleur: N },
    { geo: new THREE.IcosahedronGeometry(0.1, 1).translate(-0.32, 3.25, 0.78), couleur: N },
    { geo: new THREE.SphereGeometry(0.35, 13, 10).translate(0.65, 3.75, 0), couleur: brun },
    { geo: new THREE.SphereGeometry(0.35, 13, 10).translate(-0.65, 3.75, 0), couleur: brun },
    { geo: new THREE.SphereGeometry(0.4, 13, 10).scale(1, 1.6, 1).translate(1.2, 1.7, 0.3), couleur: brun },
    { geo: new THREE.SphereGeometry(0.4, 13, 10).scale(1, 1.6, 1).translate(-1.2, 1.7, 0.3), couleur: brun },
    { geo: new THREE.SphereGeometry(0.5, 13, 10).scale(1, 0.9, 1.6).translate(0.6, 0.45, 0.9), couleur: brun },
    { geo: new THREE.SphereGeometry(0.5, 13, 10).scale(1, 0.9, 1.6).translate(-0.6, 0.45, 0.9), couleur: brun },
    { geo: boiteRonde(1.0, 0.25, 0.25).translate(0, 2.25, 0.7), couleur: 0xff6b6b }, // nœud papillon
  ]);
  groupe.add(instances(nounours, matCouleurs(), positions(piste, rnd, 14, horsPiste, 45).map((p) => ({ ...p, s: 1.3, r: versPiste(piste, p) }))));

  // toupies qui tournent
  const toupie = fusion([
    { geo: new THREE.ConeGeometry(1, 1.2, 20).rotateX(Math.PI).translate(0, 0.6, 0), couleur: B },
    { geo: new THREE.CylinderGeometry(1.05, 1.05, 0.25, 20).translate(0, 1.25, 0), couleur: 0xffffff },
    { geo: new THREE.ConeGeometry(1, 0.6, 20).translate(0, 1.65, 0), couleur: B },
    { geo: new THREE.CylinderGeometry(0.1, 0.1, 0.7, 12).translate(0, 2.2, 0), couleur: 0x8b5a2b },
  ]);
  const toupies = positions(piste, rnd, 12, horsPiste, 40).map((p) => ({ ...p, s: 1.2, r: 0, couleur: auHasard(rnd, vives) }));
  const mesToupies = instances(toupie, matCouleurs(), toupies);
  groupe.add(mesToupies);

  // piles de livres géants au loin
  const livres = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = piste.rayon + 200 + rnd() * 80;
    let y = 0;
    for (let k = 0; k < 3 + Math.floor(rnd() * 3); k++) {
      const h = 10 + rnd() * 8;
      livres.push({ x: piste.centre.x + Math.cos(a) * r, y, z: piste.centre.z + Math.sin(a) * r, s: 1, r: rnd() * 6, couleur: auHasard(rnd, vives), h });
      y += h;
    }
  }
  const livre = fusion([
    { geo: boiteRonde(60, 1, 40).translate(0, 0.5, 0), couleur: B },
    { geo: boiteRonde(58, 0.9, 38).translate(1.2, 0.5, 0), couleur: 0xfffaf0 },
  ]);
  groupe.add(instances(livre, matCouleurs(), livres.map((l) => ({ ...l, sy: l.h }))));

  nuages(groupe, piste, rnd);

  let t = 0;
  const o = new THREE.Object3D();
  return (dt) => {
    t += dt;
    toupies.forEach((p, i) => {
      o.position.set(p.x + Math.sin(t * 0.7 + i) * 0.6, 0, p.z + Math.cos(t * 0.6 + i) * 0.6);
      o.rotation.set(Math.sin(t * 2 + i) * 0.08, t * 8 + i, 0);
      o.scale.setScalar(p.s);
      o.updateMatrix();
      mesToupies.setMatrixAt(i, o.matrix);
    });
    mesToupies.instanceMatrix.needsUpdate = true;
  };
}

// ---------------------------------------------------------------------------
function textureEcran() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
  const d = g.createLinearGradient(0, 0, 256, 128);
  d.addColorStop(0, "#ff4dd2");
  d.addColorStop(0.5, "#7b2cff");
  d.addColorStop(1, "#22b8cf");
  g.fillStyle = d;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = "#fff";
  g.font = "bold 70px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("♪ ★ ♫", 128, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function decorConcert(groupe, piste, rnd, horsPiste) {
  const neons = [0xff4dd2, 0x22b8cf, 0xffd43b, 0x9775fa, 0x69db7c, 0xff922b];

  // la scène, face à la ligne droite de départ
  const i0 = Math.floor(piste.N * 0.04);
  const cote = 1;
  const dist = piste.demi + piste.marge + 18;
  const sx = piste.cx[i0] + piste.nx[i0] * dist * cote, sz = piste.cz[i0] + piste.nz[i0] * dist * cote;
  const scene = new THREE.Group();
  scene.position.set(sx, 0, sz);
  scene.rotation.y = Math.atan2(-piste.nx[i0] * cote, -piste.nz[i0] * cote); // regarde la piste
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: false });
  const sol = new THREE.Mesh(boiteRonde(30, 2, 14), mat(0x343a40));
  sol.position.set(0, 1, 0);
  const fond = new THREE.Mesh(boiteRonde(30, 14, 1), mat(0x212529));
  fond.position.set(0, 9, -6.5);
  const ecran = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), new THREE.MeshBasicMaterial({ map: textureEcran(), fog: false }));
  ecran.position.set(0, 10, -5.9);
  scene.add(sol, fond, ecran);
  // enceintes
  const enceinte = fusion([
    { geo: boiteRonde(3, 4, 2.4).translate(0, 2, 0), couleur: 0x1a1a1a },
    { geo: new THREE.CylinderGeometry(0.9, 0.9, 0.1, 12).rotateX(Math.PI / 2).translate(0, 2.6, 1.22), couleur: 0x555555 },
    { geo: new THREE.CylinderGeometry(0.45, 0.45, 0.1, 12).rotateX(Math.PI / 2).translate(0, 1.0, 1.22), couleur: 0x555555 },
  ]);
  scene.add(instances(enceinte, matCouleurs(), [
    { x: -13, y: 2, z: 2, s: 1 }, { x: 13, y: 2, z: 2, s: 1 }, { x: -13, y: 6, z: 2, s: 1 }, { x: 13, y: 6, z: 2, s: 1 },
  ]));
  // boule à facettes
  const boule = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 2), new THREE.MeshLambertMaterial({ color: 0xdee2e6, flatShading: false, emissive: 0x333333 }));
  boule.position.set(0, 15.5, 2);
  scene.add(boule);
  groupe.add(scene);

  // tours de lumière avec projecteurs colorés qui balaient le ciel
  const projecteurs = [];
  const geoFaisceau = new THREE.ConeGeometry(4, 40, 12, 1, true).translate(0, -20, 0).rotateX(Math.PI); // pointe en bas
  for (const p of positions(piste, rnd, 10, horsPiste + 2, 45)) {
    const mat2 = new THREE.MeshLambertMaterial({ color: 0x495057 });
    const poteau = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 10, 12), mat2);
    poteau.position.set(p.x, 5, p.z);
    groupe.add(poteau);
    const pivot = new THREE.Group();
    pivot.position.set(p.x, 10, p.z);
    const faisceau = new THREE.Mesh(geoFaisceau, new THREE.MeshBasicMaterial({
      color: auHasard(rnd, neons), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    pivot.add(faisceau);
    groupe.add(pivot);
    projecteurs.push({ pivot, phase: rnd() * 6 });
  }

  // notes de musique flottantes
  const note = fusion([
    { geo: new THREE.SphereGeometry(0.5, 13, 10).scale(1.3, 1, 0.5).translate(0, 0.5, 0), couleur: B },
    { geo: boiteRonde(0.14, 2.2, 0.14).translate(0.58, 1.6, 0), couleur: B },
    { geo: boiteRonde(0.7, 0.3, 0.14).rotateZ(-0.4).translate(0.85, 2.55, 0), couleur: B },
  ]);
  const notes = positions(piste, rnd, 40, horsPiste, 70).map((p) => ({ ...p, y: 3 + rnd() * 6, s: 1 + rnd(), r: rnd() * 6, couleur: auHasard(rnd, neons) }));
  const mesNotes = instances(note, new THREE.MeshBasicMaterial({ vertexColors: true }), notes);
  groupe.add(mesNotes);

  // ballons
  const ballon = fusion([
    { geo: new THREE.SphereGeometry(0.9, 16, 13).scale(1, 1.2, 1).translate(0, 4, 0), couleur: B },
    { geo: new THREE.CylinderGeometry(0.02, 0.02, 3, 12).translate(0, 1.5, 0), couleur: 0xdddddd },
  ]);
  groupe.add(instances(ballon, matCouleurs(), positions(piste, rnd, 50, piste.demi + 2.5, 50).map((p) => ({ ...p, s: 1, r: 0, couleur: auHasard(rnd, neons) }))));

  // étoiles
  const nb = 500, pos = new Float32Array(nb * 3);
  for (let i = 0; i < nb; i++) {
    const a = rnd() * Math.PI * 2, h = 0.15 + rnd() * 0.85;
    const r = 700 * Math.sqrt(1 - h * h);
    pos.set([piste.centre.x + Math.cos(a) * r, 700 * h, piste.centre.z + Math.sin(a) * r], i * 3);
  }
  const geoEt = new THREE.BufferGeometry();
  geoEt.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  groupe.add(new THREE.Points(geoEt, new THREE.PointsMaterial({ color: 0xffffff, size: 2.5, sizeAttenuation: false, fog: false })));

  let t = 0;
  const o = new THREE.Object3D();
  return (dt) => {
    t += dt;
    for (const p of projecteurs) p.pivot.rotation.set(Math.sin(t * 0.7 + p.phase) * 0.6, 0, Math.cos(t * 0.5 + p.phase) * 0.6);
    boule.rotation.y += dt * 0.8;
    notes.forEach((n, i) => {
      o.position.set(n.x, n.y + Math.sin(t * 1.5 + i) * 0.8, n.z);
      o.rotation.set(0, n.r + t * 0.8, Math.sin(t + i) * 0.2);
      o.scale.setScalar(n.s);
      o.updateMatrix();
      mesNotes.setMatrixAt(i, o.matrix);
    });
    mesNotes.instanceMatrix.needsUpdate = true;
  };
}

// ---------------------------------------------------------------------------
/** Surface à facettes passant par une suite de sections (même nombre de points par section). */
function loft(sections, couleur, double = true) {
  const pos = [];
  for (let s = 0; s < sections.length - 1; s++) {
    const A = sections[s], B = sections[s + 1];
    for (let k = 0; k < A.pts.length - 1; k++) {
      const a0 = [A.pts[k][0], A.pts[k][1], A.z], a1 = [A.pts[k + 1][0], A.pts[k + 1][1], A.z];
      const b0 = [B.pts[k][0], B.pts[k][1], B.z], b1 = [B.pts[k + 1][0], B.pts[k + 1][1], B.z];
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: couleur, flatShading: true, side: double ? THREE.DoubleSide : THREE.FrontSide }));
}

/** Bouchon plat (éventail) qui ferme une section. */
function bouchon(section, couleur) {
  const pos = [];
  const c = section.pts.reduce((m, p) => [m[0] + p[0] / section.pts.length, m[1] + p[1] / section.pts.length], [0, 0]);
  for (let k = 0; k < section.pts.length - 1; k++)
    pos.push(c[0], c[1], section.z, section.pts[k][0], section.pts[k][1], section.z, section.pts[k + 1][0], section.pts[k + 1][1], section.z);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: couleur, flatShading: true, side: THREE.DoubleSide }));
}

/** Indice de la ligne droite la plus longue autour d'une position voulue, loin des tremplins. */
function ligneDroite(piste, fraction, eviter = []) {
  const N = piste.N;
  const enveloppe = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const courbure = (i) => Math.abs(enveloppe(piste.angleA((i + 25) % N) - piste.angleA((i - 25 + N) % N)));
  let i = Math.floor(N * fraction), cMin = Infinity;
  for (let k = -Math.floor(N * 0.25); k <= N * 0.25; k++) {
    const j = (Math.floor(N * fraction) + k + N) % N;
    if (j < 50 || j > N - 70) continue;
    if (piste.tremplins.some((t) => Math.abs(t.debut - j) < 60)) continue;
    if (eviter.some((e) => Math.abs(e - j) < 90)) continue;
    const c = courbure(j) + Math.abs(k) * 0.0005;
    if (c < cMin) { cMin = c; i = j; }
  }
  return i;
}

/**
 * Tunnel : une énorme tête de T-rex posée en travers de la route, gueule grande ouverte.
 * On entre par la gueule (sur la langue) et on ressort par l'arrière de la tête.
 * Couleurs et facettes reprises du vrai modèle de T-rex (pack Quaternius).
 */
function tunnelTrex(piste) {
  const i = ligneDroite(piste, 0.55);
  const VERT = 0x5a6b4e, OLIVE = 0x848164, BEIGE = 0xb9935f, ROUGE = 0x863f45, NOIR = 0x161616;
  const tete = new THREE.Group();
  tete.userData.indice = i;
  const L = piste.demi + piste.marge + 2; // demi-largeur de la gueule (au-delà des barrières)
  const pal = 8.5; // hauteur du palais

  // crâne : sections du bout du museau (z = -22) jusqu'à l'arrière (z = +20)
  const section = (z, haut, w) => ({
    z,
    pts: [[-(w - 2.2), pal], [-w, pal + 1.4], [-w, pal + 4], [-w * 0.7, haut - 0.8], [0, haut], [w * 0.7, haut - 0.8], [w, pal + 4], [w, pal + 1.4], [w - 2.2, pal]],
  });
  const W = L + 3;
  const crane = [section(-22, 12.5, W - 0.5), section(-14, 14, W), section(-4, 15.5, W + 0.3), section(6, 18.5, W + 0.8), section(14, 18, W + 0.5), section(20, 16, W)];
  tete.add(loft(crane, VERT));
  tete.add(bouchon(crane[0], VERT)); // bout du museau
  // dessous de la lèvre du haut, plus clair
  tete.add(loft(crane.map((c) => ({ z: c.z, pts: [[-(W - 2.2), pal], [-(W - 2.2), pal - 0.6], [W - 2.2, pal - 0.6], [W - 2.2, pal]] })), OLIVE));
  // palais (intérieur de la gueule)
  const palais = new THREE.Mesh(new THREE.PlaneGeometry(2 * (W - 2.2), 42), new THREE.MeshBasicMaterial({ color: 0x5c1f26, side: THREE.DoubleSide }));
  palais.rotation.x = Math.PI / 2;
  palais.position.set(0, pal - 0.62, -1);
  tete.add(palais);

  // mâchoire du bas : deux côtés posés au sol, de part et d'autre de la route
  const matDent = new THREE.MeshLambertMaterial({ color: 0xfff8e1, flatShading: true });
  for (const sx of [1, -1]) {
    const mach = [];
    for (const [z, h] of [[-21, 2.6], [-10, 3.4], [2, 4.4], [12, 5.2], [20, 5]]) {
      mach.push({ z, pts: [[sx * L, 0], [sx * L, h], [sx * (L + 1.6), h + 0.5], [sx * W, h - 0.4], [sx * (W + 0.4), 0]] });
    }
    tete.add(loft(mach, BEIGE));
    // intérieur des joues (rouge sombre)
    const joue = new THREE.Mesh(new THREE.PlaneGeometry(40, pal), new THREE.MeshBasicMaterial({ color: ROUGE, side: THREE.DoubleSide }));
    joue.rotation.y = Math.PI / 2;
    joue.position.set(sx * (L - 0.05), pal / 2, -1);
    tete.add(joue);
    // dents du haut (pendent des gencives) et du bas (sortent de la mâchoire)
    for (let z = -20; z <= 8; z += 2.8) {
      const d = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2.8, 5), matDent);
      d.rotation.x = Math.PI;
      d.position.set(sx * (W - 2.6), pal - 1.4, z);
      tete.add(d);
      if (z < 6) {
        const b = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.4, 5), matDent);
        const hm = 2.6 + ((z + 21) / 41) * 2.4;
        b.position.set(sx * (L + 0.8), hm + 1.1, z + 1.4);
        tete.add(b);
      }
    }
    // œil jaune avec pupille fendue, et arcade osseuse au-dessus
    const oeil = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 1), new THREE.MeshLambertMaterial({ color: 0xf2c94c, flatShading: true }));
    oeil.position.set(sx * (W + 0.2), 14.5, 6);
    tete.add(oeil);
    const pupille = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.5), new THREE.MeshBasicMaterial({ color: NOIR }));
    pupille.position.set(sx * (W + 1.85), 14.5, 6);
    tete.add(pupille);
    const arcade = new THREE.Mesh(new THREE.ConeGeometry(1.8, 4.5, 4), new THREE.MeshLambertMaterial({ color: OLIVE, flatShading: true }));
    arcade.rotation.set(Math.PI / 2, 0, sx * 0.4);
    arcade.position.set(sx * (W - 0.4), 17.2, 5);
    tete.add(arcade);
    // narine
    const narine = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: NOIR }));
    narine.scale.set(1, 0.5, 1.4);
    narine.position.set(sx * 4, 12.6, -19.5);
    tete.add(narine);
  }
  // rangée de dents à l'avant du museau
  for (let x = -(W - 3); x <= W - 3; x += 2.9) {
    const d = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3, 5), matDent);
    d.rotation.x = Math.PI;
    d.position.set(x, pal - 1.5, -21);
    tete.add(d);
  }
  // langue sur la route
  const langue = new THREE.Mesh(new THREE.CircleGeometry(1, 32).scale(7, 18, 1), new THREE.MeshLambertMaterial({ color: 0xc2526a }));
  langue.rotation.x = -Math.PI / 2;
  langue.position.set(0, 0.045, -2);
  tete.add(langue);

  // cou qui part sur le côté gauche, et dos qui dépasse du sol (le reste est "enterré")
  const matVert = new THREE.MeshLambertMaterial({ color: VERT, flatShading: true });
  const cou = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 26, 7), matVert);
  cou.position.set(W + 8, 7, 18);
  cou.rotation.set(0, 0, 1.15);
  tete.add(cou);
  const dos = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), matVert);
  dos.scale.set(14, 9, 20);
  dos.position.set(W + 26, 0, 24);
  tete.add(dos);
  const ventre = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), new THREE.MeshLambertMaterial({ color: BEIGE, flatShading: true }));
  ventre.scale.set(12, 5, 17);
  ventre.position.set(W + 22, 0, 22);
  tete.add(ventre);

  tete.position.set(piste.cx[i], 0, piste.cz[i]);
  tete.rotation.y = piste.angleA(i);
  return tete;
}

// ---------------------------------------------------------------------------
/**
 * Diplodocus géant couché SUR la route (modèle généré par IA, socle enlevé puis repeint dans
 * Blender : outils/blender/nettoyer_diplodocus.py et repeindre_diplodocus.py). Il occupe
 * presque toute la ligne droite de droite : la route se resserre jusqu'à son museau posé
 * par terre, on monte sur sa tête, son long cou fait une pente douce jusqu'à son dos, puis
 * on redescend par sa queue. Tout le monde passe dessus (joueur et adversaires).
 *
 * Le modèle est étiré de façon non uniforme (cou et queue bien plus larges que nature, pour
 * qu'on puisse y rouler à plusieurs), "plié" le long de la ligne centrale, et le dessus est
 * un peu aplati là où l'on roule. La hauteur est mesurée en "dessinant" ses triangles dans
 * une grille (piste.surfaces) : les karts roulent exactement sur ce qu'on voit. Sur le corps,
 * des barrières invisibles (piste.retrecissements) empêchent de tomber sur les côtés.
 */
const DIPLO = {
  longueur: 118, // m, du bout du museau au bout de la queue
  hauteur: 12, // m, haut du dos
  teteBasse: 0.75, // la tête est un peu aplatie (museau à ~1,1 m : on monte dessus sans tremplin)
  // mètres par unité du modèle en travers, le long du corps (u : 0 = museau, 1 = bout de la queue)
  // (mêmes chiffres dans outils/blender/repeindre_diplodocus.py, pour les UV)
  largeur: [[0, 80], [0.09, 85], [0.27, 85], [0.34, 52], [0.58, 52], [0.68, 80], [0.85, 120], [1, 150]],
  // demi-largeur où l'on roule (barrières invisibles) : cou, dos, queue
  voie: [[0, 2.8], [0.27, 2.8], [0.36, 4.2], [0.6, 4.2], [0.7, 3.2], [1, 3.2]],
  entonnoir: 55, // m avant le museau où la route se resserre (rochers de chaque côté)
  yeux: { u: 0.065, ecart: 2.1, rayon: 1.6 }, // yeux posés sur la tête, de part et d'autre de la voie
};
const interpole = (table, u) => {
  if (u <= table[0][0]) return table[0][1];
  for (let k = 1; k < table.length; k++) {
    if (u <= table[k][0]) {
      const [u0, a] = table[k - 1], [u1, b] = table[k];
      const t = (u - u0) / (u1 - u0);
      return a + (b - a) * t * t * (3 - 2 * t);
    }
  }
  return table[table.length - 1][1];
};
const doux = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function diplodocus(piste, groupe) {
  const N = piste.N, pas = piste.pas;
  const nbLong = Math.ceil(DIPLO.longueur / pas);
  // ligne droite de droite : le museau au début, la queue redescend juste avant le virage
  const iMuseau = ligneDroiteLongue(piste, 0.372, 25, DIPLO.longueur + 3, 0.015);

  // 1. entonnoir jusqu'au museau, puis la voie sur le corps (une barrière par échantillon)
  const debutEntonnoir = (iMuseau - Math.round(DIPLO.entonnoir / pas) + N) % N;
  piste.retrecissements.push({ debut: debutEntonnoir, fin: (iMuseau + 2) % N, demiMin: DIPLO.voie[0][1] });
  for (let k = 0; k <= nbLong; k++) {
    // { debut: j - 1, fin: j } : étroit exactement à l'échantillon j (voir piste.limiteLaterale)
    const j = (iMuseau + k) % N;
    piste.retrecissements.push({ debut: (j - 1 + N) % N, fin: j, demiMin: interpole(DIPLO.voie, (k * pas) / DIPLO.longueur) });
  }
  piste.diplodocus = { indice: iMuseau, fin: (iMuseau + nbLong) % N, debutEntonnoir };

  // rochers le long de l'entonnoir (ce sont eux qui "font" les murs avant le museau)
  const ROCHERS = ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"];
  const rochers = ROCHERS.map(() => []);
  const nbEntonnoir = (iMuseau - debutEntonnoir + N) % N;
  for (let k = 0; k <= nbEntonnoir; k += 3) {
    const j = (debutEntonnoir + k) % N;
    const lim = piste.limiteLaterale(j) + 1.6;
    if (lim > piste.demi + piste.marge) continue;
    for (const s of [1, -1]) {
      rochers[(k / 3 + (s > 0 ? 1 : 2)) % 3].push({ x: piste.cx[j] + piste.nx[j] * s * lim, z: piste.cz[j] + piste.nz[j] * s * lim, s: 1 + ((k * 7) % 5) * 0.08, y: -0.2, r: k * 1.3 + s });
    }
  }
  ROCHERS.forEach((nom, n) => planter(groupe, nom, rochers[n]));

  new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "dinos/diplodocus.glb").then((gltf) => {
    let mesh = null, oeil = null;
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name.startsWith("oeil")) oeil = o;
      else if (!mesh) mesh = o;
    });
    gltf.scene.updateMatrixWorld(true);
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const pos = geo.attributes.position;
    const n = pos.count;
    // modèle couché le long de X (tête vers -X), posé sur y = 0, largeur en Z
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    const u = new Float32Array(n), S = new Float32Array(n), Lt = new Float32Array(n), Y = new Float32Array(n);
    for (let k = 0; k < n; k++) u[k] = (pos.getX(k) - b.min.x) / (b.max.x - b.min.x);

    // profils le long du corps (120 tranches) : latéral de la crête (le cou du modèle part
    // un peu de travers : on le remet dans l'axe) puis hauteur de la crête une fois étiré
    const NB = 120;
    const tranche = (v) => Math.min(NB - 1, Math.floor(v * NB));
    const lisser = (a, r) => a.map((_, i) => {
      let s = 0, c = 0;
      for (let d = -r; d <= r; d++) if (i + d >= 0 && i + d < NB) { s += a[i + d]; c++; }
      return s / c;
    });
    const parTranche = (a, v) => {
      const f = Math.min(NB - 1, Math.max(0, v * NB - 0.5)), i0 = Math.floor(f), i1 = Math.min(NB - 1, i0 + 1);
      return a[i0] + (a[i1] - a[i0]) * (f - i0);
    };
    const hMax = new Array(NB).fill(0);
    for (let k = 0; k < n; k++) hMax[tranche(u[k])] = Math.max(hMax[tranche(u[k])], pos.getY(k));
    const somme = new Array(NB).fill(0), nb = new Array(NB).fill(0);
    for (let k = 0; k < n; k++) {
      const t = tranche(u[k]);
      if (pos.getY(k) > hMax[t] * 0.85) { somme[t] += -pos.getZ(k); nb[t]++; }
    }
    const crete = lisser(somme.map((s, t) => (nb[t] ? s / nb[t] : 0)), 4);
    const hModele = Math.max(...hMax);
    const echelleY = (v) => (DIPLO.hauteur / hModele) * (DIPLO.teteBasse + (1 - DIPLO.teteBasse) * doux(0.02, 0.16, v));
    let lMin = Infinity, lMax = -Infinity;
    for (let k = 0; k < n; k++) {
      S[k] = u[k] * DIPLO.longueur;
      Lt[k] = (-pos.getZ(k) - parTranche(crete, u[k])) * interpole(DIPLO.largeur, u[k]); // +Z du modèle = vers la droite de la route
      Y[k] = pos.getY(k) * echelleY(u[k]);
    }
    // dessus aplati là où l'on roule : on remonte la peau jusqu'à la crête (lissée sur ~6 m)
    const hc = new Array(NB).fill(0), demiL = new Array(NB).fill(0);
    for (let k = 0; k < n; k++) {
      const t = tranche(u[k]);
      hc[t] = Math.max(hc[t], Y[k]);
      demiL[t] = Math.max(demiL[t], Math.abs(Lt[k]));
    }
    const hcL = lisser(lisser(hc, 3), 3);
    for (let k = 0; k < n; k++) {
      const h = parTranche(hcL, u[k]);
      const w0 = interpole(DIPLO.voie, u[k]) + 1.4;
      const w1 = w0 + Math.max(2, parTranche(demiL, u[k]) * 0.3);
      const w = (1 - doux(w0, w1, Math.abs(Lt[k]))) * doux(0.4, 0.7, Y[k] / Math.max(h, 0.01));
      Y[k] += (h - Y[k]) * w;
      lMin = Math.min(lMin, Lt[k]); lMax = Math.max(lMax, Lt[k]);
    }

    // pliage le long de la ligne centrale (interpolée entre deux échantillons)
    const plier = (s, l, y, cible) => {
      const f = s / pas, i0 = Math.floor(f), t = f - i0;
      const a = (iMuseau + i0 + N) % N, c = (a + 1) % N;
      const x = piste.cx[a] + (piste.cx[c] - piste.cx[a]) * t, z = piste.cz[a] + (piste.cz[c] - piste.cz[a]) * t;
      let nx = piste.nx[a] + (piste.nx[c] - piste.nx[a]) * t, nz = piste.nz[a] + (piste.nz[c] - piste.nz[a]) * t;
      const ln = Math.hypot(nx, nz);
      return cible.set(x + (nx / ln) * l, y, z + (nz / ln) * l);
    };
    const v = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      plier(S[k], Lt[k], Y[k], v);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.deleteAttribute("normal");
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const map = mesh.material.map; // peau repeinte dans Blender (dos rayé, ventre clair, bouche...)
    if (map) map.anisotropy = 4;
    // faces des deux côtés : certaines faces du modèle généré sont retournées
    const dino = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map, flatShading: true, side: THREE.DoubleSide }));
    groupe.add(dino);

    // grille de hauteurs : chaque triangle est "dessiné" dans la grille (s, latéral), on garde le plus haut
    const pasLat = 0.5;
    const latMin = Math.floor(lMin) - 1;
    const nbLat = Math.ceil((lMax + 1 - latMin) / pasLat) + 1;
    const avantMuseau = 2; // quelques échantillons avant le museau (grille à 0)
    const nbS = nbLong + avantMuseau + 3;
    const h = new Float32Array(nbS * nbLat);
    const idx = geo.index;
    const nTri = idx ? idx.count / 3 : n / 3;
    const sommet = (m) => (idx ? idx.getX(m) : m);
    for (let tIdx = 0; tIdx < nTri; tIdx++) {
      const A = sommet(3 * tIdx), B = sommet(3 * tIdx + 1), C = sommet(3 * tIdx + 2);
      // coordonnées grille : i (échantillons depuis le début de la grille), j (colonnes)
      const ua = S[A] / pas + avantMuseau, ub = S[B] / pas + avantMuseau, uc = S[C] / pas + avantMuseau;
      const va = (Lt[A] - latMin) / pasLat, vb = (Lt[B] - latMin) / pasLat, vc = (Lt[C] - latMin) / pasLat;
      const det = (vb - va) * (uc - ua) - (vc - va) * (ub - ua);
      if (Math.abs(det) < 1e-9) continue; // triangle vu par la tranche
      for (let i = Math.max(0, Math.ceil(Math.min(ua, ub, uc))); i <= Math.min(nbS - 1, Math.floor(Math.max(ua, ub, uc))); i++) {
        for (let j = Math.max(0, Math.ceil(Math.min(va, vb, vc))); j <= Math.min(nbLat - 1, Math.floor(Math.max(va, vb, vc))); j++) {
          const wb = ((j - va) * (uc - ua) - (vc - va) * (i - ua)) / det;
          const wc = ((vb - va) * (i - ua) - (j - va) * (ub - ua)) / det;
          if (wb < -1e-6 || wc < -1e-6 || wb + wc > 1 + 1e-6) continue;
          const y = Y[A] + (Y[B] - Y[A]) * wb + (Y[C] - Y[A]) * wc;
          if (y > h[i * nbLat + j]) h[i * nbLat + j] = y;
        }
      }
    }
    const debut = (iMuseau - avantMuseau + N) % N;
    const surface = { debut, nb: nbS, latMin, pasLat, nbLat, h };
    piste.surfaces.push(surface);

    // les yeux (œil de dessin animé fait dans Blender), qui regardent les karts arriver
    if (oeil) {
      const g = oeil.geometry.clone();
      g.computeBoundingSphere();
      const c = g.boundingSphere.center;
      g.translate(-c.x, -c.y, -c.z).rotateY(Math.PI / 2); // la pupille (-X dans le modèle) regarde vers +Z
      g.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x333333 });
      const { u: ue, ecart, rayon } = DIPLO.yeux;
      const se = ue * DIPLO.longueur;
      const ie = Math.round(se / pas);
      for (const cote of [-1, 1]) {
        const l = cote * (interpole(DIPLO.voie, ue) + ecart);
        const hy = piste.hauteurTremplin((iMuseau + ie) % N, l).h;
        const o = new THREE.Mesh(g, mat);
        o.scale.setScalar(rayon);
        plier(se, l, hy + rayon * 0.55, o.position);
        const cible = plier(se - 30, l * 0.4, hy + 4, new THREE.Vector3());
        o.lookAt(cible);
        groupe.add(o);
      }
    }
    Object.assign(piste.diplodocus, { objet: dino, surface });
  });
}

/** Petits sentiers de pierres plates qui partent du bord de la route vers la forêt. */
function sentiers(groupe, piste, rnd, nombre) {
  const carres = [], ronds = [];
  for (let n = 0; n < nombre; n++) {
    const j = Math.floor(rnd() * piste.N);
    const cote = rnd() < 0.5 ? 1 : -1;
    const dx = piste.cx[(j + 1) % piste.N] - piste.cx[j], dz = piste.cz[(j + 1) % piste.N] - piste.cz[j]; // le long de la route
    const lt = Math.hypot(dx, dz) || 1;
    for (let k = 0; k < 5; k++) {
      const lat = cote * (piste.demi + 1.4 + k * 1.35);
      const zig = (k % 2 ? 0.35 : -0.35) + (rnd() - 0.5) * 0.3;
      const x = piste.cx[j] + piste.nx[j] * lat + (dx / lt) * zig;
      const z = piste.cz[j] + piste.nz[j] * lat + (dz / lt) * zig;
      if (piste.distanceCentre(x, z) < piste.demi + 0.8) break; // on ne recoupe pas la route
      (k % 2 ? ronds : carres).push({ x, z, s: 0.85 + rnd() * 0.3, r: rnd() * 6.3 });
    }
  }
  planter(groupe, "RockPath_Square_Small_2", carres);
  planter(groupe, "RockPath_Round_Small_1", ronds);
}

// ---------------------------------------------------------------------------
/**
 * Grosse tête de T-rex (modèle 3D généré par IA puis coloré) posée en travers de la route.
 * La route se resserre entre deux rangées de rochers jusqu'à un tremplin qui envoie les
 * karts dans la gueule : le T-rex les croque puis les recrache derrière lui (voir course.js).
 */
// dans le modèle, la gueule ne regarde pas exactement +x et n'est pas centrée : on corrige
const ROTATION_GUEULE = 0.5; // réglé à l'œil depuis la vue du kart (le modèle n'est pas symétrique)
const DECALAGE_GUEULE = -1; // mètres vers la droite de la route, réglé depuis le tremplin (là où on vise la gueule)

// bord avant de la gueule (lèvres et dents), en mètres avant le centre de la tête : mesuré sur
// le modèle placé (≈ 11,8 m) ; remplacé par la vraie mesure quand le modèle est chargé
const GUEULE_AVANT = 12;
const ELAN_GUEULE = 9; // mètres entre le haut du tremplin et la gueule : on y arrive en haut du saut

/** Indice d'une ligne droite assez longue avant (et un peu après) un point, près d'une position voulue. */
function ligneDroiteLongue(piste, fraction, avant, apres, fenetre) {
  const N = piste.N;
  const enveloppe = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const nAvant = Math.round(avant / piste.pas), nApres = Math.round(apres / piste.pas);
  let meilleur = Math.floor(N * fraction), cMin = Infinity;
  for (let k = -Math.floor(N * fenetre); k <= N * fenetre; k++) {
    const j = (Math.floor(N * fraction) + k + N) % N;
    if (piste.tremplins.some((t) => ((j - t.debut + N) % N) < nAvant + 10 || ((t.debut - j + N) % N) < nApres + 10)) continue;
    // virage total sur toute la longueur (une courbe en S compte aussi)
    let c = 0;
    for (let m = -nAvant; m < nApres; m++) c += Math.abs(enveloppe(piste.angleA((j + m + 1 + N) % N) - piste.angleA((j + m + N) % N)));
    c += Math.abs(k) * 0.0005;
    if (c < cMin) { cMin = c; meilleur = j; }
  }
  return meilleur;
}

function teteTrex(piste, groupe) {
  const N = piste.N;
  const nbRampe = Math.max(1, Math.round(4.5 / piste.pas));
  // il faut ~95 m de ligne droite avant la tête (entonnoir + tremplin + gueule) et ~30 m après (on est recraché)
  const i = ligneDroiteLongue(piste, 0.63, GUEULE_AVANT + ELAN_GUEULE + 4.5 + 70, 30, 0.06);
  const debutRampe = (i - Math.round((GUEULE_AVANT + ELAN_GUEULE) / piste.pas) - nbRampe + N) % N;
  const debutEntonnoir = (debutRampe - Math.round(55 / piste.pas) + N) % N;
  const DEMI_ETROIT = 3.6;
  piste.retrecissements.push({ debut: debutEntonnoir, fin: i, demiMin: DEMI_ETROIT });
  groupe.add(piste.ajouterTremplin({ debut: debutRampe, nb: nbRampe, lateral: 0, demiLargeur: DEMI_ETROIT, hauteur: 1.3 }));
  // distanceGueule : distance (le long de la piste, avant l'indice) du bord avant de la gueule
  piste.teteTrex = { indice: i, recrache: (i + Math.round(26 / piste.pas)) % N, distanceGueule: GUEULE_AVANT };

  // rochers le long de l'entonnoir (ce sont eux qui "font" les murs) : vrais rochers du pack
  // Quaternius, trois formes en alternance (les murs physiques viennent de piste.limiteLaterale)
  const ROCHERS = ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"];
  const rochers = ROCHERS.map(() => []);
  const longueur = (i - debutEntonnoir + N) % N;
  for (let k = 0; k <= longueur; k += 2) {
    const j = (debutEntonnoir + k) % N;
    const lim = piste.limiteLaterale(j) + 1.6;
    if (lim > piste.demi + piste.marge) continue;
    for (const s of [1, -1]) {
      rochers[(k / 2 + (s > 0 ? 0 : 1)) % 3].push({ x: piste.cx[j] + piste.nx[j] * s * lim, z: piste.cz[j] + piste.nz[j] * s * lim, s: 0.9 + ((k * 7) % 5) * 0.08, y: -0.2, r: k * 1.7 + s });
    }
  }
  ROCHERS.forEach((nom, n) => planter(groupe, nom, rochers[n]));

  // la tête : chargée en arrière-plan
  new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "dinos/tete-trex.glb").then((gltf) => {
    const modele = gltf.scene;
    modele.traverse((o) => {
      if (o.isMesh) {
        o.geometry.computeVertexNormals();
        const map = o.material.map; // texture projetée depuis l'image Gemini (Blender)
        if (map) map.anisotropy = 4;
        o.material = map ? new THREE.MeshLambertMaterial({ map, flatShading: true }) : new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
      }
    });
    // le modèle fait ~2 unités de large, gueule vers +x, socle en bas
    const boite = new THREE.Box3().setFromObject(modele);
    const echelle = 17;
    // centrage automatique : on cherche le milieu de la gueule (les points tout à l'avant)
    modele.updateMatrixWorld(true);
    const pts = [];
    const v = new THREE.Vector3();
    modele.traverse((o) => {
      if (!o.isMesh) return;
      const pa = o.geometry.attributes.position;
      for (let k = 0; k < pa.count; k++) {
        v.fromBufferAttribute(pa, k).applyMatrix4(o.matrixWorld);
        pts.push(v.x, v.y, v.z);
      }
    });
    const hautMin = boite.min.y + (boite.max.y - boite.min.y) * 0.25;
    const tete = new THREE.Group();
    tete.add(modele);
    modele.scale.setScalar(echelle);
    modele.position.y = -boite.min.y * echelle - 0.6; // socle un peu enfoncé dans le sol
    tete.position.set(piste.cx[i] + piste.nx[i] * DECALAGE_GUEULE, 0, piste.cz[i] + piste.nz[i] * DECALAGE_GUEULE);
    // oriente la tête (angle de la gueule dans le modèle) et centre le milieu de la gueule sur la route
    const placer = (angleGueule) => {
      const d = new THREE.Vector2(Math.cos(angleGueule), Math.sin(angleGueule));
      const perp = new THREE.Vector2(-d.y, d.x);
      let smax = -Infinity;
      for (let k = 0; k < pts.length; k += 3) smax = Math.max(smax, pts[k] * d.x + pts[k + 2] * d.y);
      let somme = 0, n = 0;
      for (let k = 0; k < pts.length; k += 3) {
        const sk = pts[k] * d.x + pts[k + 2] * d.y;
        if (sk > smax - 0.35 && pts[k + 1] > hautMin) { somme += pts[k] * perp.x + pts[k + 2] * perp.y; n++; }
      }
      const milieu = n ? somme / n : 0;
      modele.position.x = -perp.x * milieu * echelle;
      modele.position.z = -perp.y * milieu * echelle;
      tete.rotation.y = piste.angleA(i) + Math.PI / 2 + angleGueule; // gueule tournée vers les karts qui arrivent
      piste.teteTrex.distanceGueule = mesurerGueule();
    };
    // où est vraiment le bord avant de la gueule (lèvres, dents) le long de la route ?
    const mesurerGueule = () => {
      tete.updateMatrixWorld(true);
      let sMin = Infinity;
      modele.traverse((o) => {
        if (!o.isMesh) return;
        const pa = o.geometry.attributes.position;
        for (let k = 0; k < pa.count; k++) {
          v.fromBufferAttribute(pa, k).applyMatrix4(o.matrixWorld);
          if (v.y < 1 || v.y > 10) continue; // pas le socle posé par terre
          const dx = v.x - piste.cx[i], dz = v.z - piste.cz[i];
          if (Math.abs(dx * piste.nx[i] + dz * piste.nz[i]) > 4) continue; // devant la route seulement
          sMin = Math.min(sMin, dx * piste.tx[i] + dz * piste.tz[i]);
        }
      });
      return Number.isFinite(sMin) ? -sMin : GUEULE_AVANT;
    };
    placer(ROTATION_GUEULE);
    piste.teteTrex.objet = tete;
    piste.teteTrex.placer = placer;
    groupe.add(tete);
  });
}

// ---------------------------------------------------------------------------
// Looping dans la ligne droite du départ (tout est dans looping.js)
import { looping } from "./looping.js";
function decorLooping(piste, groupe) {
  looping(piste, groupe);
}

/**
 * Ravin du ptérodactyle sur la ligne droite du haut (0,175 → 0,275 du tour) : la route
 * s'arrête au bord du vide, un ptérodactyle attrape chaque kart et le dépose en face (ptero.js).
 */
function ravinDuPtero(groupe, piste) {
  installerRavin(groupe, piste, { debut: Math.round(piste.N * 0.207) });
}
