import * as THREE from "three";
import { instances, positions } from "./decor.js";
import { fusion, matCouleurs, nuages } from "./decors-circuits.js";

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
export function decorDino(groupe, piste, rnd, horsPiste) {
  const couleursDinos = [0x69db7c, 0x4dabf7, 0xb197fc, 0xffa94d, 0x38d9a9, 0xf783ac];

  // grand dino à long cou
  const grandCou = fusion([
    { geo: new THREE.SphereGeometry(1, 10, 8).scale(1.4, 1.1, 2.2).translate(0, 2.6, 0), couleur: B },
    ...[[-0.8, 1.2], [0.8, 1.2], [-0.8, -1.2], [0.8, -1.2]].map(([x, z]) => ({ geo: new THREE.CylinderGeometry(0.35, 0.4, 2.2, 7).translate(x, 1.1, z), couleur: B })),
    { geo: new THREE.CylinderGeometry(0.3, 0.5, 4.2, 7).rotateX(0.55).translate(0, 4.6, 2.6), couleur: B },
    { geo: new THREE.BoxGeometry(0.7, 0.6, 1.2).translate(0, 6.4, 3.9), couleur: B },
    { geo: new THREE.IcosahedronGeometry(0.1, 0).translate(0.36, 6.6, 4.1), couleur: N },
    { geo: new THREE.IcosahedronGeometry(0.1, 0).translate(-0.36, 6.6, 4.1), couleur: N },
    { geo: new THREE.ConeGeometry(0.5, 4, 7).rotateX(-Math.PI / 2 - 0.3).translate(0, 2.2, -3.6), couleur: B },
  ]);
  const grands = positions(piste, rnd, 10, horsPiste + 8, 80).map((p) => ({ ...p, s: 1.6 + rnd() * 0.8, r: versPiste(piste, p) + Math.PI / 2, couleur: auHasard(rnd, couleursDinos) }));
  groupe.add(instances(grandCou, matCouleurs(), grands));

  // T-rex
  const trex = fusion([
    { geo: new THREE.SphereGeometry(1, 10, 8).scale(1, 1.1, 1.7).rotateX(-0.5).translate(0, 2.6, 0), couleur: B },
    { geo: new THREE.BoxGeometry(1.2, 1.1, 1.8).translate(0, 4.0, 1.5), couleur: B },
    { geo: new THREE.BoxGeometry(1.1, 0.35, 1.5).translate(0, 3.25, 1.6), couleur: B },
    ...[-0.3, -0.1, 0.1, 0.3].map((x) => ({ geo: new THREE.ConeGeometry(0.07, 0.2, 4).rotateX(Math.PI).translate(x, 3.5, 2.3), couleur: 0xffffff })),
    { geo: new THREE.IcosahedronGeometry(0.12, 0).translate(0.5, 4.3, 1.9), couleur: N },
    { geo: new THREE.IcosahedronGeometry(0.12, 0).translate(-0.5, 4.3, 1.9), couleur: N },
    { geo: new THREE.CylinderGeometry(0.4, 0.3, 2.2, 7).translate(0.6, 1.1, -0.2), couleur: B },
    { geo: new THREE.CylinderGeometry(0.4, 0.3, 2.2, 7).translate(-0.6, 1.1, -0.2), couleur: B },
    { geo: new THREE.BoxGeometry(0.15, 0.15, 0.6).translate(0.6, 2.8, 1.2), couleur: B },
    { geo: new THREE.BoxGeometry(0.15, 0.15, 0.6).translate(-0.6, 2.8, 1.2), couleur: B },
    { geo: new THREE.ConeGeometry(0.6, 3.5, 7).rotateX(-Math.PI / 2 + 0.3).translate(0, 2.2, -2.4), couleur: B },
  ]);
  const trexs = positions(piste, rnd, 10, horsPiste + 4, 60).map((p) => ({ ...p, s: 1.1 + rnd() * 0.5, r: versPiste(piste, p), couleur: auHasard(rnd, couleursDinos) }));
  groupe.add(instances(trex, matCouleurs(), trexs));

  // arbres préhistoriques (tronc + parasol de feuilles) et fougères
  const arbre = fusion([
    { geo: new THREE.CylinderGeometry(0.35, 0.55, 6, 6).translate(0, 3, 0), couleur: 0x8b5a2b },
    { geo: new THREE.ConeGeometry(3, 1.4, 8).translate(0, 6.6, 0), couleur: 0x2b8a3e },
    { geo: new THREE.ConeGeometry(2.2, 1.2, 8).translate(0, 7.5, 0), couleur: 0x37b24d },
  ]);
  groupe.add(instances(arbre, matCouleurs(), positions(piste, rnd, 150, horsPiste + 1, 130).map((p) => ({ ...p, s: 0.8 + rnd() * 0.6, r: rnd() * 6 }))));
  const fougere = fusion(
    Array.from({ length: 7 }, (_, k) => ({
      geo: new THREE.BoxGeometry(0.35, 0.05, 1.8).translate(0, 0, 0.9).rotateX(-0.6).rotateY((k / 7) * Math.PI * 2).translate(0, 0.2, 0),
      couleur: k % 2 ? 0x2f9e44 : 0x51cf66,
    }))
  );
  groupe.add(instances(fougere, matCouleurs(), positions(piste, rnd, 160, piste.demi + 2.5, 60).map((p) => ({ ...p, s: 0.8 + rnd() * 0.8, r: rnd() * 6 }))));

  // nids d'œufs
  const nid = fusion([
    { geo: new THREE.TorusGeometry(1, 0.35, 5, 10).rotateX(Math.PI / 2).translate(0, 0.3, 0), couleur: 0x9c7a4a },
    { geo: new THREE.SphereGeometry(0.45, 8, 6).scale(1, 1.35, 1).translate(-0.35, 0.6, 0), couleur: 0xfff3bf },
    { geo: new THREE.SphereGeometry(0.45, 8, 6).scale(1, 1.35, 1).translate(0.35, 0.6, 0.15), couleur: 0xd3f9d8 },
    { geo: new THREE.SphereGeometry(0.45, 8, 6).scale(1, 1.35, 1).translate(0, 0.6, -0.4), couleur: 0xffe8cc },
  ]);
  groupe.add(instances(nid, matCouleurs(), positions(piste, rnd, 14, horsPiste, 40).map((p) => ({ ...p, s: 1, r: rnd() * 6 }))));

  // rochers
  groupe.add(instances(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x8d7b68, flatShading: true }),
    positions(piste, rnd, 50, horsPiste, 110).map((p) => ({ ...p, s: 0.6 + rnd() * 1.6, sy: 0.6 + rnd() * 0.5, r: rnd() * 6 }))));

  // volcan au loin avec sa fumée
  const angleVolcan = rnd() * Math.PI * 2;
  const xV = piste.centre.x + Math.cos(angleVolcan) * (piste.rayon + 260);
  const zV = piste.centre.z + Math.sin(angleVolcan) * (piste.rayon + 260);
  const volcan = fusion([
    { geo: new THREE.CylinderGeometry(30, 110, 120, 10).translate(0, 60, 0), couleur: 0x6b4f3a },
    { geo: new THREE.CylinderGeometry(26, 30, 6, 10).translate(0, 121, 0), couleur: 0xff6b00 },
  ]);
  groupe.add(instances(volcan, matCouleurs(), [{ x: xV, z: zV, s: 1 }]));
  const collines = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - angleVolcan), Math.cos(a - angleVolcan))) < 0.35) continue;
    const r = piste.rayon + 230 + rnd() * 70;
    collines.push({ x: piste.centre.x + Math.cos(a) * r, y: -8, z: piste.centre.z + Math.sin(a) * r, s: 70 + rnd() * 50, sy: 30 + rnd() * 25, couleur: [0x5c940d, 0x74b816, 0x82c91e][i % 3] });
  }
  groupe.add(instances(new THREE.SphereGeometry(1, 14, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), collines));
  const fumee = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x9a9a9a, fog: false, transparent: true, opacity: 0.8 }), 14);
  groupe.add(fumee);
  nuages(groupe, piste, rnd);

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
  };
}

// ---------------------------------------------------------------------------
export function decorJouets(groupe, piste, rnd, horsPiste) {
  const vives = [0xff6b6b, 0xffd43b, 0x4dabf7, 0x51cf66, 0xf783ac, 0xff922b, 0x9775fa];

  // grosses briques à picots
  const picots = [];
  for (const x of [-1.5, -0.5, 0.5, 1.5]) for (const z of [-0.5, 0.5]) picots.push({ geo: new THREE.CylinderGeometry(0.32, 0.32, 0.3, 10).translate(x, 2.55, z), couleur: B });
  const brique = fusion([{ geo: new THREE.BoxGeometry(4, 2.4, 2).translate(0, 1.2, 0), couleur: B }, ...picots]);
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
    { geo: new THREE.BoxGeometry(2, 2, 2).translate(0, 1, 0), couleur: 0xf1d3a1 },
    { geo: new THREE.BoxGeometry(1.4, 1.4, 2.04).translate(0, 1, 0), couleur: B },
    { geo: new THREE.BoxGeometry(2.04, 1.4, 1.4).translate(0, 1, 0), couleur: B },
  ]);
  groupe.add(instances(cube, matCouleurs(), cubes));

  // crayons géants couchés
  const crayon = fusion([
    { geo: new THREE.CylinderGeometry(0.5, 0.5, 6, 6).rotateZ(Math.PI / 2).translate(0, 0.5, 0), couleur: B },
    { geo: new THREE.ConeGeometry(0.5, 1.2, 6).rotateZ(-Math.PI / 2).translate(3.6, 0.5, 0), couleur: 0xf1d3a1 },
    { geo: new THREE.ConeGeometry(0.17, 0.4, 6).rotateZ(-Math.PI / 2).translate(4.05, 0.5, 0), couleur: B },
    { geo: new THREE.CylinderGeometry(0.52, 0.52, 0.5, 6).rotateZ(Math.PI / 2).translate(-3.2, 0.5, 0), couleur: 0xffc9c9 },
  ]);
  groupe.add(instances(crayon, matCouleurs(), positions(piste, rnd, 30, horsPiste, 60).map((p) => ({ ...p, s: 1, r: rnd() * 6, couleur: auHasard(rnd, vives) }))));

  // ballons à bande blanche
  const ballon = fusion([
    { geo: new THREE.IcosahedronGeometry(1.4, 1).translate(0, 1.4, 0), couleur: B },
    { geo: new THREE.TorusGeometry(1.38, 0.18, 4, 16).translate(0, 1.4, 0), couleur: 0xffffff },
  ]);
  groupe.add(instances(ballon, matCouleurs(), positions(piste, rnd, 30, horsPiste, 70).map((p) => ({ ...p, s: 0.8 + rnd() * 0.6, r: rnd() * 6, couleur: auHasard(rnd, vives) }))));

  // nounours assis, tournés vers la piste
  const brun = 0xc08552, clair = 0xf1d3a1;
  const nounours = fusion([
    { geo: new THREE.SphereGeometry(1.2, 10, 8).scale(1, 1.15, 0.9).translate(0, 1.3, 0), couleur: brun },
    { geo: new THREE.SphereGeometry(0.75, 10, 8).scale(1, 1.1, 0.4).translate(0, 1.2, 0.75), couleur: clair },
    { geo: new THREE.SphereGeometry(0.9, 10, 8).translate(0, 3.0, 0), couleur: brun },
    { geo: new THREE.SphereGeometry(0.35, 8, 6).translate(0, 2.85, 0.8), couleur: clair },
    { geo: new THREE.IcosahedronGeometry(0.12, 0).translate(0, 2.95, 1.12), couleur: N },
    { geo: new THREE.IcosahedronGeometry(0.1, 0).translate(0.32, 3.25, 0.78), couleur: N },
    { geo: new THREE.IcosahedronGeometry(0.1, 0).translate(-0.32, 3.25, 0.78), couleur: N },
    { geo: new THREE.SphereGeometry(0.35, 8, 6).translate(0.65, 3.75, 0), couleur: brun },
    { geo: new THREE.SphereGeometry(0.35, 8, 6).translate(-0.65, 3.75, 0), couleur: brun },
    { geo: new THREE.SphereGeometry(0.4, 8, 6).scale(1, 1.6, 1).translate(1.2, 1.7, 0.3), couleur: brun },
    { geo: new THREE.SphereGeometry(0.4, 8, 6).scale(1, 1.6, 1).translate(-1.2, 1.7, 0.3), couleur: brun },
    { geo: new THREE.SphereGeometry(0.5, 8, 6).scale(1, 0.9, 1.6).translate(0.6, 0.45, 0.9), couleur: brun },
    { geo: new THREE.SphereGeometry(0.5, 8, 6).scale(1, 0.9, 1.6).translate(-0.6, 0.45, 0.9), couleur: brun },
    { geo: new THREE.BoxGeometry(1.0, 0.25, 0.25).translate(0, 2.25, 0.7), couleur: 0xff6b6b }, // nœud papillon
  ]);
  groupe.add(instances(nounours, matCouleurs(), positions(piste, rnd, 14, horsPiste, 45).map((p) => ({ ...p, s: 1.3, r: versPiste(piste, p) }))));

  // toupies qui tournent
  const toupie = fusion([
    { geo: new THREE.ConeGeometry(1, 1.2, 10).rotateX(Math.PI).translate(0, 0.6, 0), couleur: B },
    { geo: new THREE.CylinderGeometry(1.05, 1.05, 0.25, 10).translate(0, 1.25, 0), couleur: 0xffffff },
    { geo: new THREE.ConeGeometry(1, 0.6, 10).translate(0, 1.65, 0), couleur: B },
    { geo: new THREE.CylinderGeometry(0.1, 0.1, 0.7, 6).translate(0, 2.2, 0), couleur: 0x8b5a2b },
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
    { geo: new THREE.BoxGeometry(60, 1, 40).translate(0, 0.5, 0), couleur: B },
    { geo: new THREE.BoxGeometry(58, 0.9, 38).translate(1.2, 0.5, 0), couleur: 0xfffaf0 },
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
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const sol = new THREE.Mesh(new THREE.BoxGeometry(30, 2, 14), mat(0x343a40));
  sol.position.set(0, 1, 0);
  const fond = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 1), mat(0x212529));
  fond.position.set(0, 9, -6.5);
  const ecran = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), new THREE.MeshBasicMaterial({ map: textureEcran(), fog: false }));
  ecran.position.set(0, 10, -5.9);
  scene.add(sol, fond, ecran);
  // enceintes
  const enceinte = fusion([
    { geo: new THREE.BoxGeometry(3, 4, 2.4).translate(0, 2, 0), couleur: 0x1a1a1a },
    { geo: new THREE.CylinderGeometry(0.9, 0.9, 0.1, 12).rotateX(Math.PI / 2).translate(0, 2.6, 1.22), couleur: 0x555555 },
    { geo: new THREE.CylinderGeometry(0.45, 0.45, 0.1, 12).rotateX(Math.PI / 2).translate(0, 1.0, 1.22), couleur: 0x555555 },
  ]);
  scene.add(instances(enceinte, matCouleurs(), [
    { x: -13, y: 2, z: 2, s: 1 }, { x: 13, y: 2, z: 2, s: 1 }, { x: -13, y: 6, z: 2, s: 1 }, { x: 13, y: 6, z: 2, s: 1 },
  ]));
  // boule à facettes
  const boule = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshLambertMaterial({ color: 0xdee2e6, flatShading: true, emissive: 0x333333 }));
  boule.position.set(0, 15.5, 2);
  scene.add(boule);
  groupe.add(scene);

  // tours de lumière avec projecteurs colorés qui balaient le ciel
  const projecteurs = [];
  const geoFaisceau = new THREE.ConeGeometry(4, 40, 12, 1, true).translate(0, -20, 0).rotateX(Math.PI); // pointe en bas
  for (const p of positions(piste, rnd, 10, horsPiste + 2, 45)) {
    const mat2 = new THREE.MeshLambertMaterial({ color: 0x495057 });
    const poteau = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 10, 6), mat2);
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
    { geo: new THREE.SphereGeometry(0.5, 8, 6).scale(1.3, 1, 0.5).translate(0, 0.5, 0), couleur: B },
    { geo: new THREE.BoxGeometry(0.14, 2.2, 0.14).translate(0.58, 1.6, 0), couleur: B },
    { geo: new THREE.BoxGeometry(0.7, 0.3, 0.14).rotateZ(-0.4).translate(0.85, 2.55, 0), couleur: B },
  ]);
  const notes = positions(piste, rnd, 40, horsPiste, 70).map((p) => ({ ...p, y: 3 + rnd() * 6, s: 1 + rnd(), r: rnd() * 6, couleur: auHasard(rnd, neons) }));
  const mesNotes = instances(note, new THREE.MeshBasicMaterial({ vertexColors: true }), notes);
  groupe.add(mesNotes);

  // ballons
  const ballon = fusion([
    { geo: new THREE.SphereGeometry(0.9, 10, 8).scale(1, 1.2, 1).translate(0, 4, 0), couleur: B },
    { geo: new THREE.CylinderGeometry(0.02, 0.02, 3, 3).translate(0, 1.5, 0), couleur: 0xdddddd },
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
