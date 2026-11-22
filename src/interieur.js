import * as THREE from "three";
import { construirePiste } from "./piste.js";

// Le ventre du T-rex : un petit circuit à part (loin du monde principal), dans un tunnel
// organique sombre. On y entre par la gueule et on en ressort par une porte lumineuse.

export const DEF_INTERIEUR = {
  nom: "ventre",
  points: [[0, -22], [0, 20], [14, 40], [38, 44], [52, 26], [42, 5], [50, -18], [34, -40], [10, -40]],
  echelle: 1,
  largeur: 11,
  marge: 2.5,
  bordure: [0xd6336c, 0xffc9c9],
  barriere: [0xa61e4d, 0xf06595],
  route: 0xa04a5e,
  tremplins: [],
  portique: false,
  decalage: [4000, 0],
};

/** Ambiance sombre du ventre (brouillard rouge très proche). */
export const AMBIANCE_INTERIEUR = {
  fond: 0x120306,
  brouillard: [0x2a0710, 4, 48],
  ciel: [0xffc2d1, 0x3a0814, 1.3],
  soleil: 0.35,
};

export function construireInterieur() {
  const piste = construirePiste(DEF_INTERIEUR);
  const groupe = new THREE.Group();
  groupe.add(piste.groupe);
  const { N, cx, cz, nx, nz, demi, marge } = piste;

  // sol sombre sous tout le circuit
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshLambertMaterial({ color: 0x3b0d18 }));
  sol.rotation.x = -Math.PI / 2;
  sol.position.set(piste.centre.x, -0.02, piste.centre.z);
  groupe.add(sol);

  // voûte : un tunnel en demi-ellipse qui suit la route
  const W = demi + marge + 1.2, H = 8.5, M = 16;
  const pos = [], col = [];
  const c1 = new THREE.Color(0x8c1d33), c2 = new THREE.Color(0xb83250), c3 = new THREE.Color(0x5e1022);
  const pt = (i, m) => {
    const a = (m / M) * Math.PI;
    const l = Math.cos(a) * W, y = Math.sin(a) * H;
    return [cx[i] + nx[i] * l, y, cz[i] + nz[i] * l];
  };
  for (let k = 0; k < N; k++) {
    const i = k, j = (k + 1) % N;
    for (let m = 0; m < M; m++) {
      const c = k % 14 < 2 ? c3 : (m + Math.floor(k / 3)) % 2 ? c1 : c2;
      for (const [a, b] of [[i, m], [j, m], [i, m + 1], [j, m], [j, m + 1], [i, m + 1]]) {
        pos.push(...pt(a, b));
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  groupe.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true })));

  // côtes blanches qui enjambent la route
  const matCote = new THREE.MeshLambertMaterial({ color: 0xf1e3c8 });
  for (let k = 7; k < N; k += 14) {
    const courbe = new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, m) => {
      const a = (m / 12) * Math.PI;
      const l = Math.cos(a) * (W - 0.4), y = Math.sin(a) * (H - 0.4);
      return new THREE.Vector3(cx[k] + nx[k] * l, y, cz[k] + nz[k] * l);
    }));
    groupe.add(new THREE.Mesh(new THREE.TubeGeometry(courbe, 40, 0.55, 6, false), matCote));
  }

  // bulles lumineuses sur les parois
  const bulles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }), 70);
  const o = new THREE.Object3D(), c = new THREE.Color();
  const couleurs = [0xb2f2bb, 0xffec99, 0xffc9c9, 0xd0bfff];
  for (let n = 0; n < 70; n++) {
    const k = Math.floor(Math.random() * N), m = 2 + Math.random() * (M - 4);
    const [x, y, z] = pt(k, m);
    o.position.set(x, y, z);
    o.scale.setScalar(0.6 + Math.random() * 1.2);
    o.updateMatrix();
    bulles.setMatrixAt(n, o.matrix);
    bulles.setColorAt(n, c.set(couleurs[n % couleurs.length]));
  }
  groupe.add(bulles);

  // porte de sortie lumineuse sur la ligne (indice 0)
  const porte = new THREE.Group();
  const bois = new THREE.MeshLambertMaterial({ color: 0x8b5a2b });
  for (const sx of [1, -1]) {
    const montant = new THREE.Mesh(new THREE.BoxGeometry(1.2, 7.5, 1.2), bois);
    montant.position.set(sx * (demi + 0.9), 3.75, 0);
    porte.add(montant);
  }
  const linteau = new THREE.Mesh(new THREE.BoxGeometry(2 * demi + 3, 1.2, 1.2), bois);
  linteau.position.y = 7.6;
  porte.add(linteau);
  const lumiere = new THREE.Mesh(new THREE.PlaneGeometry(2 * demi + 0.6, 7), new THREE.MeshBasicMaterial({ color: 0xfff3bf, transparent: true, opacity: 0.85, side: THREE.DoubleSide, fog: false }));
  lumiere.position.y = 3.5;
  porte.add(lumiere);
  porte.position.set(cx[0], 0, cz[0]);
  porte.rotation.y = piste.angleA(0);
  groupe.add(porte);

  let t = 0;
  const animer = (dt) => {
    t += dt;
    lumiere.material.opacity = 0.7 + Math.sin(t * 4) * 0.15;
  };
  return { piste, groupe, animer };
}
