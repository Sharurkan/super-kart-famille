import * as THREE from "three";
import { decorPlage, decorNeige } from "./decors-circuits.js";
import { decorDino, decorJouets, decorConcert } from "./decors-themes.js";

/** Générateur aléatoire reproductible (même décor à chaque partie). */
function aleatoire(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ciel(def) {
  const geo = new THREE.SphereGeometry(850, 24, 12);
  const haut = new THREE.Color(def.ciel.haut), horizon = new THREE.Color(def.ciel.horizon);
  const pos = geo.attributes.position;
  const col = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) / 850) * 2.2, 0, 1);
    c.copy(horizon).lerp(haut, t);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -1;
  return m;
}

/** Remplit un InstancedMesh avec une liste de {x, y, z, s, sy, r, couleur}. */
export function instances(geo, mat, liste) {
  const m = new THREE.InstancedMesh(geo, mat, liste.length);
  const o = new THREE.Object3D();
  const c = new THREE.Color();
  liste.forEach((p, i) => {
    o.position.set(p.x, p.y ?? 0, p.z);
    o.rotation.set(0, p.r ?? 0, 0);
    o.scale.set(p.s, p.sy ?? p.s, p.s);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
    if (p.couleur !== undefined) m.setColorAt(i, c.set(p.couleur));
  });
  return m;
}

/** Tire des positions au hasard autour du circuit, hors de la piste. */
export function positions(piste, rnd, nombre, distMin, distMax) {
  const res = [];
  const R = piste.rayon + distMax;
  let essais = 0;
  while (res.length < nombre && essais++ < nombre * 40) {
    const x = piste.centre.x + (rnd() * 2 - 1) * R;
    const z = piste.centre.z + (rnd() * 2 - 1) * R;
    const d = piste.distanceCentre(x, z);
    if (d > distMin && d < distMax) res.push({ x, z, d });
  }
  return res;
}

export function construireDecor(def, piste) {
  const groupe = new THREE.Group();
  const rnd = aleatoire(42);
  const horsPiste = piste.demi + piste.marge + 2.5;

  const leCiel = ciel(def);
  groupe.add(leCiel);

  // sol
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshLambertMaterial({ color: def.sol }));
  sol.rotation.x = -Math.PI / 2;
  sol.position.set(piste.centre.x, 0, piste.centre.z);
  groupe.add(sol);

  const DECORS = { prairie: decorPrairie, plage: decorPlage, neige: decorNeige, dino: decorDino, jouets: decorJouets, concert: decorConcert };
  const animer = DECORS[def.decor]?.(groupe, piste, rnd, horsPiste);

  return { groupe, ciel: leCiel, animer: animer ?? (() => {}) };
}

function decorPrairie(groupe, piste, rnd, horsPiste) {
  const verts = [0x2f9e44, 0x37b24d, 0x40c057, 0x2b8a3e, 0x51cf66];

  // arbres ronds (tronc + feuillage partagent la même liste)
  const arbres = positions(piste, rnd, 220, horsPiste + 2, 140).map((p) => ({
    ...p, s: 0.9 + rnd() * 0.7, r: rnd() * 6, couleur: verts[Math.floor(rnd() * verts.length)],
  }));
  const troncs = new THREE.CylinderGeometry(0.35, 0.55, 2.4, 6).translate(0, 1.2, 0);
  const feuillage = new THREE.IcosahedronGeometry(2.3, 0).translate(0, 3.8, 0);
  groupe.add(instances(troncs, new THREE.MeshLambertMaterial({ color: 0x8b5a2b, flatShading: true }),
    arbres.map(({ couleur, ...p }) => p)));
  groupe.add(instances(feuillage, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), arbres));

  // buissons
  const buissons = positions(piste, rnd, 90, horsPiste, 90);
  groupe.add(instances(new THREE.IcosahedronGeometry(1, 0).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    buissons.map((p) => ({ ...p, s: 0.8 + rnd() * 0.9, sy: 0.7 + rnd() * 0.4, r: rnd() * 6, couleur: verts[Math.floor(rnd() * verts.length)] }))));

  // fleurs (aussi dans l'herbe entre la route et la barrière)
  const couleursFleurs = [0xff6b6b, 0xffd43b, 0xffffff, 0xf783ac, 0xb197fc, 0xff922b];
  const fleurs = [
    ...positions(piste, rnd, 260, piste.demi + 2, piste.demi + piste.marge - 0.5),
    ...positions(piste, rnd, 260, horsPiste, 60),
  ];
  groupe.add(instances(new THREE.IcosahedronGeometry(0.28, 0).translate(0, 0.25, 0),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    fleurs.map((p) => ({ ...p, s: 0.8 + rnd() * 0.6, couleur: couleursFleurs[Math.floor(rnd() * couleursFleurs.length)] }))));

  // collines lointaines
  const collines = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rnd() * 0.3;
    const r = piste.rayon + 230 + rnd() * 80;
    const s = 70 + rnd() * 60;
    collines.push({ x: piste.centre.x + Math.cos(a) * r, y: -8, z: piste.centre.z + Math.sin(a) * r, s, sy: 25 + rnd() * 30, couleur: [0x5fb83f, 0x4ea836, 0x74c94f][i % 3] });
  }
  groupe.add(instances(new THREE.SphereGeometry(1, 14, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), collines));

  // nuages
  const nuages = [];
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 150 + rnd() * 300;
    const x = piste.centre.x + Math.cos(a) * r, z = piste.centre.z + Math.sin(a) * r, y = 70 + rnd() * 40;
    for (let k = 0; k < 4; k++)
      nuages.push({ x: x + (k - 1.5) * 9 + rnd() * 4, y: y + rnd() * 4, z: z + rnd() * 6, s: 7 + rnd() * 5, sy: 4 + rnd() * 3 });
  }
  groupe.add(instances(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), nuages));
}
