import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { instances, positions } from "./decor.js";
import { textureRond } from "./textures.js";

// Décors des circuits Plage et Neige.
// Un objet composé de plusieurs formes colorées = une seule géométrie (couleurs par
// sommet), dessinée ensuite en InstancedMesh : un seul appel de dessin par type d'objet.

export function fusion(parties) {
  const geos = parties.map(({ geo, couleur }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const c = new THREE.Color(couleur);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.deleteAttribute("uv");
    return g;
  });
  return mergeGeometries(geos);
}

export const matCouleurs = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const filtrer = (liste, ok) => liste.filter((p) => ok(p.x, p.z));

export function nuages(groupe, piste, rnd) {
  const liste = [];
  for (let i = 0; i < 18; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 150 + rnd() * 300;
    const x = piste.centre.x + Math.cos(a) * r, z = piste.centre.z + Math.sin(a) * r, y = 70 + rnd() * 40;
    for (let k = 0; k < 4; k++)
      liste.push({ x: x + (k - 1.5) * 9 + rnd() * 4, y: y + rnd() * 4, z: z + rnd() * 6, s: 7 + rnd() * 5, sy: 4 + rnd() * 3 });
  }
  groupe.add(instances(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), liste));
}

// ---------------------------------------------------------------------------
export function decorPlage(groupe, piste, rnd, horsPiste) {
  // la mer, à l'est du circuit
  let maxX = -Infinity;
  for (let i = 0; i < piste.N; i++) maxX = Math.max(maxX, piste.cx[i]);
  const rivage = maxX + piste.demi + piste.marge + 10;
  const surTerre = (x) => x < rivage - 4;

  const mer = new THREE.Mesh(new THREE.PlaneGeometry(900, 2400), new THREE.MeshLambertMaterial({ color: 0x1c9bef }));
  mer.rotation.x = -Math.PI / 2;
  mer.position.set(rivage + 450, 0.06, piste.centre.z);
  groupe.add(mer);
  const sableMouille = new THREE.Mesh(new THREE.PlaneGeometry(8, 2400), new THREE.MeshLambertMaterial({ color: 0xd9bd6a }));
  sableMouille.rotation.x = -Math.PI / 2;
  sableMouille.position.set(rivage - 3, 0.03, piste.centre.z);
  groupe.add(sableMouille);
  const ecume = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2400), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  ecume.rotation.x = -Math.PI / 2;
  ecume.position.set(rivage, 0.08, piste.centre.z);
  groupe.add(ecume);

  // palmiers : tronc courbé + palmes + noix de coco
  const parties = [];
  for (let k = 0; k < 5; k++)
    parties.push({ geo: new THREE.CylinderGeometry(0.28 - k * 0.03, 0.34 - k * 0.03, 1.3, 6).translate(k * k * 0.06, 0.65 + k * 1.2, 0), couleur: k % 2 ? 0x9c6b3c : 0x8b5a2b });
  const sx = 16 * 0.06, sy = 6.2;
  for (let k = 0; k < 7; k++) {
    const f = new THREE.BoxGeometry(0.5, 0.08, 3.2).translate(0, 0, 1.6).rotateX(0.45).rotateY((k / 7) * Math.PI * 2).translate(sx, sy, 0);
    parties.push({ geo: f, couleur: k % 2 ? 0x2f9e44 : 0x40c057 });
  }
  for (let k = 0; k < 3; k++)
    parties.push({ geo: new THREE.IcosahedronGeometry(0.25, 0).translate(sx + Math.cos(k * 2) * 0.35, sy - 0.3, Math.sin(k * 2) * 0.35), couleur: 0x6b4423 });
  const palmiers = filtrer(positions(piste, rnd, 130, horsPiste + 1, 110), surTerre);
  groupe.add(instances(fusion(parties), matCouleurs(), palmiers.map((p) => ({ ...p, s: 0.9 + rnd() * 0.5, r: rnd() * 6 }))));

  // parasols (mât + toile colorée) et serviettes
  const couleurs = [0xff6b6b, 0xffd43b, 0x4dabf7, 0xf783ac, 0x51cf66, 0xff922b];
  const auHasard = () => couleurs[Math.floor(rnd() * couleurs.length)];
  const parasols = filtrer(positions(piste, rnd, 40, horsPiste, 50), surTerre).map((p) => ({ ...p, s: 1, r: rnd() * 6, couleur: auHasard() }));
  groupe.add(instances(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5).translate(0, 1.3, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }),
    parasols.map(({ couleur, ...p }) => p)));
  groupe.add(instances(new THREE.ConeGeometry(1.6, 0.7, 8).translate(0, 2.6, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), parasols));
  groupe.add(instances(new THREE.BoxGeometry(1, 0.04, 1.8).translate(1.4, 0.03, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }),
    parasols.map((p) => ({ ...p, couleur: auHasard() }))));

  // ballons de plage
  const ballons = filtrer(positions(piste, rnd, 30, piste.demi + 2, 40), surTerre);
  groupe.add(instances(new THREE.IcosahedronGeometry(0.45, 1).translate(0, 0.45, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    ballons.map((p) => ({ ...p, s: 1, couleur: auHasard() }))));

  // châteaux de sable
  const sable = 0xe9c46a;
  const chateau = fusion([
    { geo: new THREE.BoxGeometry(2, 0.9, 2).translate(0, 0.45, 0), couleur: sable },
    ...[[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]].flatMap(([x, z]) => [
      { geo: new THREE.CylinderGeometry(0.3, 0.35, 1.3, 6).translate(x, 0.65, z), couleur: sable },
      { geo: new THREE.ConeGeometry(0.38, 0.5, 6).translate(x, 1.55, z), couleur: 0xd4a73f },
    ]),
    { geo: new THREE.CylinderGeometry(0.02, 0.02, 1, 4).translate(0, 1.4, 0), couleur: 0x8b5a2b },
    { geo: new THREE.BoxGeometry(0.02, 0.3, 0.4).translate(0, 1.75, 0.2), couleur: 0xff6b6b },
  ]);
  groupe.add(instances(chateau, matCouleurs(), filtrer(positions(piste, rnd, 14, horsPiste, 45), surTerre).map((p) => ({ ...p, s: 1, r: rnd() * 6 }))));

  // rochers + dunes au loin, côté terre
  groupe.add(instances(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xa8a29e, flatShading: true }),
    filtrer(positions(piste, rnd, 40, horsPiste, 120), surTerre).map((p) => ({ ...p, s: 0.6 + rnd() * 1.4, sy: 0.6 + rnd() * 0.5, r: rnd() * 6 }))));
  const dunes = [];
  for (let i = 0; i < 12; i++) {
    const a = Math.PI * 0.5 + (i / 11) * Math.PI;
    const r = piste.rayon + 220 + rnd() * 60;
    dunes.push({ x: piste.centre.x + Math.cos(a) * r, y: -6, z: piste.centre.z + Math.sin(a) * r, s: 70 + rnd() * 50, sy: 18 + rnd() * 15, couleur: [0xf3d98b, 0xeacb75, 0xf7e2a6][i % 3] });
  }
  groupe.add(instances(new THREE.SphereGeometry(1, 14, 8), new THREE.MeshLambertMaterial({ color: 0xffffff }), dunes));

  // petits bateaux
  const bateau = fusion([
    { geo: new THREE.BoxGeometry(1.4, 0.6, 3.6).translate(0, 0.3, 0), couleur: 0xffffff },
    { geo: new THREE.BoxGeometry(1.42, 0.15, 3.62).translate(0, 0.5, 0), couleur: 0xe8322f },
    { geo: new THREE.CylinderGeometry(0.06, 0.06, 3.5, 4).translate(0, 2.2, 0), couleur: 0x8b5a2b },
    { geo: new THREE.ConeGeometry(1.2, 3, 3).scale(0.15, 1, 1).translate(0, 2.4, -0.4), couleur: 0xfff3bf },
  ]);
  const bateaux = [];
  for (let i = 0; i < 6; i++) bateaux.push({ x: rivage + 30 + rnd() * 120, z: piste.centre.z + (rnd() - 0.5) * 300, s: 1.5, r: rnd() * 6 });
  const mesBateaux = instances(bateau, matCouleurs(), bateaux);
  groupe.add(mesBateaux);

  nuages(groupe, piste, rnd);

  // l'écume va et vient, les bateaux se balancent
  let t = 0;
  const o = new THREE.Object3D();
  return (dt) => {
    t += dt;
    ecume.position.x = rivage + Math.sin(t * 0.8) * 1.2;
    bateaux.forEach((b, i) => {
      o.position.set(b.x, Math.sin(t * 1.5 + i) * 0.15, b.z);
      o.rotation.set(Math.sin(t * 1.2 + i) * 0.06, b.r, Math.sin(t + i) * 0.08);
      o.scale.setScalar(b.s);
      o.updateMatrix();
      mesBateaux.setMatrixAt(i, o.matrix);
    });
    mesBateaux.instanceMatrix.needsUpdate = true;
  };
}

// ---------------------------------------------------------------------------
export function decorNeige(groupe, piste, rnd, horsPiste) {
  // sapins enneigés
  const sapin = fusion([
    { geo: new THREE.CylinderGeometry(0.3, 0.4, 1.4, 6).translate(0, 0.7, 0), couleur: 0x8b5a2b },
    { geo: new THREE.ConeGeometry(2.0, 2.4, 7).translate(0, 2.2, 0), couleur: 0x2b8a3e },
    { geo: new THREE.ConeGeometry(1.6, 2.1, 7).translate(0, 3.4, 0), couleur: 0x2f9e44 },
    { geo: new THREE.ConeGeometry(1.15, 1.8, 7).translate(0, 4.5, 0), couleur: 0x37b24d },
    { geo: new THREE.ConeGeometry(0.62, 0.8, 7).translate(0, 5.25, 0), couleur: 0xffffff },
    { geo: new THREE.ConeGeometry(1.05, 0.5, 7).translate(0, 3.85, 0), couleur: 0xffffff },
    { geo: new THREE.ConeGeometry(1.5, 0.45, 7).translate(0, 2.75, 0), couleur: 0xffffff },
  ]);
  groupe.add(instances(sapin, matCouleurs(), positions(piste, rnd, 240, horsPiste + 1, 140).map((p) => ({ ...p, s: 0.8 + rnd() * 0.8, r: rnd() * 6 }))));

  // bonshommes de neige, tournés vers la piste
  const noir = 0x222222, bois = 0x8b5a2b;
  const bonhomme = fusion([
    { geo: new THREE.IcosahedronGeometry(0.9, 1).translate(0, 0.8, 0), couleur: 0xffffff },
    { geo: new THREE.IcosahedronGeometry(0.65, 1).translate(0, 2.0, 0), couleur: 0xffffff },
    { geo: new THREE.IcosahedronGeometry(0.45, 1).translate(0, 2.9, 0), couleur: 0xffffff },
    { geo: new THREE.ConeGeometry(0.09, 0.5, 5).rotateX(Math.PI / 2).translate(0, 2.88, 0.62), couleur: 0xff922b },
    { geo: new THREE.IcosahedronGeometry(0.06, 0).translate(-0.16, 3.02, 0.4), couleur: noir },
    { geo: new THREE.IcosahedronGeometry(0.06, 0).translate(0.16, 3.02, 0.4), couleur: noir },
    { geo: new THREE.IcosahedronGeometry(0.07, 0).translate(0, 2.2, 0.62), couleur: noir },
    { geo: new THREE.IcosahedronGeometry(0.07, 0).translate(0, 1.9, 0.64), couleur: noir },
    { geo: new THREE.CylinderGeometry(0.42, 0.42, 0.06, 10).translate(0, 3.25, 0), couleur: noir },
    { geo: new THREE.CylinderGeometry(0.28, 0.28, 0.5, 10).translate(0, 3.5, 0), couleur: noir },
    { geo: new THREE.CylinderGeometry(0.5, 0.5, 0.15, 10).translate(0, 2.5, 0), couleur: 0xe8322f },
    { geo: new THREE.CylinderGeometry(0.04, 0.04, 1.2, 4).rotateZ(1.1).translate(0.9, 2.2, 0), couleur: bois },
    { geo: new THREE.CylinderGeometry(0.04, 0.04, 1.2, 4).rotateZ(-1.1).translate(-0.9, 2.2, 0), couleur: bois },
  ]);
  const bonshommes = positions(piste, rnd, 26, piste.demi + 2.5, piste.demi + piste.marge - 1)
    .concat(positions(piste, rnd, 20, horsPiste, 40))
    .map((p) => {
      const { indice } = piste.localiser(p.x, p.z);
      return { ...p, s: 1, r: Math.atan2(piste.cx[indice] - p.x, piste.cz[indice] - p.z) };
    });
  groupe.add(instances(bonhomme, matCouleurs(), bonshommes));

  // igloos
  const igloo = fusion([
    { geo: new THREE.SphereGeometry(2.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), couleur: 0xe7f5ff },
    { geo: new THREE.CylinderGeometry(0.9, 0.9, 1.6, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0, 2.3), couleur: 0xd0ebff },
  ]);
  groupe.add(instances(igloo, matCouleurs(), positions(piste, rnd, 6, horsPiste + 3, 50).map((p) => ({ ...p, s: 1, r: rnd() * 6 }))));

  // rochers
  groupe.add(instances(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x9aa5b1, flatShading: true }),
    positions(piste, rnd, 40, horsPiste, 100).map((p) => ({ ...p, s: 0.6 + rnd() * 1.2, sy: 0.5 + rnd() * 0.5, r: rnd() * 6 }))));

  // montagnes enneigées au loin
  const montagne = fusion([
    { geo: new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), couleur: 0x8d9db6 },
    { geo: new THREE.ConeGeometry(0.42, 0.42, 7).translate(0, 0.795, 0), couleur: 0xffffff },
  ]);
  const montagnes = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + rnd() * 0.2;
    const r = piste.rayon + 260 + rnd() * 80;
    montagnes.push({ x: piste.centre.x + Math.cos(a) * r, z: piste.centre.z + Math.sin(a) * r, s: 70 + rnd() * 40, sy: 70 + rnd() * 60, r: rnd() * 6 });
  }
  groupe.add(instances(montagne, matCouleurs(), montagnes));

  nuages(groupe, piste, rnd);

  // flocons qui tombent autour de la caméra
  const N = 700, cote = 70, hauteur = 30;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) pos.set([(rnd() - 0.5) * cote * 2, rnd() * hauteur, (rnd() - 0.5) * cote * 2], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const flocons = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.45, map: textureRond("rgba(255,255,255,1)", "rgba(255,255,255,0)"), transparent: true, depthWrite: false, fog: false,
  }));
  flocons.frustumCulled = false;
  groupe.add(flocons);
  let t = 0;
  return (dt, camera) => {
    t += dt;
    const a = geo.attributes.position.array;
    for (let i = 0; i < N; i++) {
      a[i * 3 + 1] -= dt * (2 + (i % 5) * 0.4);
      a[i * 3] += Math.sin(t + i) * dt * 0.3;
      if (a[i * 3 + 1] < 0) a[i * 3 + 1] += hauteur;
    }
    geo.attributes.position.needsUpdate = true;
    if (camera) flocons.position.set(camera.position.x, 0, camera.position.z);
  };
}
