// node filtrer_raptor_trice.cjs entree.gltf sortie.gltf '{"Armature|Idle":"Idle",...}'
// Garde/renomme les animations, enlève le morphing, TEXCOORD_1, tangentes, spéculaire/brillance et occlusion.
// SANS_NORMALES=1 : retire aussi les normales (le tricératops « low poly » est en facettes : sans elles,
// la simplification n'est plus bloquée par les arêtes vives). TEXTURES=... : voir plus bas.
const fs = require("fs");
const path = require("path");
const [entree, sortie, carte] = process.argv.slice(2);
const garder = JSON.parse(carte);
const g = JSON.parse(fs.readFileSync(entree, "utf8"));
g.animations = g.animations.filter((a) => a.name in garder).map((a) => ({ ...a, name: garder[a.name] }));
// pas de morphing (clignements) : on retire les canaux "weights" et les cibles
for (const a of g.animations) {
  a.channels = a.channels.filter((c) => c.target.path !== "weights");
  const utilises = new Set(a.channels.map((c) => c.sampler));
  const nouveaux = [];
  const map = new Map();
  a.samplers.forEach((s, i) => { if (utilises.has(i)) { map.set(i, nouveaux.length); nouveaux.push(s); } });
  a.samplers = nouveaux;
  a.channels.forEach((c) => (c.sampler = map.get(c.sampler)));
}
for (const m of g.meshes) for (const p of m.primitives) { delete p.targets; delete p.attributes.TEXCOORD_1; delete p.attributes.TANGENT; if (process.env.SANS_NORMALES) delete p.attributes.NORMAL; }
for (const m of g.meshes) delete m.weights;
// matériaux : couleur + normale seulement (le spéculaire/brillance et l'occlusion sont abandonnés)
for (const mat of g.materials) {
  const sg = mat.extensions?.KHR_materials_pbrSpecularGlossiness;
  mat.pbrMetallicRoughness = { baseColorTexture: sg ? sg.diffuseTexture : mat.pbrMetallicRoughness?.baseColorTexture, metallicFactor: 0, roughnessFactor: 0.85 };
  delete mat.extensions;
  delete mat.occlusionTexture;
}
g.extensionsUsed = (g.extensionsUsed || []).filter((e) => e !== "KHR_materials_pbrSpecularGlossiness");
g.extensionsRequired = (g.extensionsRequired || []).filter((e) => e !== "KHR_materials_pbrSpecularGlossiness");
// chemins absolus vers le dossier d'origine
const dir = path.dirname(path.resolve(entree));
for (const b of g.buffers) b.uri = path.relative(path.dirname(path.resolve(sortie)), path.join(dir, b.uri)).replace(/\\/g, "/");
for (const im of g.images || []) im.uri = path.relative(path.dirname(path.resolve(sortie)), path.join(dir, im.uri)).replace(/\\/g, "/");
// textures remplacées (JPEG réduits) : TEXTURES='{"Body_Mat_diffuse.png":"chemin.jpg",...}', les autres sont retirées
if (process.env.TEXTURES) {
  const rempl = JSON.parse(process.env.TEXTURES);
  const garderImg = new Set();
  g.images.forEach((im, i) => {
    const base = path.basename(decodeURIComponent(im.uri));
    if (rempl[base]) { im.uri = path.relative(path.dirname(path.resolve(sortie)), rempl[base]).replace(/\\/g, "/"); im.mimeType = "image/jpeg"; garderImg.add(i); }
  });
  for (const mat of g.materials) {
    const tex = (t) => t && garderImg.has(g.textures[t.index].source);
    if (!tex(mat.normalTexture)) delete mat.normalTexture;
    if (!tex(mat.pbrMetallicRoughness.baseColorTexture)) delete mat.pbrMetallicRoughness.baseColorTexture;
  }
  console.log("images", g.images.filter((_, i) => garderImg.has(i)).map((im) => im.uri));
}
fs.writeFileSync(sortie, JSON.stringify(g));
console.log("animations", g.animations.map((a) => a.name + ":" + a.channels.length));
