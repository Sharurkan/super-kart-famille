// Retire d'un GLB les modèles (objets racines de la scène) que le jeu n'utilise plus, avec leurs
// maillages, matériaux, textures et images devenus inutiles. Les données gardées sont recopiées telles quelles.
// node outils/blender/elaguer_glb.mjs entree.glb sortie.glb Nom1,Nom2,...   (noms des modèles gardés)
// (les suffixes Blender « .001 » sont ignorés pour la comparaison des noms)
import fs from "node:fs";

const [entree, sortie, liste] = process.argv.slice(2);
const garder = new Set(liste.split(","));
const b = fs.readFileSync(entree);
const lenJ = b.readUInt32LE(12);
const j = JSON.parse(b.subarray(20, 20 + lenJ).toString());
const bin = b.subarray(20 + lenJ + 8, 20 + lenJ + 8 + b.readUInt32LE(20 + lenJ));
if (j.skins?.length || j.animations?.length) throw new Error("squelettes / animations non gérés");

const propre = (n) => (n ?? "").replace(/\.\d{3}$/, "");
const scene = j.scenes[j.scene ?? 0];
const racines = scene.nodes.filter((n) => garder.has(propre(j.nodes[n].name)));
const manquants = [...garder].filter((g) => !racines.some((n) => propre(j.nodes[n].name) === g));
if (manquants.length) throw new Error("modèles introuvables : " + manquants.join(", "));

// table de renumérotation : on garde les éléments utilisés, dans leur ordre d'origine
const table = () => ({ vus: new Set(), carte: new Map() });
const T = { nodes: table(), meshes: table(), materials: table(), textures: table(), images: table(), samplers: table(), accessors: table(), bufferViews: table() };
const voir = (type, i) => { if (i != null) T[type].vus.add(i); };
const parcourir = (n) => { voir("nodes", n); const nd = j.nodes[n]; voir("meshes", nd.mesh); for (const c of nd.children ?? []) parcourir(c); };
racines.forEach(parcourir);
const texInfos = (m) => [m.pbrMetallicRoughness?.baseColorTexture, m.pbrMetallicRoughness?.metallicRoughnessTexture, m.normalTexture, m.occlusionTexture, m.emissiveTexture].filter(Boolean);
for (const mi of T.meshes.vus) for (const p of j.meshes[mi].primitives) {
  voir("accessors", p.indices); for (const a of Object.values(p.attributes)) voir("accessors", a);
  for (const t of p.targets ?? []) for (const a of Object.values(t)) voir("accessors", a);
  voir("materials", p.material);
}
for (const m of T.materials.vus) for (const t of texInfos(j.materials[m])) voir("textures", t.index);
for (const t of T.textures.vus) { voir("images", j.textures[t].source); voir("samplers", j.textures[t].sampler); }
for (const a of T.accessors.vus) { voir("bufferViews", j.accessors[a].bufferView); if (j.accessors[a].sparse) throw new Error("sparse non géré"); }
for (const im of T.images.vus) voir("bufferViews", j.images[im].bufferView);
for (const [type, t] of Object.entries(T)) [...t.vus].sort((x, y) => x - y).forEach((ancien, nouveau) => t.carte.set(ancien, nouveau));
const N = (type, i) => (i == null ? i : T[type].carte.get(i));
const filtrer = (type) => (j[type] ?? []).filter((_, i) => T[type].vus.has(i));

// nouveau tampon binaire : vues recopiées, alignées sur 4 octets
const morceaux = [];
let taille = 0;
const vues = filtrer("bufferViews").map((v) => {
  const octets = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  const pad = (4 - (taille % 4)) % 4;
  if (pad) { morceaux.push(Buffer.alloc(pad)); taille += pad; }
  const nv = { ...v, buffer: 0, byteOffset: taille };
  morceaux.push(octets); taille += octets.length;
  return nv;
});
const pad = (4 - (taille % 4)) % 4;
if (pad) { morceaux.push(Buffer.alloc(pad)); taille += pad; }
const nouveauBin = Buffer.concat(morceaux);

j.nodes = filtrer("nodes").map((n) => ({ ...n, mesh: N("meshes", n.mesh), children: n.children?.map((c) => N("nodes", c)) }));
for (const n of j.nodes) { if (n.mesh == null) delete n.mesh; if (!n.children) delete n.children; }
j.meshes = filtrer("meshes").map((m) => ({ ...m, primitives: m.primitives.map((p) => ({
  ...p, indices: N("accessors", p.indices), material: N("materials", p.material),
  attributes: Object.fromEntries(Object.entries(p.attributes).map(([k, a]) => [k, N("accessors", a)])),
  ...(p.targets ? { targets: p.targets.map((t) => Object.fromEntries(Object.entries(t).map(([k, a]) => [k, N("accessors", a)]))) } : {}),
})) }));
for (const m of j.meshes) for (const p of m.primitives) { if (p.indices == null) delete p.indices; if (p.material == null) delete p.material; }
j.materials = filtrer("materials");
for (const m of j.materials) for (const t of texInfos(m)) t.index = N("textures", t.index);
j.textures = filtrer("textures").map((t) => ({ ...t, source: N("images", t.source), sampler: N("samplers", t.sampler) }));
for (const t of j.textures) if (t.sampler == null) delete t.sampler;
j.images = filtrer("images").map((im) => ({ ...im, bufferView: N("bufferViews", im.bufferView) }));
j.samplers = filtrer("samplers");
j.accessors = filtrer("accessors").map((a) => ({ ...a, bufferView: N("bufferViews", a.bufferView) }));
j.bufferViews = vues;
j.buffers = [{ byteLength: nouveauBin.length }];
j.scenes = [{ ...scene, nodes: racines.map((n) => N("nodes", n)) }];
j.scene = 0;
for (const k of ["materials", "textures", "images", "samplers"]) if (!j[k].length) delete j[k];

let json = Buffer.from(JSON.stringify(j));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const entete = Buffer.alloc(12);
entete.write("glTF", 0); entete.writeUInt32LE(2, 4); entete.writeUInt32LE(12 + 8 + json.length + 8 + nouveauBin.length, 8);
const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.write(type, 4); return Buffer.concat([h, data]); };
fs.writeFileSync(sortie, Buffer.concat([entete, chunk("JSON", json), chunk("BIN\0", nouveauBin)]));
console.log(`${entree} : ${(b.length / 1024) | 0} Kio -> ${sortie} : ${((12 + 16 + json.length + nouveauBin.length) / 1024) | 0} Kio ;`,
  `${scene.nodes.length} -> ${racines.length} modèles, ${T.images.vus.size} images`);
