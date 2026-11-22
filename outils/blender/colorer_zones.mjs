// Colore un modèle blanc par zones (socle, crâne, mâchoire, gueule, dents) avec des couleurs par sommet.
// Usage : node colorer.mjs entree.glb sortie.glb
import { NodeIO } from "@gltf-transform/core";

const [entree, sortie] = process.argv.slice(2);
const io = new NodeIO();
const doc = await io.read(entree);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute("POSITION").getArray();
const I = prim.getIndices().getArray();
const nv = P.length / 3, nt = I.length / 3;

// normales lisses par sommet
const Nn = new Float32Array(nv * 3);
for (let t = 0; t < nt; t++) {
  const [a, b, c] = [I[3 * t], I[3 * t + 1], I[3 * t + 2]];
  const ux = P[3 * b] - P[3 * a], uy = P[3 * b + 1] - P[3 * a + 1], uz = P[3 * b + 2] - P[3 * a + 2];
  const vx = P[3 * c] - P[3 * a], vy = P[3 * c + 1] - P[3 * a + 1], vz = P[3 * c + 2] - P[3 * a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const s of [a, b, c]) { Nn[3 * s] += nx; Nn[3 * s + 1] += ny; Nn[3 * s + 2] += nz; }
}
for (let i = 0; i < nv; i++) {
  const l = Math.hypot(Nn[3 * i], Nn[3 * i + 1], Nn[3 * i + 2]) || 1;
  Nn[3 * i] /= l; Nn[3 * i + 1] /= l; Nn[3 * i + 2] /= l;
}

// boîte englobante
const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[3 * i + k]); mx[k] = Math.max(mx[k], P[3 * i + k]); }

// grille d'occupation (voxels) remplie en échantillonnant chaque triangle
const R = 72;
const taille = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) * 1.02;
const occ = new Uint8Array(R * R * R);
const vox = (x, y, z) => {
  const i = Math.floor(((x - mn[0]) / taille) * R), j = Math.floor(((y - mn[1]) / taille) * R), k = Math.floor(((z - mn[2]) / taille) * R);
  if (i < 0 || j < 0 || k < 0 || i >= R || j >= R || k >= R) return -1;
  return (i * R + j) * R + k;
};
for (let t = 0; t < nt; t++) {
  const [a, b, c] = [I[3 * t], I[3 * t + 1], I[3 * t + 2]];
  for (let u = 0; u <= 6; u++) for (let v = 0; v <= 6 - u; v++) {
    const w = 6 - u - v;
    const x = (P[3 * a] * u + P[3 * b] * v + P[3 * c] * w) / 6;
    const y = (P[3 * a + 1] * u + P[3 * b + 1] * v + P[3 * c + 1] * w) / 6;
    const z = (P[3 * a + 2] * u + P[3 * b + 2] * v + P[3 * c + 2] * w) / 6;
    const id = vox(x, y, z);
    if (id >= 0) occ[id] = 1;
  }
}

// "ouverture" de chaque sommet : part des rayons qui s'échappent sans toucher la forme
const DIRS = [];
for (let k = 0; k < 40; k++) {
  const yv = 1 - (2 * (k + 0.5)) / 40, r = Math.sqrt(1 - yv * yv), phi = k * 2.399963;
  DIRS.push([Math.cos(phi) * r, yv, Math.sin(phi) * r]);
}
const pasVox = taille / R;
const ouverture = new Float32Array(nv);
for (let i = 0; i < nv; i++) {
  const px = P[3 * i], py = P[3 * i + 1], pz = P[3 * i + 2];
  let libres = 0, total = 0;
  for (const d of DIRS) {
    const dn = d[0] * Nn[3 * i] + d[1] * Nn[3 * i + 1] + d[2] * Nn[3 * i + 2];
    if (dn <= 0.05) continue; // seulement l'hémisphère vers l'extérieur
    total++;
    let touche = false;
    for (let s = 2.5; s < R * 0.45; s += 1) {
      const id = vox(px + d[0] * s * pasVox, py + d[1] * s * pasVox, pz + d[2] * s * pasVox);
      if (id < 0) break;
      if (occ[id]) { touche = true; break; }
    }
    if (!touche) libres++;
  }
  ouverture[i] = total ? libres / total : 1;
}

// couleurs
const hauteur = mx[1] - mn[1];
const socleHaut = mn[1] + hauteur * 0.16;
const couleurs = new Float32Array(nv * 3);
const lin = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255].map((c) => Math.pow(c, 2.2));
const SABLE = lin(0xb8a27c), PIERRE = lin(0x9b9a92), VERT = lin(0x6f8a4a), VERT_FONCE = lin(0x4f6a36), BEIGE = lin(0xc9b38a), GUEULE = lin(0x4a1f22), DENT = lin(0xf3ead2);
// bruit doux pour des taches
const bruit = (x, y, z) => Math.sin(x * 13.1 + y * 7.3) * Math.cos(z * 11.7 - x * 5.1) * 0.5 + 0.5;
const melange = (a, b, t) => a.map((v, k) => v * (1 - t) + b[k] * t);
for (let i = 0; i < nv; i++) {
  const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
  const yr = (y - mn[1]) / hauteur;
  const o = ouverture[i];
  let c;
  if (y < socleHaut) {
    c = melange(SABLE, PIERRE, bruit(x, y, z) > 0.7 ? 0.6 : 0.1);
  } else if (o < 0.38 && x > -0.35 && yr < 0.85) {
    c = GUEULE; // creux à l'avant : intérieur de la gueule
  } else if (yr < 0.42) {
    c = BEIGE; // bas de la mâchoire
  } else {
    c = melange(VERT, VERT_FONCE, bruit(x, y, z) * 0.7);
  }
  // un peu d'ombre dans les creux pour le relief
  const ombre = 0.55 + 0.45 * Math.min(1, o * 1.4);
  couleurs.set(c.map((v) => v * ombre), 3 * i);
}

const acc = doc.createAccessor("couleurs").setType("VEC3").setArray(couleurs).setBuffer(doc.getRoot().listBuffers()[0]);
prim.setAttribute("COLOR_0", acc);
const mat = doc.createMaterial("tete").setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
prim.setMaterial(mat);
await io.write(sortie, doc);
const stats = { gueule: 0, dents: 0 };
for (let i = 0; i < nv; i++) { if (ouverture[i] < 0.38) stats.gueule++; else if (ouverture[i] < 0.62) stats.dents++; }
console.log("ok", nv, "sommets", JSON.stringify(stats), "boite", mn.map((v) => v.toFixed(2)), mx.map((v) => v.toFixed(2)));
