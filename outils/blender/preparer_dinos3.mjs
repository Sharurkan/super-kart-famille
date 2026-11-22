// node preparer_dinos3.mjs dossier_sources dossier_travail   (appelé par preparer_dinos3.sh)
// Pour chaque dinosaure : glTF Sketchfab → glTF « propre » pour le jeu (avant gltf-transform) :
//  - orientation : il regarde vers +Z, debout selon +Y (comme les Quaternius) ;
//  - animations découpées dans les clips d'origine et renommées Idle / Walk / Run / Attack / Eat ;
//    certaines sont fabriquées (« dérivées ») : on part d'un morceau d'un clip et on ajoute des
//    rotations aux os du cou, de la tête et de la mâchoire (ex. brouter, la tête au sol) ;
//  - plus de morphing, de spéculaire, d'occlusion, de tangentes ni de coordonnées UV en trop ;
//  - textures remplacées par les JPEG réduits (textures_dinos3.py).
import path from "node:path";
import * as THREE from "three";
import { chargerGltf, pistes, ecrirePistes, echantillon, souder } from "./gltf_brut.mjs";

const [SRC, W] = process.argv.slice(2);
const deg = Math.PI / 180;

// enveloppe « brouter » (0 = tête levée, 1 = tête au sol) sur un cycle de D secondes, qui boucle
const lisse = (x) => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
function brouter(D, haut = 0.3) { // haut : position de la tête quand il mâche, relevée
  return (t) => {
    const a = 0.12 * D, b = 0.68 * D, c = 0.85 * D; // descend, broute, remonte, mâche la tête haute
    let s;
    if (t < a) s = haut + (1 - haut) * lisse(t / a);
    else if (t < b) s = 1 + 0.06 * Math.sin(2 * Math.PI * (t - a) / (b - a) * 3); // petits coups de bec dans l'herbe
    else if (t < c) s = 1 - (1 - haut) * lisse((t - b) / (c - b));
    else s = haut;
    return s;
  };
}
const macher = (f) => (t) => 0.5 - 0.5 * Math.cos(2 * Math.PI * f * t);

const MODELES = [
  {
    nom: "trex",
    textures: { "material_0_diffuse.png": "trex-couleur.jpg", "material_0_normal.png": "trex-normale.jpg" },
    clips: [
      { nom: "Idle", source: "idle" },
      { nom: "Run", source: "run", debut: 0, fin: 8 },
      { nom: "Attack", source: "roar" },
      // « bite » se déplace de plusieurs mètres (bond en avant) : on fabrique plutôt un repas tête au sol
      {
        nom: "Eat", source: "idle", debut: 0, fin: 7,
        cou: { "bn_Spine1.5_5": 18, "bn_Spine2.6_6": 14, "bn_Neck.7_7": 14, "bn_Neck1.8_8": 12, "bn_Neck2.9_9": 10, "bn_Head.10_10": 0 },
        enveloppe: brouter(7, 0.1),
        machoire: { os: "bn_Jaw.11_11", angle: 16, rythme: macher(1.6) },
      },
    ],
  },
  {
    nom: "stego",
    textures: { "Material_diffuse.png": "stego-couleur.jpg", "Material_normal.png": "stego-normale.jpg", "Eyes_diffuse.png": "stego-yeux.jpg" },
    clips: [
      { nom: "Idle", source: "IdleB" },
      { nom: "Walk", source: "Walk" },
      { nom: "Run", source: "Run" },
      { nom: "Attack", source: "Roar" },
      { nom: "Eat", source: "Eat" },
    ],
  },
  {
    nom: "para",
    rotationY: -90 * deg, // il regardait vers +X
    textures: { "para_baseColor.png": "para-couleur.jpg", "para_normal.png": "para-normale.jpg", "eyes_baseColor.png": "para-yeux.jpg" },
    // le seul clip (« Action », 20,8 s) : debout à quatre pattes qui respire, puis se dresse sur ses pattes arrière
    clips: [
      { nom: "Idle", source: "Action", debut: 0, fin: 13 },
      { nom: "Attack", source: "Action", debut: 14, fin: 20.8 },
      {
        nom: "Eat", source: "Action", debut: 2, fin: 8, // 6 s de respiration + cou baissé jusqu'au sol
        // (les pattes avant sont accrochées à spine4 : on les contre-tourne pour qu'elles restent au sol)
        cou: { "spine4_22": 8, "right arm0_4": -8, "left arm0_9": -8, "neck0_21": 32, "neck1_20": 30, "neck2_19": 16, "neck3_18": 6, "head_17": -16 },
        enveloppe: brouter(6),
        machoire: { os: "jaw0_16", angle: 14, rythme: macher(2.2) },
      },
    ],
  },
  {
    nom: "sauropode",
    souder: true, // maillage « éclaté » (un sommet par coin de triangle, normales anguleuses)
    // la « carte AR » est penchée : matrice arrondie à la permutation d'axes la plus proche
    noeuds: { "Sketchfab_model_73": [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1] },
    rotationY: 90 * deg, // il regardait vers -X
    textures: { "mamenxilong_baseColor.jpeg": "sauro-couleur.jpg", "mamenxilong_normal.png": "sauro-normale.jpg" },
    // le seul clip (13,6 s) n'est pas une marche : il broute (0-4,5 s), lève le cou, regarde autour, rebroute
    clips: [
      { nom: "Idle", source: 0 },
      { nom: "Eat", source: 0, debut: 0, fin: 4.3, allerRetour: true },
    ],
  },
];

function segment(p, debut, fin, allerRetour, fondu = 0) {
  const T = p.temps, n = p.n;
  const temps = [0], valeurs = [...echantillon(p, debut)];
  for (let i = 0; i < T.length; i++) if (T[i] > debut + 1e-4 && T[i] < fin - 1e-4) { temps.push(T[i] - debut); valeurs.push(...p.valeurs.slice(i * n, i * n + n)); }
  temps.push(fin - debut); valeurs.push(...echantillon(p, fin));
  if (allerRetour) {
    const D = fin - debut, k = temps.length;
    for (let i = k - 2; i >= 0; i--) { temps.push(2 * D - temps[i]); valeurs.push(...valeurs.slice(i * n, i * n + n)); }
  } else if (fondu > 0) {
    // morceau découpé : la dernière seconde glisse vers la pose du début, pour que la boucle ne saute pas
    const D = fin - debut, v0 = valeurs.slice(0, n);
    for (let i = 0; i < temps.length; i++) {
      const w = lisse((temps[i] - (D - fondu)) / fondu);
      if (w <= 0) continue;
      let d = 0; if (n === 4) for (let c = 0; c < 4; c++) d += v0[c] * valeurs[i * n + c];
      const sg = n === 4 && d < 0 ? -1 : 1;
      for (let c = 0; c < n; c++) valeurs[i * n + c] = valeurs[i * n + c] * (1 - w) + sg * v0[c] * w;
      if (n === 4) { const l = Math.hypot(...valeurs.slice(i * n, i * n + 4)); for (let c = 0; c < 4; c++) valeurs[i * n + c] /= l; }
    }
  }
  return { ...p, temps: Float32Array.from(temps), valeurs: Float32Array.from(valeurs) };
}

// graphe three.js des nœuds, posé comme l'animation au temps t (pour connaître l'orientation des os)
function graphe(g, P, t) {
  const objs = g.nodes.map((n, i) => {
    const ob = new THREE.Object3D();
    if (n.matrix) new THREE.Matrix4().fromArray(n.matrix).decompose(ob.position, ob.quaternion, ob.scale);
    if (n.translation) ob.position.fromArray(n.translation);
    if (n.rotation) ob.quaternion.fromArray(n.rotation);
    if (n.scale) ob.scale.fromArray(n.scale);
    const tr = P.get(i + "/translation"), ro = P.get(i + "/rotation"), sc = P.get(i + "/scale");
    if (tr) ob.position.fromArray(echantillon(tr, t));
    if (ro) ob.quaternion.fromArray(echantillon(ro, t));
    if (sc) ob.scale.fromArray(echantillon(sc, t));
    return ob;
  });
  g.nodes.forEach((n, i) => (n.children || []).forEach((c) => objs[i].add(objs[c])));
  const racine = new THREE.Group();
  g.scenes[0].nodes.forEach((i) => racine.add(objs[i]));
  racine.updateMatrixWorld(true);
  return objs;
}

// Deux versions par dinosaure : normale, et « -loin » (pour les troupeaux au loin : moins de
// triangles, seulement Idle/Eat/Walk, couleur 512 sans normal map)
const CLIPS_LOIN = ["Idle", "Eat", "Walk"];
for (const M0 of MODELES) for (const loin of [false, true]) {
  const M = loin ? {
    ...M0, clips: M0.clips.filter((c) => CLIPS_LOIN.includes(c.nom)),
    textures: Object.fromEntries(Object.entries(M0.textures).filter(([, f]) => !f.includes("normale")).map(([k, f]) => [k, f.includes("couleur") ? f.replace(".jpg", "-512.jpg") : f])),
  } : M0;
  const o = chargerGltf(path.join(SRC, M.nom, "scene.gltf"));
  const g = o.g;
  const indice = (nom) => { const i = g.nodes.findIndex((n) => n.name === nom); if (i < 0) throw new Error("os introuvable " + nom); return i; };

  // --- orientation
  for (const [nom, m] of Object.entries(M.noeuds || {})) { const n = g.nodes[indice(nom)]; delete n.translation; delete n.rotation; delete n.scale; n.matrix = m; }
  if (M.rotationY) {
    for (const i of g.scenes[0].nodes) {
      const n = g.nodes[i];
      const m0 = new THREE.Matrix4();
      if (n.matrix) m0.fromArray(n.matrix);
      else m0.compose(new THREE.Vector3().fromArray(n.translation || [0, 0, 0]), new THREE.Quaternion().fromArray(n.rotation || [0, 0, 0, 1]), new THREE.Vector3().fromArray(n.scale || [1, 1, 1]));
      n.matrix = new THREE.Matrix4().makeRotationY(M.rotationY).multiply(m0).toArray();
      delete n.translation; delete n.rotation; delete n.scale;
    }
  }

  // --- animations
  const sources = g.animations.slice();
  const trouver = (s) => typeof s === "number" ? sources[s] : sources.find((a) => a.name === s);
  const nouvelles = [];
  for (const C of M.clips) {
    const src = trouver(C.source);
    if (!src) throw new Error(M.nom + " : clip introuvable " + C.source);
    const P = pistes(o, src);
    let fin0 = 0; for (const p of P.values()) fin0 = Math.max(fin0, p.temps[p.temps.length - 1]);
    const debut = C.debut ?? 0, fin = Math.min(C.fin ?? fin0, fin0);
    const coupe = debut > 0 || fin < fin0 - 0.05;
    let liste = [...P.values()].map((p) => segment(p, debut, fin, C.allerRetour, coupe ? C.fondu ?? 0.8 : 0));
    if (C.cou) {
      // rotations ajoutées : autour de l'axe gauche-droite du monde (+X : le dinosaure regarde vers +Z),
      // exprimé dans le repère de chaque os (pris dans la pose de départ)
      const objs = graphe(g, P, debut);
      const D = fin - debut, pas = 1 / 30, nb = Math.round(D / pas) + 1;
      const axeMonde = new THREE.Vector3(1, 0, 0);
      const ajout = { ...C.cou };
      if (C.machoire) ajout[C.machoire.os] = 0;
      for (const [nomOs, angle] of Object.entries(ajout)) {
        const i = indice(nomOs);
        const qMonde = objs[i].getWorldQuaternion(new THREE.Quaternion());
        const axe = axeMonde.clone().applyQuaternion(qMonde.invert()).normalize();
        const base = liste.find((p) => p.noeud === i && p.chemin === "rotation");
        const rest = g.nodes[i].rotation || [0, 0, 0, 1];
        const temps = [], valeurs = [];
        const q = new THREE.Quaternion(), dq = new THREE.Quaternion();
        for (let k = 0; k < nb; k++) {
          const t = Math.min(k * pas, D);
          q.fromArray(base ? echantillon(base, t) : rest);
          let a = angle * C.enveloppe(t);
          if (C.machoire && nomOs === C.machoire.os) a += C.machoire.angle * C.machoire.rythme(t);
          dq.setFromAxisAngle(axe, a * deg);
          q.multiply(dq);
          temps.push(t); valeurs.push(q.x, q.y, q.z, q.w);
        }
        const piste = { noeud: i, chemin: "rotation", n: 4, temps: Float32Array.from(temps), valeurs: Float32Array.from(valeurs) };
        liste = liste.filter((p) => p !== base).concat([piste]);
      }
    }
    const anim = { name: C.nom, channels: [], samplers: [] };
    ecrirePistes(o, anim, liste);
    nouvelles.push(anim);
    console.log(M.nom, C.nom, "←", src.name, debut.toFixed(2) + "-" + fin.toFixed(2) + "s", liste.length, "pistes");
  }
  g.animations = nouvelles;

  // --- maillages : ni morphing ni attributs inutiles
  for (const m of g.meshes) {
    delete m.weights; if (m.extras) delete m.extras.targetNames;
    for (const p of m.primitives) {
      delete p.targets;
      for (const a of Object.keys(p.attributes)) if (/^TEXCOORD_[1-9]|^TANGENT$|^COLOR_/.test(a)) delete p.attributes[a];
      if (M.souder) console.log(M.nom, "soudure", souder(o, p));
    }
  }
  // --- matériaux : couleur + normal map seulement
  for (const mat of g.materials) {
    const sg = mat.extensions?.KHR_materials_pbrSpecularGlossiness;
    mat.pbrMetallicRoughness = { baseColorTexture: sg ? sg.diffuseTexture : mat.pbrMetallicRoughness?.baseColorTexture, metallicFactor: 0, roughnessFactor: 0.85 };
    delete mat.extensions; delete mat.occlusionTexture; delete mat.emissiveTexture;
  }
  g.extensionsUsed = (g.extensionsUsed || []).filter((e) => !e.startsWith("KHR_materials_"));
  if (g.extensionsRequired) g.extensionsRequired = g.extensionsRequired.filter((e) => !e.startsWith("KHR_materials_"));
  // --- textures remplacées (JPEG réduits), les autres retirées
  const garder = new Set();
  g.images.forEach((im, i) => {
    const base = path.basename(decodeURIComponent(im.uri));
    if (M.textures[base]) { im.absolu = path.join(W, "tex", M.textures[base]); im.mimeType = "image/jpeg"; garder.add(i); }
  });
  for (const mat of g.materials) {
    const ok = (t) => t && garder.has(g.textures[t.index].source);
    if (!ok(mat.normalTexture)) delete mat.normalTexture;
    if (!ok(mat.pbrMetallicRoughness.baseColorTexture)) delete mat.pbrMetallicRoughness.baseColorTexture;
  }
  o.ecrire(path.join(W, M.nom + (loin ? "-loin" : "") + ".gltf"));
  console.log(M.nom, "extensions", g.extensionsUsed, "images", g.images.filter((_, i) => garder.has(i)).map((im) => path.basename(im.uri)));
}
