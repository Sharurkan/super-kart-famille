// Petits outils pour lire et modifier un glTF « à la main » (JSON + scene.bin), sans passer par
// Blender (qui casse parfois le skinning à la ré-exportation). Utilisé par preparer_dinos3.mjs.
import fs from "node:fs";
import path from "node:path";

const COMPOSANTES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const TYPES = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array, 5122: Int16Array, 5120: Int8Array };

export function chargerGltf(fichier) {
  const g = JSON.parse(fs.readFileSync(fichier, "utf8"));
  const dir = path.dirname(path.resolve(fichier));
  const buffers = g.buffers.map((b) => fs.readFileSync(path.join(dir, decodeURIComponent(b.uri))));
  const ajouts = []; // morceaux du nouveau buffer (accesseurs créés)
  let tailleAjouts = 0;
  const o = {
    g, dir,
    lire(i) {
      const a = g.accessors[i], bv = g.bufferViews[a.bufferView];
      const T = TYPES[a.componentType], n = COMPOSANTES[a.type];
      const buf = buffers[bv.buffer];
      const debut = (bv.byteOffset || 0) + (a.byteOffset || 0);
      const pas = bv.byteStride || n * T.BYTES_PER_ELEMENT;
      const sortie = new T(a.count * n);
      const vue = new T(buf.buffer, buf.byteOffset, buf.byteLength / T.BYTES_PER_ELEMENT | 0);
      if (debut % T.BYTES_PER_ELEMENT === 0 && pas % T.BYTES_PER_ELEMENT === 0) {
        const d = debut / T.BYTES_PER_ELEMENT, p = pas / T.BYTES_PER_ELEMENT;
        for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) sortie[k * n + c] = vue[d + k * p + c];
      } else {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) sortie[k * n + c] = dv.getFloat32(debut + k * pas + c * 4, true);
      }
      return sortie;
    },
    // nouvel accesseur float (dans un buffer ajouté à la fin)
    ajouter(tableau, type, componentType = 5126, cible) {
      const f = TYPES[componentType].from(tableau);
      const n = COMPOSANTES[type];
      if (o.indexBuffer === undefined) { o.indexBuffer = g.buffers.length; g.buffers.push({ byteLength: 0 }); }
      const bv = g.bufferViews.push({ buffer: o.indexBuffer, byteOffset: tailleAjouts, byteLength: f.byteLength, ...(cible ? { target: cible } : {}) }) - 1;
      ajouts.push(Buffer.from(f.buffer, f.byteOffset, f.byteLength));
      const bourrage = (4 - (f.byteLength % 4)) % 4; // alignement sur 4 octets
      if (bourrage) ajouts.push(Buffer.alloc(bourrage));
      tailleAjouts += f.byteLength + bourrage;
      const acc = { bufferView: bv, componentType, count: f.length / n, type };
      if (type === "VEC3" && componentType === 5126) {
        const mi = [Infinity, Infinity, Infinity], ma = [-Infinity, -Infinity, -Infinity];
        for (let k = 0; k < f.length; k++) { mi[k % 3] = Math.min(mi[k % 3], f[k]); ma[k % 3] = Math.max(ma[k % 3], f[k]); }
        acc.min = mi; acc.max = ma;
      }
      if (type === "SCALAR") { let mi = Infinity, ma = -Infinity; for (const v of f) { mi = Math.min(mi, v); ma = Math.max(ma, v); } acc.min = [mi]; acc.max = [ma]; }
      return g.accessors.push(acc) - 1;
    },
    // écrit le glTF modifié : sortie.gltf + sortie-ajouts.bin ; les autres fichiers restent à leur place
    ecrire(sortie) {
      const dS = path.dirname(path.resolve(sortie));
      const rel = (p) => path.relative(dS, p).replace(/\\/g, "/");
      g.buffers.forEach((b, i) => { if (i !== o.indexBuffer) b.uri = rel(path.join(dir, decodeURIComponent(b.uri))); });
      for (const im of g.images || []) if (!im.absolu) im.uri = rel(path.join(dir, decodeURIComponent(im.uri))); else { im.uri = rel(im.absolu); delete im.absolu; }
      if (o.indexBuffer !== undefined) {
        const binNom = path.basename(sortie).replace(/\.gltf$/, "") + "-ajouts.bin";
        fs.writeFileSync(path.join(dS, binNom), Buffer.concat(ajouts));
        g.buffers[o.indexBuffer] = { uri: binNom, byteLength: tailleAjouts };
      }
      fs.writeFileSync(sortie, JSON.stringify(g));
    },
  };
  return o;
}

// Soude les sommets dupliqués d'une primitive (même position, UV et poids d'os, à 1e-4 près) et
// recalcule des normales lisses (moyenne des faces autour de chaque position, y compris de part et
// d'autre des coutures d'UV). Sans ça, un maillage « éclaté » (un sommet par coin de triangle) ne
// peut pas être simplifié.
export function souder(o, p) {
  const nb = { POSITION: 3, TEXCOORD_0: 2, JOINTS_0: 4, WEIGHTS_0: 4 };
  const A = {};
  for (const k of Object.keys(nb)) A[k] = o.lire(p.attributes[k]);
  const N = A.POSITION.length / 3;
  const idx = p.indices != null ? o.lire(p.indices) : Uint32Array.from({ length: N }, (_, i) => i);
  const r = (x) => Math.round(x * 1e4);
  const cle = (ks, i) => ks.map((k) => Array.from(A[k].subarray(i * nb[k], i * nb[k] + nb[k]), r).join(",")).join("|");
  const nouveau = new Map(), parPosition = new Map();
  const ancienVersNouveau = new Uint32Array(N), groupe = [];
  const sortie = { POSITION: [], TEXCOORD_0: [], JOINTS_0: [], WEIGHTS_0: [] };
  for (let i = 0; i < N; i++) {
    const c = cle(Object.keys(nb), i);
    let j = nouveau.get(c);
    if (j === undefined) {
      j = nouveau.size; nouveau.set(c, j);
      for (const k of Object.keys(nb)) sortie[k].push(...A[k].subarray(i * nb[k], i * nb[k] + nb[k]));
      const cp = cle(["POSITION"], i);
      if (!parPosition.has(cp)) parPosition.set(cp, parPosition.size);
      groupe[j] = parPosition.get(cp);
    }
    ancienVersNouveau[i] = j;
  }
  const indices = Array.from(idx, (i) => ancienVersNouveau[i]);
  const somme = new Float64Array(parPosition.size * 3);
  const P = sortie.POSITION;
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    const u = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), v = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; // pondéré par l'aire
    for (const s of [a, b, c]) for (let k = 0; k < 3; k++) somme[groupe[s] * 3 + k] += n[k];
  }
  const normales = [];
  for (let j = 0; j < nouveau.size; j++) {
    const x = somme[groupe[j] * 3], y = somme[groupe[j] * 3 + 1], z = somme[groupe[j] * 3 + 2];
    const l = Math.hypot(x, y, z) || 1; normales.push(x / l, y / l, z / l);
  }
  const typeJoints = o.g.accessors[p.attributes.JOINTS_0].componentType;
  p.attributes = {
    POSITION: o.ajouter(sortie.POSITION, "VEC3", 5126, 34962),
    NORMAL: o.ajouter(normales, "VEC3", 5126, 34962),
    TEXCOORD_0: o.ajouter(sortie.TEXCOORD_0, "VEC2", 5126, 34962),
    JOINTS_0: o.ajouter(sortie.JOINTS_0, "VEC4", typeJoints, 34962),
    WEIGHTS_0: o.ajouter(sortie.WEIGHTS_0, "VEC4", 5126, 34962),
  };
  p.indices = o.ajouter(indices, "SCALAR", nouveau.size > 65535 ? 5125 : 5123, 34963);
  return { avant: N, apres: nouveau.size };
}

// Pistes d'une animation, indexées par « nœud/chemin » : { temps, valeurs, n }
export function pistes(o, anim) {
  const res = new Map();
  for (const c of anim.channels) {
    const s = anim.samplers[c.sampler];
    if (c.target.path === "weights") continue;
    res.set(c.target.node + "/" + c.target.path, { noeud: c.target.node, chemin: c.target.path, temps: o.lire(s.input), valeurs: o.lire(s.output), n: c.target.path === "rotation" ? 4 : 3, interpolation: s.interpolation || "LINEAR" });
  }
  return res;
}

// Remplace les canaux d'une animation par les pistes données
export function ecrirePistes(o, anim, liste) {
  anim.samplers = []; anim.channels = [];
  for (const p of liste) {
    const input = o.ajouter(p.temps, "SCALAR");
    const output = o.ajouter(p.valeurs, p.n === 4 ? "VEC4" : "VEC3");
    const s = anim.samplers.push({ input, output, interpolation: "LINEAR" }) - 1;
    anim.channels.push({ sampler: s, target: { node: p.noeud, path: p.chemin } });
  }
}

// valeur interpolée d'une piste au temps t (slerp approché par nlerp pour les rotations)
export function echantillon(p, t) {
  const T = p.temps, n = p.n, v = p.valeurs;
  if (t <= T[0]) return Array.from(v.slice(0, n));
  if (t >= T[T.length - 1]) return Array.from(v.slice((T.length - 1) * n, T.length * n));
  let i = 0; while (T[i + 1] < t) i++;
  const k = (t - T[i]) / (T[i + 1] - T[i]);
  const a = v.slice(i * n, i * n + n), b = v.slice((i + 1) * n, (i + 2) * n);
  if (n === 4) {
    let d = 0; for (let c = 0; c < 4; c++) d += a[c] * b[c];
    const sg = d < 0 ? -1 : 1;
    const r = [0, 1, 2, 3].map((c) => a[c] * (1 - k) + sg * b[c] * k);
    const l = Math.hypot(...r); return r.map((x) => x / l);
  }
  return [0, 1, 2].map((c) => a[c] * (1 - k) + b[c] * k);
}
