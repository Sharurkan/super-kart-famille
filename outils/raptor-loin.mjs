// Version « loin » du vélociraptor (meutes au-delà de ~70 m) : moins de triangles, MÊMES sommets.
// Le simplificateur de three (SimplifyModifier) ne déplace aucun sommet : il en retire et refait les
// triangles avec ceux qui restent. On réécrit donc chaque triangle avec les numéros des sommets du
// modèle complet : la version « loin » réutilise sa géométrie et sa texture d'animation (raptors.js).
// Usage : node outils/raptor-loin.mjs [ratio=0.3] -> public/dinos/velociraptor-loin.json
import { readFileSync, writeFileSync } from "node:fs";
import * as THREE from "three";
import { SimplifyModifier } from "three/addons/modifiers/SimplifyModifier.js";

const ratio = Number(process.argv[2] ?? 0.3);
const glb = readFileSync(new URL("../public/dinos/velociraptor-pbr.glb", import.meta.url));
const lJson = glb.readUInt32LE(12);
const json = JSON.parse(glb.subarray(20, 20 + lJson).toString());
const bin = glb.subarray(20 + lJson + 8);
const TAILLE = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }, NB = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const TYPES = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
function lire(i) {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView], n = NB[a.type];
  const pas = v.byteStride ?? TAILLE[a.componentType] * n, debut = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float64Array(a.count * n);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const o = debut + k * pas + c * TAILLE[a.componentType];
    out[k * n + c] = a.componentType === 5126 ? bin.readFloatLE(o) : a.componentType === 5125 ? bin.readUInt32LE(o) : a.componentType === 5123 ? bin.readUInt16LE(o) : bin.readUInt8(o);
  }
  return out;
}
const sortie = { ratio, parties: [] };
json.meshes.forEach((m, im) => m.primitives.forEach((p) => {
  const pos = lire(p.attributes.POSITION), uv = lire(p.attributes.TEXCOORD_0), idx = lire(p.indices);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(Array.from(idx));
  const nV = pos.length / 3;
  const cle = (x, y, z, u, v) => [x, y, z, u, v].map((a) => Math.round(a * 1e4)).join(",");
  const origine = new Map();
  for (let k = 0; k < nV; k++) {
    const c = cle(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], uv[k * 2], uv[k * 2 + 1]);
    if (!origine.has(c)) origine.set(c, k);
  }
  const simple = new SimplifyModifier().modify(geo, Math.floor(nV * (1 - ratio)));
  const P = simple.attributes.position, U = simple.attributes.uv;
  const vers = [];
  for (let k = 0; k < P.count; k++) {
    const o = origine.get(cle(P.getX(k), P.getY(k), P.getZ(k), U.getX(k), U.getY(k)));
    if (o === undefined) throw new Error(`sommet ${k} introuvable dans le modèle complet`);
    vers.push(o);
  }
  const I = simple.index ? Array.from(simple.index.array) : [...Array(P.count).keys()];
  const triangles = I.map((k) => vers[k]);
  sortie.parties.push({ maillage: im, triangles });
  console.log(`maillage ${im} : ${idx.length / 3} -> ${triangles.length / 3} triangles`);
}));
writeFileSync(new URL("../public/dinos/velociraptor-loin.json", import.meta.url), JSON.stringify(sortie));
