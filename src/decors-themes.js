import * as THREE from "three";
import { instances, positions, boiteRonde } from "./decor.js";
import { fusion, matCouleurs, nuages } from "./decors-circuits.js";
import { creerDino } from "./dinos.js";

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

  // arbres préhistoriques (tronc + parasol de feuilles) et fougères
  const arbre = fusion([
    { geo: new THREE.CylinderGeometry(0.35, 0.55, 6, 12).translate(0, 3, 0), couleur: 0x8b5a2b },
    { geo: new THREE.ConeGeometry(3, 1.4, 16).translate(0, 6.6, 0), couleur: 0x2b8a3e },
    { geo: new THREE.ConeGeometry(2.2, 1.2, 16).translate(0, 7.5, 0), couleur: 0x37b24d },
  ]);
  groupe.add(instances(arbre, matCouleurs(), positions(piste, rnd, 150, horsPiste + 1, 130).map((p) => ({ ...p, s: 0.8 + rnd() * 0.6, r: rnd() * 6 }))));
  const fougere = fusion(
    Array.from({ length: 7 }, (_, k) => ({
      geo: boiteRonde(0.35, 0.05, 1.8).translate(0, 0, 0.9).rotateX(-0.6).rotateY((k / 7) * Math.PI * 2).translate(0, 0.2, 0),
      couleur: k % 2 ? 0x2f9e44 : 0x51cf66,
    }))
  );
  groupe.add(instances(fougere, matCouleurs(), positions(piste, rnd, 160, piste.demi + 2.5, 60).map((p) => ({ ...p, s: 0.8 + rnd() * 0.8, r: rnd() * 6 }))));

  // nids d'œufs
  const nid = fusion([
    { geo: new THREE.TorusGeometry(1, 0.35, 5, 10).rotateX(Math.PI / 2).translate(0, 0.3, 0), couleur: 0x9c7a4a },
    { geo: new THREE.SphereGeometry(0.45, 13, 10).scale(1, 1.35, 1).translate(-0.35, 0.6, 0), couleur: 0xfff3bf },
    { geo: new THREE.SphereGeometry(0.45, 13, 10).scale(1, 1.35, 1).translate(0.35, 0.6, 0.15), couleur: 0xd3f9d8 },
    { geo: new THREE.SphereGeometry(0.45, 13, 10).scale(1, 1.35, 1).translate(0, 0.6, -0.4), couleur: 0xffe8cc },
  ]);
  groupe.add(instances(nid, matCouleurs(), positions(piste, rnd, 14, horsPiste, 40).map((p) => ({ ...p, s: 1, r: rnd() * 6 }))));

  // rochers
  groupe.add(instances(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: 0x8d7b68, flatShading: false }),
    positions(piste, rnd, 50, horsPiste, 110).map((p) => ({ ...p, s: 0.6 + rnd() * 1.6, sy: 0.6 + rnd() * 0.5, r: rnd() * 6 }))));

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
  const tunnel = tunnelTrex(piste);
  groupe.add(tunnel);
  diplodocus(piste, groupe, [tunnel.userData.indice]);

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
 * Diplodocus couché le long de la route : sa tête est posée au sol, un tremplin permet
 * de sauter sur son cou, on roule sur son dos et on redescend par sa queue.
 * Le modèle (pack Quaternius) est plié une fois pour toutes, puis "figé" en un objet
 * fixe ; on mesure ensuite la hauteur de son dos pour pouvoir rouler dessus.
 */
async function diplodocus(piste, groupe, eviter) {
  const N = piste.N;
  const i0 = ligneDroite(piste, 0.2, eviter);
  const LAT = -(piste.demi - 4); // côté droit de la route : l'autre moitié reste libre

  const { objet } = await creerDino("Apatosaurus", { hauteur: 15, animation: "Idle" });
  const os = {};
  objet.traverse((o) => { if (o.isBone) os[o.name] = o; });
  const v = new THREE.Vector3();
  const hauteurDe = (b) => { objet.updateMatrixWorld(true); return b.getWorldPosition(v).y; };

  // plie un os autour de son axe X pour amener un autre os à la hauteur voulue
  const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  const plier = (osAPlier, osCible, hauteurVoulue) => {
    const depart = osAPlier.quaternion.clone();
    const q = new THREE.Quaternion();
    let meilleur = { axe: AXES[0], a: 0 }, ecart = Infinity;
    for (const axe of AXES)
      for (let a = -1.7; a <= 1.7; a += 0.05) {
        osAPlier.quaternion.copy(depart).multiply(q.setFromAxisAngle(axe, a));
        const e = Math.abs(hauteurDe(osCible) - hauteurVoulue);
        if (e < ecart) { ecart = e; meilleur = { axe, a }; }
      }
    osAPlier.quaternion.copy(depart).multiply(q.setFromAxisAngle(meilleur.axe, meilleur.a));
    return meilleur;
  };
  if (os.Neck && os.Head) objet.userData.cou = plier(os.Neck, os.Head, 1.6); // tête posée au sol
  objet.userData.hauteurTete = os.Head ? hauteurDe(os.Head) : null;
  if (os.Head) os.Head.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0)); // (tête laissée telle quelle)
  // queue : chaque segment plie un peu pour que le bout touche le sol
  const queue = ["Tail1", "Tail2", "Tail3", "Tail4", "Tail5"].map((n) => os[n]).filter(Boolean);
  if (queue.length) {
    const bout = queue[queue.length - 1];
    const depart = queue.map((b) => b.quaternion.clone());
    const q = new THREE.Quaternion();
    let meilleur = { axe: AXES[0], a: 0 }, ecart = Infinity;
    for (const axe of AXES)
      for (let a = -0.6; a <= 0.6; a += 0.02) {
        queue.forEach((b, k) => b.quaternion.copy(depart[k]).multiply(q.setFromAxisAngle(axe, a)));
        const e = Math.abs(hauteurDe(bout) - 0.4);
        if (e < ecart) { ecart = e; meilleur = { axe, a }; }
      }
    queue.forEach((b, k) => b.quaternion.copy(depart[k]).multiply(q.setFromAxisAngle(meilleur.axe, meilleur.a)));
    objet.userData.queue = meilleur;
  }

  // orientation : la tête vers les karts qui arrivent, le corps le long de la route
  objet.updateMatrixWorld(true);
  const tete = (os.Head ?? objet).getWorldPosition(new THREE.Vector3());
  const boutQueue = (queue[queue.length - 1] ?? objet).getWorldPosition(new THREE.Vector3());
  const alpha = Math.atan2(tete.x - boutQueue.x, tete.z - boutQueue.z);
  objet.rotation.y = piste.angleA(i0) + Math.PI - alpha;
  objet.updateMatrixWorld(true);
  const teteMonde = (os.Head ?? objet).getWorldPosition(new THREE.Vector3());
  objet.position.set(piste.cx[i0] + piste.nx[i0] * LAT - teteMonde.x, 0, piste.cz[i0] + piste.nz[i0] * LAT - teteMonde.z);
  objet.updateMatrixWorld(true);

  // on fige la pose : un objet fixe (plus léger qu'un squelette animé), aplati en hauteur
  const APLATIR = 0.42;
  const fige = new THREE.Group();
  objet.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const pos = g.attributes.position;
    const tmp = new THREE.Vector3();
    // getVertexPosition applique le squelette : on l'appelle sur la géométrie d'origine
    const src = o.geometry.index ? o.geometry.index : null;
    for (let k = 0; k < pos.count; k++) {
      const idx = src ? src.getX(k) : k;
      o.getVertexPosition(idx, tmp);
      tmp.applyMatrix4(o.matrixWorld);
      pos.setXYZ(k, tmp.x, Math.max(0, tmp.y) * APLATIR, tmp.z); // aplati : il a l'air couché, et on peut grimper
    }
    g.deleteAttribute("skinIndex");
    g.deleteAttribute("skinWeight");
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    // faces visibles des deux côtés (le modèle converti a des faces retournées)
    const mat = o.material.clone();
    mat.side = THREE.DoubleSide;
    mat.color.multiplyScalar(1.5); // un peu plus clair que le modèle d'origine
    const m = new THREE.Mesh(g, mat);
    fige.add(m);
  });
  groupe.add(fige);

  // mesure de la hauteur du dos : rayons tirés du ciel vers le bas, sur une grille
  const boite = new THREE.Box3().setFromObject(fige);
  const { indice: iTete } = piste.localiser(teteMonde.x + objet.position.x, teteMonde.z + objet.position.z);
  let iFin = iTete;
  for (let k = 0; k < 120; k++) {
    const i = (iTete + k) % N;
    const dans = boite.containsPoint(new THREE.Vector3(piste.cx[i], boite.min.y + 0.1, piste.cz[i])) ||
      boite.distanceToPoint(new THREE.Vector3(piste.cx[i] + piste.nx[i] * LAT, (boite.min.y + boite.max.y) / 2, piste.cz[i] + piste.nz[i] * LAT)) < 1;
    if (dans) iFin = i;
  }
  const debut = (iTete - 6 + N) % N;
  const nb = ((iFin - debut + N) % N) + 8;
  const latMin = -(piste.demi + piste.marge), pasLat = 0.5;
  const nbLat = Math.round((2 * (piste.demi + piste.marge)) / pasLat) + 1;
  const h = new Float32Array(nb * nbLat);
  const rayon = new THREE.Raycaster();
  const bas = new THREE.Vector3(0, -1, 0);
  let latG = Infinity, latD = -Infinity;
  for (let a = 0; a < nb; a++) {
    const i = (debut + a) % N;
    for (let b = 0; b < nbLat; b++) {
      const l = latMin + b * pasLat;
      rayon.set(new THREE.Vector3(piste.cx[i] + piste.nx[i] * l, 80, piste.cz[i] + piste.nz[i] * l), bas);
      const touche = rayon.intersectObject(fige, true)[0];
      const y = touche ? touche.point.y : 0;
      h[a * nbLat + b] = y;
      if (y > 0.5) { latG = Math.min(latG, l); latD = Math.max(latD, l); }
    }
  }
  piste.surfaces.push({ debut, nb, latMin, pasLat, nbLat, h });
  piste.zonesIA.push({ debut: (debut - 12 + N) % N, fin: (debut + nb) % N, lateral: (latG + latD) / 2, demi: (latD - latG) / 2 + 0.5 });

  // tremplin juste avant la tête, pour sauter sur le cou
  const nbRampe = Math.max(1, Math.round(4.5 / piste.pas));
  const rampe = { debut: (iTete - nbRampe - 5 + N) % N, nb: nbRampe, lateral: LAT, demiLargeur: 3.2, hauteur: 1.2 };
  groupe.add(piste.ajouterTremplin(rampe));
  groupe.userData.diplodocus = { indice: iTete, debut, nb, lateral: LAT, cou: objet.userData.cou, queue: objet.userData.queue, hauteurTete: objet.userData.hauteurTete, os: Object.keys(os) };
}
