// Couleurs de secours pour un modèle d'animal : dos vert sauge, flancs olive, ventre beige (par sommet).
import { NodeIO } from "@gltf-transform/core";
const [entree, sortie] = process.argv.slice(2);
const io = new NodeIO();
const doc = await io.read(entree);
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
const P = prim.getAttribute("POSITION").getArray();
const I = prim.getIndices().getArray();
const nv = P.length / 3;
const N = new Float32Array(nv * 3);
for (let t = 0; t < I.length; t += 3) {
  const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
  const u = [0, 1, 2].map((k) => P[3 * b + k] - P[3 * a + k]), v = [0, 1, 2].map((k) => P[3 * c + k] - P[3 * a + k]);
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  for (const s of [a, b, c]) for (let k = 0; k < 3; k++) N[3 * s + k] += n[k];
}
const lin = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((c) => Math.pow(c / 255, 2.2));
const DOS = lin(0x7f8f6a), FLANC = lin(0x8d8f72), VENTRE = lin(0xb3a688);
const col = new Float32Array(nv * 3);
for (let i = 0; i < nv; i++) {
  const l = Math.hypot(N[3 * i], N[3 * i + 1], N[3 * i + 2]) || 1;
  const ny = N[3 * i + 1] / l;
  const t = Math.max(0, Math.min(1, (ny + 0.2) / 0.9));
  const base = ny < -0.3 ? VENTRE : FLANC;
  const c = base.map((v, k) => v * (1 - t) + DOS[k] * t);
  const tache = Math.sin(P[3 * i] * 23 + P[3 * i + 2] * 17) * Math.cos(P[3 * i + 1] * 29) * 0.06;
  col.set(c.map((v) => Math.max(0, v + tache)), 3 * i);
}
prim.setAttribute("COLOR_0", doc.createAccessor("couleurs").setType("VEC3").setArray(col).setBuffer(doc.getRoot().listBuffers()[0]));
prim.setMaterial(doc.createMaterial("diplo").setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.9).setMetallicFactor(0));
await io.write(sortie, doc);
console.log("ok", nv, "sommets");
