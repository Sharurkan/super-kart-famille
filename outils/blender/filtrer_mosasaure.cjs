// node filtrer_mosasaure.cjs entree.gltf sortie.gltf couleur.jpg debut fin
// Prépare le glTF Sketchfab « Mosasaurus » (Alexey Zaika, CC-BY 4.0) pour le jeu :
//  - l'animation unique (21 s : nage, glisse, virages, plongée) est découpée sur un seul cycle de
//    nage qui boucle parfaitement (debut..fin en secondes, temps remis à 0), renommée « Nager » ;
//  - matériau : couleur seulement (JPEG réduit), la texture métal/rugosité et le spéculaire sont retirés.
// Les clés découpées sont écrites dans un nouveau fichier .bin à côté de la sortie.
const fs = require("fs");
const path = require("path");
const [entree, sortie, couleur, debutS, finS] = process.argv.slice(2);
const debut = Number(debutS), fin = Number(finS), EPS = 1e-4;
const g = JSON.parse(fs.readFileSync(entree, "utf8"));
const dir = path.dirname(path.resolve(entree));
const binOrig = fs.readFileSync(path.join(dir, g.buffers[0].uri));
const NB = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function lire(i) {
  const a = g.accessors[i], bv = g.bufferViews[a.bufferView], n = NB[a.type];
  if (a.componentType !== 5126) throw new Error("accesseur non flottant " + i);
  const st = bv.byteStride || n * 4, out = [];
  for (let k = 0; k < a.count; k++) {
    const r = [];
    for (let j = 0; j < n; j++) r.push(binOrig.readFloatLE((bv.byteOffset || 0) + (a.byteOffset || 0) + k * st + j * 4));
    out.push(r);
  }
  return out;
}

// --- animation : un seul cycle de nage ---
const anim = g.animations[0];
anim.name = "Nager";
anim.channels = anim.channels.filter((c) => c.target.path !== "weights");
const morceaux = [];
let taille = 0;
const nouvelAcc = (lignes, type) => {
  const n = NB[type], buf = Buffer.alloc(lignes.length * n * 4);
  lignes.forEach((r, k) => r.forEach((x, j) => buf.writeFloatLE(x, (k * n + j) * 4)));
  const bv = g.bufferViews.push({ buffer: 1, byteOffset: taille, byteLength: buf.length }) - 1;
  morceaux.push(buf);
  taille += buf.length;
  const acc = { bufferView: bv, componentType: 5126, count: lignes.length, type };
  if (type === "SCALAR") { acc.min = [lignes[0][0]]; acc.max = [lignes.at(-1)[0]]; }
  return g.accessors.push(acc) - 1;
};
const cache = new Map();
for (const s of anim.samplers) {
  if (s.interpolation === "CUBICSPLINE") throw new Error("CUBICSPLINE non géré");
  const t = lire(s.input).map((r) => r[0]), v = lire(s.output);
  const rot = anim.channels.some((c) => anim.samplers[c.sampler] === s && c.target.path === "rotation");
  /** Valeur de la piste au temps x (interpolation linéaire, quaternion renormalisé). */
  const valeur = (x) => {
    if (x <= t[0]) return v[0];
    if (x >= t.at(-1)) return v.at(-1);
    let k = 0;
    while (t[k + 1] < x) k++;
    const f = s.interpolation === "STEP" ? 0 : (x - t[k]) / (t[k + 1] - t[k]);
    const r = v[k].map((a, j) => a + (v[k + 1][j] - a) * f);
    if (rot) { const n = Math.hypot(...r); return r.map((a) => a / n); }
    return r;
  };
  // clés dans l'intervalle, plus les deux bouts s'ils manquent
  const temps = [], vals = [];
  if (!t.some((x) => Math.abs(x - debut) < EPS)) { temps.push(0); vals.push(valeur(debut)); }
  t.forEach((x, k) => { if (x >= debut - EPS && x <= fin + EPS) { temps.push(Math.max(0, x - debut)); vals.push(v[k]); } });
  if (!t.some((x) => Math.abs(x - fin) < EPS)) { temps.push(fin - debut); vals.push(valeur(fin)); }
  const cle = temps.map((x) => x.toFixed(5)).join(",");
  if (!cache.has(cle)) cache.set(cle, nouvelAcc(temps.map((x) => [x]), "SCALAR"));
  s.input = cache.get(cle);
  s.output = nouvelAcc(vals, g.accessors[s.output].type);
}
const nomBin = path.basename(sortie).replace(/\.gltf$/, "") + "-anim.bin";
fs.writeFileSync(path.join(path.dirname(path.resolve(sortie)), nomBin), Buffer.concat(morceaux));
g.buffers[0].uri = path.relative(path.dirname(path.resolve(sortie)), path.join(dir, g.buffers[0].uri)).replace(/\\/g, "/");
g.buffers[1] = { uri: nomBin, byteLength: taille };

// --- matériau : couleur seule ---
for (const m of g.meshes) for (const p of m.primitives) { delete p.targets; delete p.attributes.TEXCOORD_1; delete p.attributes.TANGENT; }
for (const mat of g.materials) {
  mat.pbrMetallicRoughness = { baseColorTexture: mat.pbrMetallicRoughness.baseColorTexture, metallicFactor: 0, roughnessFactor: 0.8 };
  delete mat.extensions;
  delete mat.normalTexture;
  delete mat.occlusionTexture;
}
g.extensionsUsed = (g.extensionsUsed || []).filter((e) => e !== "KHR_materials_specular");
// une seule texture et une seule image (la couleur, en JPEG réduit)
const tCouleur = g.textures[g.materials[0].pbrMetallicRoughness.baseColorTexture.index];
g.textures = [{ ...tCouleur, source: 0 }];
g.materials[0].pbrMetallicRoughness.baseColorTexture.index = 0;
g.images = [{ uri: path.relative(path.dirname(path.resolve(sortie)), path.resolve(couleur)).replace(/\\/g, "/"), mimeType: "image/jpeg" }];
fs.writeFileSync(sortie, JSON.stringify(g));
console.log("canaux", anim.channels.length, "pistes de temps", cache.size, "octets anim", taille);
