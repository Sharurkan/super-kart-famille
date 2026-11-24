import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { laveProbable } from "./lave-carte.js";

// Beaucoup de vélociraptors (circuit Dinosaures) : des meutes qui courent dans les plaines derrière
// un chef, des chasseurs qui rôdent et bondissent près de la route, et quelques coureurs qui font la
// course avec le kart le long des barrières (jamais dessus).
//
// Perf tablette : des dizaines de squelettes animés (137 os chacun) coûteraient trop cher. Les
// animations du modèle (velociraptor-pbr.glb) sont donc « cuites » une fois au chargement : la forme
// de chaque sommet, image par image, est rangée dans une texture (« vertex animation texture »).
// Tous les raptors sont dessinés par 4 InstancedMesh (2 matériaux × 2 niveaux de détail) ; la carte
// graphique lit la forme dans la texture. Par image, le processeur ne fait que placer les raptors
// visibles (aucun squelette, aucun AnimationMixer) ; ceux hors champ ou trop loin ne sont pas dessinés.
// Au-delà de DIST_LOD, version « loin » (velociraptor-loin.json : mêmes sommets, ~4 fois moins de
// triangles, voir outils/raptor-loin.mjs) sans normal map.
//
// Tout reste hors de la route (garde de vegetation.js, sur l'emprise du modèle), dans les plaines
// (pas dans la jungle dense), hors de la lave du 3e tour (lave-carte.js) et loin des autres dinosaures.

const BASE = import.meta.env.BASE_URL + "dinos/";
// clips cuits et nombre d'images par seconde dans la texture
const CLIPS = { Run: 24, Walk: 20, Idle: 10, Attack: 15, Eat: 12 };
const LARGEUR_TEX = 1024; // texels par ligne (le n° du texel = image × nb de sommets + sommet)
const DIST_LOD = 70, DIST_MAX = 330; // m : version « loin » au-delà ; plus rien au-delà (brouillard)
const FONDU = 0.25; // s : passage d'une animation à l'autre
const HAUTEUR = 2.2; // m, taille réelle ; S multiplie

// ---------------------------------------------------------------------------
// Modèle : chargement et cuisson des animations (une seule fois, partagé entre les courses)
let modele = null;
function chargerModele() {
  return (modele ??= preparer());
}
const souffler = () => new Promise((r) => setTimeout(r, 0)); // laisse respirer la page pendant la cuisson

async function preparer() {
  const debut = performance.now();
  const [gltf, loin] = await Promise.all([
    new GLTFLoader().loadAsync(BASE + "velociraptor-pbr.glb"),
    fetch(BASE + "velociraptor-loin.json").then((r) => r.json()).catch(() => null),
  ]);
  const scene = gltf.scene;
  const parties = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) parties.push(o); });
  const numero = (o) => gltf.parser.associations.get(o)?.meshes ?? 0;
  parties.sort((a, b) => numero(a) - numero(b)); // ordre du fichier (velociraptor-loin.json aussi)
  const decalage = [];
  let NV = 0;
  for (const m of parties) { decalage.push(NV); NV += m.geometry.attributes.position.count; }

  // sommets dans le repère de liaison (bindMatrix appliquée), poids normalisés
  const prep = parties.map((m) => {
    const g = m.geometry, P = g.attributes.position, Nn = g.attributes.normal, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    const n = P.count, q = new Float32Array(n * 3), nr = new Float32Array(n * 3), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const v = new THREE.Vector3(), mn = new THREE.Matrix3().getNormalMatrix(m.bindMatrix);
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(P, k).applyMatrix4(m.bindMatrix);
      q.set([v.x, v.y, v.z], k * 3);
      v.fromBufferAttribute(Nn, k).applyMatrix3(mn).normalize();
      nr.set([v.x, v.y, v.z], k * 3);
      let s = 0;
      for (let j = 0; j < 4; j++) { si[k * 4 + j] = SI.getComponent(k, j); s += (sw[k * 4 + j] = SW.getComponent(k, j)); }
      if (s > 0) for (let j = 0; j < 4; j++) sw[k * 4 + j] /= s;
    }
    return { m, n, q, nr, si, sw };
  });

  // images à cuire
  const liste = [];
  let nbImages = 0;
  for (const [nom, fps] of Object.entries(CLIPS)) {
    const clip = gltf.animations.find((a) => a.name === nom);
    if (!clip) continue;
    const nb = Math.max(2, Math.round(clip.duration * fps));
    liste.push({ nom, clip, debut: nbImages, nb, duree: clip.duration });
    nbImages += nb;
  }
  const H = Math.ceil((nbImages * NV) / LARGEUR_TEX);
  const pos = new Float32Array(LARGEUR_TEX * H * 4), nor = new Float32Array(LARGEUR_TEX * H * 4);
  const racine = parties[0].skeleton.bones[0];
  const racineZ = new Float32Array(nbImages);
  const mixer = new THREE.AnimationMixer(scene);
  const A = new THREE.Matrix4();
  let calcul = 0, t1 = performance.now();
  const charge = t1 - debut;
  for (const C of liste) {
    mixer.stopAllAction();
    mixer.clipAction(C.clip).reset().play();
    for (let f = 0; f < C.nb; f++) {
      mixer.setTime((f * C.duree) / C.nb);
      scene.updateMatrixWorld(true);
      const img = C.debut + f;
      racineZ[img] = racine.matrixWorld.elements[14];
      for (let p = 0; p < prep.length; p++) {
        const { m, n, q, nr, si, sw } = prep[p];
        m.skeleton.update();
        const B = m.skeleton.boneMatrices, a = A.multiplyMatrices(m.matrixWorld, m.bindMatrixInverse).elements;
        for (let k = 0; k < n; k++) {
          let s0 = 0, s1 = 0, s2 = 0, s4 = 0, s5 = 0, s6 = 0, s8 = 0, s9 = 0, s10 = 0, s12 = 0, s13 = 0, s14 = 0;
          for (let j = 0; j < 4; j++) {
            const w = sw[k * 4 + j];
            if (!w) continue;
            const o = si[k * 4 + j] * 16;
            s0 += w * B[o]; s1 += w * B[o + 1]; s2 += w * B[o + 2];
            s4 += w * B[o + 4]; s5 += w * B[o + 5]; s6 += w * B[o + 6];
            s8 += w * B[o + 8]; s9 += w * B[o + 9]; s10 += w * B[o + 10];
            s12 += w * B[o + 12]; s13 += w * B[o + 13]; s14 += w * B[o + 14];
          }
          const qx = q[k * 3], qy = q[k * 3 + 1], qz = q[k * 3 + 2];
          const rx = s0 * qx + s4 * qy + s8 * qz + s12, ry = s1 * qx + s5 * qy + s9 * qz + s13, rz = s2 * qx + s6 * qy + s10 * qz + s14;
          const nx = nr[k * 3], ny = nr[k * 3 + 1], nz = nr[k * 3 + 2];
          const ux = s0 * nx + s4 * ny + s8 * nz, uy = s1 * nx + s5 * ny + s9 * nz, uz = s2 * nx + s6 * ny + s10 * nz;
          const t = (img * NV + decalage[p] + k) * 4;
          pos[t] = a[0] * rx + a[4] * ry + a[8] * rz + a[12];
          pos[t + 1] = a[1] * rx + a[5] * ry + a[9] * rz + a[13];
          pos[t + 2] = a[2] * rx + a[6] * ry + a[10] * rz + a[14];
          const wx = a[0] * ux + a[4] * uy + a[8] * uz, wy = a[1] * ux + a[5] * uy + a[9] * uz, wz = a[2] * ux + a[6] * uy + a[10] * uz;
          const l = Math.hypot(wx, wy, wz) || 1;
          nor[t] = wx / l; nor[t + 1] = wy / l; nor[t + 2] = wz / l;
        }
      }
    }
    calcul += performance.now() - t1;
    await souffler();
    t1 = performance.now();
  }
  mixer.stopAllAction();

  // course sur place : si l'os racine avance pendant la course ou la marche, on retire son avancée
  const clip = (nom) => liste.find((c) => c.nom === nom);
  for (const nom of ["Run", "Walk"]) {
    const C = clip(nom);
    if (!C) continue;
    let mi = Infinity, ma = -Infinity;
    for (let f = 0; f < C.nb; f++) { mi = Math.min(mi, racineZ[C.debut + f]); ma = Math.max(ma, racineZ[C.debut + f]); }
    C.racineAvance = ma - mi;
  }
  // repère commun : hauteur 1 (pose « Idle » du début), pieds à y = 0, corps centré en x et z
  const I = clip("Idle") ?? liste[0];
  let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < NV; k++) {
    const t = (I.debut * NV + k) * 4;
    y0 = Math.min(y0, pos[t + 1]); y1 = Math.max(y1, pos[t + 1]);
    x0 = Math.min(x0, pos[t]); x1 = Math.max(x1, pos[t]); z0 = Math.min(z0, pos[t + 2]); z1 = Math.max(z1, pos[t + 2]);
  }
  const haut = y1 - y0, ox = (x0 + x1) / 2, oz = (z0 + z1) / 2;
  for (const C of liste) {
    const enPlace = C.racineAvance > 0.25 * haut; // vraie avancée (pas seulement le balancement)
    for (let f = 0; f < C.nb; f++) {
      const img = C.debut + f, dz = enPlace ? racineZ[img] - racineZ[C.debut] : 0;
      for (let k = 0; k < NV; k++) {
        const t = (img * NV + k) * 4;
        pos[t] = (pos[t] - ox) / haut;
        pos[t + 1] = (pos[t + 1] - y0) / haut;
        pos[t + 2] = (pos[t + 2] - oz - dz) / haut;
      }
    }
  }
  // vitesse sans glissade (en hauteurs par seconde, animation à vitesse 1) : le pied posé au sol
  // (sommet le plus bas) recule à la vitesse où le corps avance
  const vitessePied = (C) => {
    const v = [];
    for (let f = 0; f < C.nb; f++) {
      const a = C.debut + f, b = C.debut + ((f + 1) % C.nb);
      let kMin = 0, yMin = Infinity;
      for (let k = 0; k < NV; k++) { const y = pos[(a * NV + k) * 4 + 1]; if (y < yMin) { yMin = y; kMin = k; } }
      const dz = pos[(b * NV + kMin) * 4 + 2] - pos[(a * NV + kMin) * 4 + 2];
      if (dz < 0) v.push((-dz * C.nb) / C.duree);
    }
    v.sort((p, q) => p - q);
    return v.length ? v[Math.floor(v.length / 2)] : 1;
  };
  for (const nom of ["Run", "Walk"]) if (clip(nom)) clip(nom).vitesse = vitessePied(clip(nom));
  // boîte de toutes les images de toutes les animations (emprise au sol, sauts compris)
  const boite = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let k = 0; k < nbImages * NV; k++) boite.expandByPoint(v.set(pos[k * 4], pos[k * 4 + 1], pos[k * 4 + 2]));

  // textures (demi-flottants)
  const demi = (src) => {
    const d = new Uint16Array(src.length);
    for (let k = 0; k < src.length; k++) d[k] = THREE.DataUtils.toHalfFloat(src[k]);
    const t = new THREE.DataTexture(d, LARGEUR_TEX, H, THREE.RGBAFormat, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  const uniforms = { tVatPos: { value: demi(pos) }, tVatNor: { value: demi(nor) }, uNbSommets: { value: NV } };

  // géométries (sans squelette) : n° de sommet dans la texture ; « loin » : moins de triangles
  const geos = { pres: [], loin: [] };
  parties.forEach((m, p) => {
    const g0 = m.geometry, g = new THREE.BufferGeometry();
    g.setAttribute("position", g0.attributes.position);
    g.setAttribute("uv", g0.attributes.uv);
    const s = new Float32Array(g0.attributes.position.count);
    for (let k = 0; k < s.length; k++) s[k] = decalage[p] + k;
    g.setAttribute("aSommet", new THREE.BufferAttribute(s, 1));
    g.setIndex(g0.index);
    geos.pres.push(g);
    const tri = loin?.parties?.find((x) => x.maillage === numero(m))?.triangles;
    const gl = g.clone();
    if (tri) gl.setIndex(tri);
    geos.loin.push(gl);
  });
  // matériaux : comme les autres dinosaures (dinos.js), la forme vient de la texture d'animation
  const mats = { pres: [], loin: [] };
  for (const m of parties) {
    const a = m.material;
    for (const lod of ["pres", "loin"]) {
      const mat = new THREE.MeshPhongMaterial({ map: a.map, normalMap: lod === "pres" ? a.normalMap : null, shininess: 12, specular: 0x1a1a1a, side: a.side });
      mat.userData.partage = true; // gardé d'une course à l'autre (liberer.js)
      mat.onBeforeCompile = (sh) => vatShader(sh, uniforms);
      mat.customProgramCacheKey = () => "raptor-vat-" + lod;
      mats[lod].push(mat);
    }
  }
  const dico = Object.fromEntries(liste.map((c) => [c.nom, { debut: c.debut, nb: c.nb, duree: c.duree, vitesse: c.vitesse ?? 0 }]));
  if (import.meta.env.DEV) console.info(`raptors : ${nbImages} images × ${NV} sommets (texture ${LARGEUR_TEX}×${H}), course ${dico.Run?.vitesse?.toFixed(2)} h/s, marche ${dico.Walk?.vitesse?.toFixed(2)} h/s`);
  calcul += performance.now() - t1;
  return { tempsCuisson: { total: Math.round(performance.now() - debut), chargement: Math.round(charge), calcul: Math.round(calcul) }, geos, mats, clips: dico, boite, triangles: { pres: parties.reduce((s, m) => s + m.geometry.index.count / 3, 0), loin: geos.loin.reduce((s, g) => s + g.index.count / 3, 0) } };
}

/** Shader : la forme et la normale du sommet viennent de la texture (deux animations mélangées). */
function vatShader(sh, uniforms) {
  Object.assign(sh.uniforms, uniforms);
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", `#include <common>
      uniform highp sampler2D tVatPos;
      uniform highp sampler2D tVatNor;
      uniform int uNbSommets;
      attribute float aSommet;
      attribute vec4 aClipA; // 1re animation : 1re image, nb d'images, image en cours (réelle) ; mélange vers la 2e
      attribute vec3 aClipB; // 2e animation : 1re image, nb d'images, image en cours
      vec3 vatLire(highp sampler2D t, int image, int s) {
        int k = image * uNbSommets + s;
        return texelFetch(t, ivec2(k % ${LARGEUR_TEX}, k / ${LARGEUR_TEX}), 0).xyz;
      }
      void vatClip(vec3 c, out vec3 p, out vec3 n) {
        int nb = int(c.y + 0.5), d = int(c.x + 0.5), s = int(aSommet + 0.5);
        float f = mod(c.z, c.y);
        int f0 = int(floor(f)), f1 = f0 + 1;
        if (f1 >= nb) f1 = 0;
        float a = fract(f);
        p = mix(vatLire(tVatPos, d + f0, s), vatLire(tVatPos, d + f1, s), a);
        n = mix(vatLire(tVatNor, d + f0, s), vatLire(tVatNor, d + f1, s), a);
      }`)
    .replace("#include <beginnormal_vertex>", `
      vec3 vatP, vatN;
      vatClip(aClipA.xyz, vatP, vatN);
      if (aClipA.w > 0.001) {
        vec3 p2, n2;
        vatClip(aClipB, p2, n2);
        vatP = mix(vatP, p2, aClipA.w);
        vatN = mix(vatN, n2, aClipA.w);
      }
      vec3 objectNormal = normalize(vatN);`)
    .replace("#include <begin_vertex>", "vec3 transformed = vatP;");
}

// ---------------------------------------------------------------------------
// Placement et comportements
function alea(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Installe les raptors (le placement est fait tout de suite ; les modèles arrivent plus tard).
 * garde : gardeRoute (vegetation.js), une fois tous les grands décors posés sur la piste ;
 * plaines : [{ debut, fin, cote, largeur }] (decors-themes.js) ; clairieres : [{ x, z, occupe }]
 * (troupeaux, à éviter) ; evite : [{ x, z, r }] (pied du volcan...).
 * Les trajets sont réservés dans la garde : arbres, rochers et plantes plantés ensuite les évitent.
 * Renvoie update(dt, camera).
 */
export function installerRaptors(groupe, piste, { garde, plaines, clairieres = [], evite = [], graine = 1234 }) {
  // essais de performance (développement) : localStorage.sansRaptors = 1 -> aucun raptor
  if (import.meta.env.DEV) { try { if (localStorage.sansRaptors === "1") return () => {}; } catch {} }
  const rnd = alea(graine), debutPlacement = performance.now();
  const { N, pas, cx, cz, nx, nz, tx, tz } = piste;
  const bord = piste.demi + piste.marge; // de l'axe aux barrières (comme uBordLave, lave.js)
  const ecart = (i, j) => { const d = (((i - j) % N) + N) % N; return d > N / 2 ? d - N : d; };
  // emprise en hauteurs (boîte de toutes les images de toutes les animations, mesurée sur le modèle :
  // x de -0,5 à 0,45, z de -1,28 à 1,18) ; vérifiée au chargement avec la vraie boîte (trajetGene)
  const DL = 1.3, DW = 0.5;
  // ouverture de la plaine (même formule que planterJungle, vegetation.js) : 0 = jungle, 1 = plaine
  const RAMPE = 28;
  const ouverture = (i, lat) => {
    let o = 0;
    for (const P of plaines) {
      if (Math.sign(lat) !== P.cote) continue;
      const long = (P.fin - P.debut + N) % N, d = ecart(i, P.debut);
      if (d < -RAMPE || d > long + RAMPE) continue;
      const t = Math.max(0, Math.min(1, Math.min(d + RAMPE, long + RAMPE - d) / RAMPE));
      const fond = Math.max(0, Math.min(1, (P.largeur - Math.abs(lat)) / 30));
      o = Math.max(o, t * t * (3 - 2 * t) * fond);
    }
    return o;
  };
  const reserves = []; // zones déjà prises par les raptors : { x, z, r }
  const reserver = (x, z, r) => { reserves.push({ x, z, r }); garde.interdire?.(x, z, r); };
  const refus = {}; // raisons des places refusées (outil de test)
  const non = (r) => { refus[r] = (refus[r] ?? 0) + 1; return false; };
  /** Disque (x, z, R) libre : route et grands décors (garde), plaine, lave, autres dinosaures. */
  function raisonDisque(x, z, R, h, ouvMin = 0.9) {
    const pb = garde.probleme(x, z, R, h);
    if (pb) return pb;
    for (const c of clairieres) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.occupe + R) ** 2) return "troupeau";
    for (const c of evite) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + R) ** 2) return "volcan";
    for (const c of reserves) if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + R + 2) ** 2) return "raptors";
    const L = piste.localiser(x, z), i = L.indice;
    // centre, 8 points à mi-rayon, 16 sur le bord (calculs légers : pas de recherche sur la piste)
    for (let a = -1; a < 24; a++) {
      const ang = a < 8 ? a * 0.785 : (a - 8) * 0.3927, rr = a < 0 ? 0 : a < 8 ? R / 2 : R;
      const dx = Math.cos(ang) * rr, dz = Math.sin(ang) * rr;
      const lat = L.lateral + dx * nx[i] + dz * nz[i];
      const j = (i + Math.round((dx * tx[i] + dz * tz[i]) / pas) + N) % N;
      if (ouverture(j, lat) < ouvMin) return "jungle";
      if (laveProbable(x + dx, z + dz, Math.abs(lat), bord)) return "lave";
    }
    return "";
  }
  const disqueLibre = (x, z, R, h, ouvMin) => { const r = raisonDisque(x, z, R, h, ouvMin); return r ? non(r) : true; };
  const point = (i, lat) => ({ x: cx[i] + nx[i] * lat, z: cz[i] + nz[i] * lat });
  const groupes = [];
  // portions où la route passe dans un grand décor fermé (ventre du T-rex, tranchée, aquarium) :
  // de là, on ne voit rien autour ; les chasseurs (près de la route) n'y vont pas
  const dansZone = (i, Z) => ((i - Z.debut + N) % N) <= ((Z.fin - Z.debut + N) % N);
  const enTunnel = (i) => (piste.zonesDecor ?? []).some((Z) => /trex|tranch|aquarium/i.test(Z.nom ?? "") && dansZone(i, Z));

  // --- coureurs : en file, dans une voie juste derrière les barrières, sur une ligne droite dégagée ---
  // Voie à bord + 5,1 m de l'axe (barrières à bord + 0,8) : le corps reste derrière les barrières et
  // n'atteint pas la lave du 3e tour (elle commence à bord + 6 m, lave.js : smoothstep(b + 6, b + 9)).
  // Plus loin (21-34 m), les rivières de lave longent plus de la moitié du tour.
  const VOIES = [bord + 5.1];
  function voieLibre(i, lat, h) {
    const P = point(i, lat), dl = DL * h + 1.6, dw = DW * h + 1.6; // (marge de trajetGene : 1,5 m)
    for (const [u, w] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const px = P.x + tx[i] * u * dl + nx[i] * w * dw, pz = P.z + tz[i] * u * dl + nz[i] * w * dw;
      const pb = garde.probleme(px, pz, 0.5, 1.1);
      if (pb) return non("voie-" + pb);
    }
    const pb = garde.probleme(P.x, P.z, DW * h, h);
    if (pb) return non("voie-" + pb);
    for (const c of clairieres) if ((P.x - c.x) ** 2 + (P.z - c.z) ** 2 < (c.occupe + dl) ** 2) return non("voie-troupeau");
    for (const c of evite) if ((P.x - c.x) ** 2 + (P.z - c.z) ** 2 < (c.r + dl) ** 2) return non("voie-volcan");
    return true;
  }
  // Les plaines sont prises jusqu'aux barrières (troupeaux, T-rex couché, ravin) : les coureurs
  // cherchent sur tout le tour, des deux côtés. Dans la jungle, leur couloir (jusqu'à ~23 m de
  // l'axe) est réservé dans la garde : arbres et sous-bois n'y sont pas plantés, on les voit courir
  // sur une piste dégagée le long des barrières, la forêt derrière eux.
  function planCoureurs(S, combien) {
    const h = HAUTEUR * S, cands = [], PAS = 2;
    for (const cote of [1, -1]) {
      const ok = [];
      for (let i = 0; i < N; i += PAS) ok.push(VOIES.every((l) => voieLibre(i, l * cote, h)));
      const n = ok.length, k0 = ok.indexOf(false);
      if (k0 < 0) continue; // (tout est libre : impossible en pratique)
      let debut = -1;
      for (let q = 1; q <= n; q++) {
        const k = (k0 + q) % n;
        if (ok[k] && debut < 0) debut = q;
        if (!ok[k] && debut >= 0) {
          const nb = (q - 1 - debut) * PAS; // échantillons libres
          // (3 m retirés à chaque bout, par prudence : voieLibre vérifie déjà la longueur du corps)
          const bout = Math.round(3 / pas);
          if ((nb - 2 * bout) * pas >= 45) cands.push({ cote, i0: (((k0 + debut) % n) * PAS + bout) % N, n: Math.min(nb - 2 * bout, Math.round(170 / pas)) });
          debut = -1;
        }
      }
    }
    // les plus longues lignes droites, et pas deux fois au même endroit (côtés opposés compris)
    cands.sort((a, b) => b.n - a.n);
    const pris = [];
    for (const c of cands) {
      if (pris.length >= combien) break;
      // (les deux côtés au même endroit : permis, ils courent alors de part et d'autre du kart)
      if (pris.some((p) => p.cote === c.cote && Math.abs(ecart(c.i0 + c.n / 2, p.i0 + p.n / 2)) < (c.n + p.n) / 2 + 40)) continue;
      pris.push(c);
      const L = c.n * pas;
      const g = { type: "coureurs", S, h, i0: c.i0, L, cote: c.cote, membres: [], etat: "attend", tAttente: 0 };
      // trois coureurs en file (14 m d'écart), un devant le kart, un à sa hauteur, un derrière
      [[0, 30, 16], [0, 16, 2], [0, 2, -12]].forEach(([voie, maison, devant], k) => g.membres.push({ voie: VOIES[voie] * c.cote, maison, devant, s: maison, v: 0, echelle: 0.95 + rnd() * 0.1, k }));
      for (let s = 0; s <= L; s += 4) for (const l of VOIES) { const p = positionVoie(g, s, l * c.cote); reserver(p.x, p.z, DW * h + 2.5); }
      groupes.push(g);
    }
  }
  /** Point de la voie (distance s depuis le début du segment, latéral lat) et direction de la route. */
  function positionVoie(g, s, lat) {
    const f = g.i0 + s / pas, k = Math.floor(f), a = f - k, i = ((k % N) + N) % N, j = (i + 1) % N;
    const ex = nx[i] + (nx[j] - nx[i]) * a, ez = nz[i] + (nz[j] - nz[i]) * a;
    return {
      x: cx[i] + (cx[j] - cx[i]) * a + ex * lat, z: cz[i] + (cz[j] - cz[i]) * a + ez * lat,
      angle: Math.atan2(tx[i] + (tx[j] - tx[i]) * a, tz[i] + (tz[j] - tz[i]) * a),
    };
  }

  // --- chasseurs : rôdent en rond près de la route, l'un après l'autre bondit au centre et rugit ---
  function planChasseurs(n, S) {
    const h = HAUTEUR * S;
    for (let essai = 0; essai < 300; essai++) {
      const P = plaines[Math.floor(rnd() * plaines.length)], long = (P.fin - P.debut + N) % N;
      const r = 7 + rnd() * 2.5, R = r + DL * h + 1.5;
      const i = (P.debut + Math.floor(rnd() * long)) % N;
      if (enTunnel(i)) { non("tunnel"); continue; } // invisibles depuis la route
      // près de la route de préférence (essais suivants : un peu plus loin)
      const lat = (bord + 4 + R + rnd() * (20 + essai / 3)) * P.cote;
      const C = point(i, lat);
      if (!disqueLibre(C.x, C.z, R, h)) continue;
      // lave : vraie distance à la route (comme la vérification au chargement) sur leur cercle et au centre
      let lave = false;
      for (let a = 0; a < 24 && !lave; a++) {
        const rr = a < 8 ? r / 2 : r + 2, ang = a < 8 ? a * 0.785 : (a - 8) * 0.3927;
        const x = C.x + Math.cos(ang) * rr, z = C.z + Math.sin(ang) * rr;
        lave = laveProbable(x, z, Math.abs(piste.localiser(x, z, i).lateral), bord);
      }
      if (lave) { non("lave-cercle"); continue; }
      reserver(C.x, C.z, R);
      const g = { type: "chasseurs", S, h, C, r, R, n, w: 0, a0: rnd() * 6.283, sens: rnd() < 0.5 ? 1 : -1, periode: 7 + rnd() * 2, membres: [] };
      for (let k = 0; k < n; k++) g.membres.push({ k, echelle: 0.93 + rnd() * 0.14 });
      groupes.push(g);
      return;
    }
  }

  // --- meutes : courent derrière leur chef sur une boucle irrégulière dans une plaine ---
  // Les plaines libres (entre troupeaux, mares de lave et jungle) sont rares et étroites : une grille
  // des places libres est calculée une fois (disque de rayon RM libre en chaque case), les boucles
  // possibles y sont toutes essayées (rapide), puis la boucle choisie est vérifiée exactement.
  // La boucle est un « stade » (deux lignes droites, deux demi-tours de rayon b), le long de la route
  // ou en travers, un peu déformé.
  const ECART = 3.0, BALANCE = 0.8;
  // R : demi-largeur du couloir de la meute (les corps sont dans le sens de la course : demi-largeur
  // du corps, écart des flancs, balancement, marge, et 2 m pour la corde du corps dans les virages)
  const rayonMeute = (h) => DW * h + ECART + BALANCE + 1.5 + 2;
  const PAS_G = 4; // m, côté d'une case de la grille
  let grilles = null, RM = 0;
  function construireGrilles(R) {
    RM = R;
    grilles = plaines.map((P) => {
      const long = (P.fin - P.debut + N) % N, kPas = Math.max(1, Math.round(PAS_G / pas));
      const k0 = -RAMPE, nk = Math.ceil((long + 2 * RAMPE) / kPas) + 1, l0 = bord + 4, nl = Math.ceil((P.largeur - l0) / PAS_G) + 1;
      const libre = new Uint8Array(nk * nl);
      for (let a = 0; a < nk; a++) {
        const i = (P.debut + k0 + a * kPas + N) % N;
        for (let b = 0; b < nl; b++) {
          const p = point(i, (l0 + b * PAS_G) * P.cote);
          // (hauteur 1 m : la vue de la caméra est vérifiée plus tard, sur la boucle choisie)
          libre[a * nl + b] = raisonDisque(p.x, p.z, R - 1.5, 1.0) ? 0 : 1; // (un peu permissive : la boucle choisie est vérifiée exactement)
        }
      }
      return { P, long, kPas, k0, nk, l0, nl, libre };
    });
  }
  /** Case de la grille G (repère de l'échantillon ic) libre pour le point local (u le long de la route, v vers l'extérieur). */
  function caseLibre(G, ic, latC, u, v) {
    const a = Math.round((ecart(ic, G.P.debut) + u / pas - G.k0) / G.kPas), b = Math.round((latC + v - G.l0) / PAS_G);
    return a >= 0 && a < G.nk && b >= 0 && b < G.nl && G.libre[a * G.nl + b] === 1;
  }
  /** Points (u, v) du stade : demi-ligne droite c, rayon b, tourné de rot (0 : le long de la route). */
  function stade(c, b, rot, nS, ph1 = 0, ph2 = 0, amp = 0) {
    const per = 4 * c + 2 * Math.PI * b, co = Math.cos(rot), si = Math.sin(rot), pts = [];
    for (let k = 0; k < nS; k++) {
      let q = (k / nS) * per, u, v;
      if (q < 2 * c) { u = -c + q; v = b; }
      else if ((q -= 2 * c) < Math.PI * b) { const a = q / b; u = c + Math.sin(a) * b; v = Math.cos(a) * b; }
      else if ((q -= Math.PI * b) < 2 * c) { u = c - q; v = -b; }
      else { const a = (q - 2 * c) / b; u = -c - Math.sin(a) * b; v = -Math.cos(a) * b; }
      // un peu irrégulier : la largeur ondule doucement le long de la boucle
      const w = (k / nS) * 2 * Math.PI, f = 1 + amp * (0.57 * Math.sin(w + ph1) + 0.43 * Math.sin(2 * w + ph2));
      pts.push([(u * co - v * si) * f, (u * si + v * co) * f]);
    }
    return pts;
  }
  const FORMES = [];
  for (const travers of [false, true]) for (const c of [4, 10, 18, 26]) for (const b of [9.5, 12]) FORMES.push({ travers, c, b });
  const refusees = new Set(); // boucles refusées à la vérification exacte
  function planMeute(n, S) {
    const h = HAUTEUR * S, R = rayonMeute(h);
    if (!grilles || R > RM) construireGrilles(R);
    // toutes les boucles possibles dans la grille
    const cands = [];
    for (const G of grilles) for (const F of FORMES) {
      const pts = stade(F.c, F.b, F.travers ? Math.PI / 2 : 0, Math.ceil((4 * F.c + 2 * Math.PI * F.b) / 4));
      const demiLarge = (F.travers ? F.c : 0) + F.b;
      for (let kk = -RAMPE; kk <= G.long + RAMPE; kk += 6) {
        const ic = (G.P.debut + kk + N) % N;
        for (let lat = G.l0 + demiLarge; lat <= G.P.largeur - 30 - demiLarge; lat += 6) {
          const cle = `${ic},${lat},${F.travers},${F.c}`;
          if (refusees.has(cle) || !caseLibre(G, ic, lat, 0, 0)) continue;
          if (pts.every(([u, v]) => caseLibre(G, ic, lat, u, v))) cands.push({ G, F, ic, lat, cle, bord: lat - demiLarge });
        }
      }
    }
    // près de la route de préférence (on les voit), au hasard parmi les plus proches
    cands.sort((p, q) => p.bord - q.bord);
    while (cands.length) {
      const proches = cands.filter((q) => q.bord <= cands[0].bord + 30);
      const choix = proches[Math.floor(rnd() * proches.length)];
      cands.splice(cands.indexOf(choix), 1);
      const { G, F, ic } = choix, P = G.P, C = point(ic, choix.lat * P.cote);
      // forme définitive (déformée, un peu tournée), en coordonnées du monde
      const rot = (F.travers ? Math.PI / 2 : 0) + (rnd() - 0.5) * 0.3;
      const nS = Math.ceil((4 * F.c + 2 * Math.PI * F.b) / 2);
      const loc = stade(F.c, F.b, rot, nS, rnd() * 6.283, rnd() * 6.283, 0.06);
      const ux = tx[ic], uz = tz[ic], vx = nx[ic] * P.cote, vz = nz[ic] * P.cote;
      const ech = loc.map(([u, v]) => new THREE.Vector3(C.x + ux * u + vx * v, 0, C.z + uz * u + vz * v));
      let L = 0;
      for (let k = 0; k < nS; k++) L += ech[k].distanceTo(ech[(k + 1) % nS]);
      // vérification exacte, un point sur deux (les « coins » d'abord : la plupart des refus s'arrêtent là)
      const ordre = [];
      for (let q = 0; q < 8; q++) { const k = Math.floor((q * nS) / 8); ordre.push(k - (k % 2)); }
      for (let k = 0; k < nS; k += 2) ordre.push(k);
      if (!ordre.every((k) => disqueLibre(ech[k].x, ech[k].z, R, h))) { refusees.add(choix.cle); continue; }
      for (let k = 0; k < nS; k += 2) reserver(ech[k].x, ech[k].z, R);
      // la grille ne voit plus ces places
      for (const H of grilles) for (let a = 0; a < H.nk; a++) {
        const i = (H.P.debut + H.k0 + a * H.kPas + N) % N;
        for (let b = 0; b < H.nl; b++) {
          if (!H.libre[a * H.nl + b]) continue;
          const p = point(i, (H.l0 + b * PAS_G) * H.P.cote);
          for (let k = 0; k < nS; k += 2) if ((p.x - ech[k].x) ** 2 + (p.z - ech[k].z) ** 2 < (R + RM + 3) ** 2) { H.libre[a * H.nl + b] = 0; break; }
        }
      }
      const X = new Float32Array(nS), Z = new Float32Array(nS);
      ech.forEach((p, k) => { X[k] = p.x; Z[k] = p.z; });
      const vMoy = 0; // fixée au chargement (vitesse sans glissade du modèle)
      const g = { type: "meute", S, h, X, Z, L, ds: L / nS, R, ECART, BALANCE, n, vMoy, s0: rnd() * L, w: 6.283 / (22 + rnd() * 8), ph: rnd() * 6.283, membres: [] };
      for (let k = 0; k < n; k++) g.membres.push({ k, cote: k === 0 ? 0 : k % 2 ? 1 : -1, ph: rnd() * 6.283, echelle: 0.93 + rnd() * 0.14 });
      groupes.push(g);
      return;
    }
    non("meute-sans-place");
  }
  // placement : coureurs (près des barrières) d'abord, puis chasseurs, puis les grandes meutes
  // (autant que la place le permet : certains groupes ne trouvent pas de place, voir bilan())
  // (meutes avant les chasseurs : elles ont besoin de grandes places, les chasseurs se glissent entre)
  planCoureurs(2.0, 3);
  for (const [n, S] of [[10, 2.1], [9, 2.0], [8, 2.1], [8, 2.0], [7, 2.1], [6, 2.0], [6, 2.0]]) planMeute(n, S);
  for (const n of [4, 4, 4, 3, 3, 3]) planChasseurs(n, 2.4);
  const tempsPlacement = performance.now() - debutPlacement;

  // ---------------------------------------------------------------------------
  // positions (fonctions du temps : rien à rattraper pour ceux qu'on ne voit pas)
  const etats = []; // un par raptor : { g, m, x, y, z, angle, h, clip, image, vitesse }
  for (const g of groupes) for (const m of g.membres) etats.push({ g, m, x: 0, y: 0, z: 0, angle: 0, h: g.h * m.echelle, clip: "Idle", image: 0, prec: null, fondu: 0 });
  let M = null; // modèle cuit
  const meutePoint = (g, s) => {
    const f = ((((s / g.ds) % g.X.length) + g.X.length) % g.X.length), k = Math.floor(f), a = f - k, j = (k + 1) % g.X.length;
    return [g.X[k] + (g.X[j] - g.X[k]) * a, g.Z[k] + (g.Z[j] - g.Z[k]) * a];
  };
  // distance parcourue par le chef : vitesse moyenne ± 18 % (accélère, ralentit)
  const parcours = (g, t) => g.s0 + g.vMoy * t + ((g.vMoy * 0.18) / g.w) * (Math.cos(g.ph) - Math.cos(g.w * t + g.ph));
  function poserMeute(e, t) {
    const { g, m } = e;
    const retard = (m.k * 6.8) / g.vMoy; // chacun suit le chef, en décalé
    const s = parcours(g, t - retard);
    const [x0, z0] = meutePoint(g, s - 1.5), [x1, z1] = meutePoint(g, s + 1.5);
    let dx = x1 - x0, dz = z1 - z0;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const decal = m.cote * g.ECART + (m.k ? Math.sin(t * 0.45 + m.ph) * g.BALANCE : 0);
    e.x = (x0 + x1) / 2 + dz * decal;
    e.z = (z0 + z1) / 2 - dx * decal;
    e.y = 0;
    e.angle = Math.atan2(dx, dz);
    // pas de glissade : l'image de la course suit la distance parcourue
    e.clip = "Run";
    e.image = (s / (M.clips.Run.vitesse * e.h * M.clips.Run.duree)) * M.clips.Run.nb;
  }
  function poserChasseur(e, t) {
    const { g, m } = e, C = g.C;
    const slot = (tt) => {
      const a = g.a0 + (m.k / g.n) * 6.283 + g.sens * g.w * tt;
      return { x: C.x + Math.cos(a) * g.r, z: C.z + Math.sin(a) * g.r, angle: Math.atan2(-Math.sin(a) * g.sens, Math.cos(a) * g.sens) };
    };
    const cycle = g.periode * g.n, u = ((((t - m.k * g.periode) % cycle) + cycle) % cycle);
    const BOND = 0.9, CRI = BOND + M.clips.Attack.duree, retour = g.r / (M.clips.Walk.vitesse * e.h * 0.9);
    const marche = (p) => { e.clip = "Walk"; e.image = ((g.w * g.r * t) / (M.clips.Walk.vitesse * e.h * M.clips.Walk.duree)) * M.clips.Walk.nb; Object.assign(e, { x: p.x, z: p.z, y: 0, angle: p.angle }); };
    if (u < BOND) { // bondit du cercle au centre
      const p = slot(t - u), f = u / BOND;
      e.x = p.x + (C.x - p.x) * f; e.z = p.z + (C.z - p.z) * f; e.y = 4 * 2.6 * f * (1 - f);
      e.angle = Math.atan2(C.x - p.x, C.z - p.z);
      e.clip = "Run"; e.image = f * M.clips.Run.nb * 0.9;
    } else if (u < CRI) { // rugit au centre, tourné vers la route
      const p = slot(t - u);
      e.x = C.x; e.z = C.z; e.y = 0;
      // entre la direction du bond et la route (moyenne des deux directions)
      const L = g.versRoute ??= piste.localiser(C.x, C.z);
      const ax = cx[L.indice] - C.x, az = cz[L.indice] - C.z, la = Math.hypot(ax, az) || 1;
      const bx = C.x - p.x, bz = C.z - p.z, lb = Math.hypot(bx, bz) || 1;
      e.angle = Math.atan2(ax / la + bx / lb, az / la + bz / lb);
      e.clip = "Attack"; e.image = ((u - BOND) / M.clips.Attack.duree) * M.clips.Attack.nb;
    } else if (u < CRI + retour) { // revient à sa place sur le cercle
      const f = (u - CRI) / retour, p = slot(t - u + CRI + retour);
      e.x = C.x + (p.x - C.x) * f; e.z = C.z + (p.z - C.z) * f; e.y = 0;
      e.angle = Math.atan2(p.x - C.x, p.z - C.z);
      e.clip = "Walk"; e.image = ((u - CRI) / M.clips.Walk.duree) * M.clips.Walk.nb * 1.1;
    } else marche(slot(t));
  }
  // coureurs : la position dépend du kart (état gardé d'une image à l'autre)
  let kart = null; // { s (m depuis l'indice 0), v }
  let iCam = -1; // échantillon de piste le plus proche de la caméra (image précédente)
  function majCoureurs(g, dt) {
    const sK = kart ? ((((kart.s - g.i0 * pas) % piste.L) + piste.L) % piste.L) : 1e9;
    const rel = sK > piste.L / 2 ? sK - piste.L : sK; // kart par rapport au début du segment (m)
    // départ quand le kart arrive (la voie est courte : ils partent assez tôt pour être déjà lancés)
    if (g.etat === "attend" && kart && rel > -18 && rel < 5 && kart.v > 6) g.etat = "court";
    if (g.etat === "court" && (rel > g.L + 25 || rel < -80)) { g.etat = "fini"; g.tAttente = 0; }
    if (g.etat === "fini") {
      g.tAttente += dt;
      // le kart est loin et personne ne les voit : ils retournent au départ
      if (Math.abs(rel) > 160 && g.tAttente > 4 && g.membres.every((m) => !m.vu)) {
        g.etat = "attend";
        for (const m of g.membres) { m.s = m.maison; m.v = 0; }
      }
    }
    const VMAX = 30, ACC = 22;
    // ordre dans chaque voie : 14 m au moins entre deux coureurs
    const tries = [...g.membres].sort((a, b) => b.devant - a.devant);
    const FREIN = ACC * 1.5;
    for (const m of tries) {
      // fini : ils freinent et s'arrêtent (distance de freinage), sans dépasser la fin de la voie
      // court : la vitesse du kart, moins s'ils sont en avance sur leur place à côté de lui (au moins
      // 60 % de sa vitesse : le kart les rattrape et ils courent à côté de lui jusqu'au bout de la voie)
      const vK = kart?.v ?? 0, place = rel + m.devant;
      let cible = g.etat === "court" ? g.L - 8 : g.etat === "fini" ? m.s + (m.v * m.v) / (2 * FREIN) + 0.1 : m.maison;
      cible = Math.max(0, Math.min(g.L - 8, cible));
      for (const o of tries) if (o !== m && o.voie === m.voie && o.devant > m.devant) cible = Math.max(0, Math.min(cible, o.s - 14));
      let vVoulue = g.etat === "court" ? vK + Math.max(-0.4 * vK, Math.min(8, (place - m.s) * 1.2)) : (cible - m.s) * 1.5;
      // jamais plus vite que ce qui permet de s'arrêter à temps
      vVoulue = Math.max(0, Math.min(VMAX, vVoulue, Math.sqrt(2 * FREIN * Math.max(0, cible - m.s))));
      m.v += Math.max(-FREIN * dt, Math.min(ACC * dt, vVoulue - m.v));
      if (m.s + m.v * dt > cible + 0.5) m.v = Math.max(0, (cible - m.s) / Math.max(dt, 1e-3));
      m.s += m.v * dt;
    }
  }
  function poserCoureur(e, dt) {
    const { g, m } = e, p = positionVoie(g, m.s, m.voie);
    e.x = p.x; e.z = p.z; e.y = 0; e.angle = p.angle;
    const vRun = M.clips.Run.vitesse * e.h, vWalk = M.clips.Walk.vitesse * e.h;
    if (m.v > vWalk * 1.3) { e.clip = "Run"; m.img = (e.clip === m.clipAvant ? m.img : 0) + (Math.min(2.6, m.v / vRun) * M.clips.Run.nb * dt) / M.clips.Run.duree; }
    else if (m.v > 0.4) { e.clip = "Walk"; m.img = (e.clip === m.clipAvant ? m.img : 0) + ((m.v / vWalk) * M.clips.Walk.nb * dt) / M.clips.Walk.duree; }
    else {
      // arrêté : rugit une fois à la fin de la course, sinon attend
      e.clip = g.etat === "fini" && !m.criFait ? "Attack" : g.etat === "attend" ? (m.k === 1 ? "Eat" : "Idle") : "Idle";
      m.img = (e.clip === m.clipAvant ? m.img : 0) + (M.clips[e.clip].nb * dt) / M.clips[e.clip].duree;
      if (e.clip === "Attack" && m.img >= M.clips.Attack.nb - 1) m.criFait = true;
    }
    if (g.etat === "court") m.criFait = false;
    m.clipAvant = e.clip;
    e.image = m.img;
  }

  // ---------------------------------------------------------------------------
  // vérification avec la vraie emprise du modèle (au chargement) : un groupe gêné est retiré
  const contour = (b, h, x, z, angle, marge = 1.5) => {
    const c = Math.cos(angle), s = Math.sin(angle), pts = [];
    const x0 = b.min.x * h - marge, x1 = b.max.x * h + marge, z0 = b.min.z * h - marge, z1 = b.max.z * h + marge;
    for (let k = 0; k <= 6; k++) {
      const f = k / 6, lx = x0 + (x1 - x0) * f, lz = z0 + (z1 - z0) * f;
      for (const [u, w] of [[lx, z0], [lx, z1], [x0, lz], [x1, lz]]) pts.push([x + u * c + w * s, z - u * s + w * c]);
    }
    return pts;
  };
  const barriere = piste.demi + piste.marge + 0.8;
  /** Raison pour laquelle ce raptor (posé en e) gêne, ou "". */
  function gene(e) {
    const b = M.boite, L = piste.localiser(e.x, e.z);
    // loin de la route : le cercle autour de la boîte suffit (un seul passage par la garde)
    const rCercle = Math.hypot(Math.max(-b.min.x, b.max.x), Math.max(-b.min.z, b.max.z)) * e.h + 1.5;
    if (!(Math.abs(L.lateral) - rCercle >= barriere + 2 && !garde.probleme(e.x, e.z, rCercle, 1.1))) {
      for (const [px, pz] of contour(b, e.h, e.x, e.z, e.angle)) {
        const r = garde.probleme(px, pz, 0.5, 1.1);
        if (r) return r;
      }
    }
    if (laveProbable(e.x, e.z, Math.abs(L.lateral), bord)) return "lave";
    if (e.g.type !== "coureurs" && ouverture(L.indice, L.lateral) < 0.6) return "jungle"; // (couloir réservé des coureurs)
    return "";
  }
  /** Tout le trajet d'un groupe (positions sur un long moment, ou toute la voie des coureurs). */
  function trajetGene(g, pasT, duree) {
    const es = etats.filter((e) => e.g === g);
    // par défaut : un tour de boucle et demi (meute), un cycle de bonds (chasseurs)
    if (g.type === "meute") { pasT ??= 2.5 / g.vMoy; duree ??= (1.5 * g.L) / g.vMoy; }
    else { pasT ??= 0.2; duree ??= g.periode * g.n + 1; }
    if (g.type === "coureurs") {
      for (const e of es) for (let s = 0; s <= g.L - 8; s += 2) { const p = positionVoie(g, s, e.m.voie); Object.assign(e, { x: p.x, z: p.z, angle: p.angle }); const r = gene(e); if (r) return `${r} (s = ${s} m)`; }
      return "";
    }
    for (let t = 0; t < duree; t += pasT) for (const e of es) {
      if (g.type === "meute") poserMeute(e, t); else poserChasseur(e, t);
      const r = gene(e);
      if (r) return r;
    }
    return "";
  }

  // ---------------------------------------------------------------------------
  // dessin : 4 InstancedMesh (2 matériaux × près / loin), remplis chaque image avec les raptors visibles
  const capacite = etats.length;
  let mesh = null; // { pres: { mats, A, B, mat }, loin: {...} }
  let t = 0, pret = false;
  chargerModele().then((m) => {
    M = m;
    for (const g of groupes) if (g.type === "meute") g.vMoy = M.clips.Run.vitesse * g.h * (1 + rnd() * 0.12);
    for (const g of groupes) if (g.type === "chasseurs") g.w = (M.clips.Walk.vitesse * g.h * 0.9) / g.r;
    // vérification de tout le trajet avec la vraie emprise
    for (let k = groupes.length - 1; k >= 0; k--) {
      const r = trajetGene(groupes[k]);
      if (r) {
        if (import.meta.env.DEV) console.warn(`raptors : ${groupes[k].type} gêné (${r}), retiré`, groupes[k].i0 ?? "", groupes[k].cote ?? "");
        for (let j = etats.length - 1; j >= 0; j--) if (etats[j].g === groupes[k]) etats.splice(j, 1);
        groupes.splice(k, 1);
      }
    }
    mesh = {};
    for (const lod of ["pres", "loin"]) {
      const A = new THREE.InstancedBufferAttribute(new Float32Array(capacite * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const B = new THREE.InstancedBufferAttribute(new Float32Array(capacite * 3), 3).setUsage(THREE.DynamicDrawUsage);
      const meshes = M.geos[lod].map((g0, p) => {
        const g = g0.clone();
        g.setAttribute("aClipA", A);
        g.setAttribute("aClipB", B);
        const im = new THREE.InstancedMesh(g, M.mats[lod][p], capacite);
        im.name = "Raptors-" + lod;
        im.frustumCulled = false; // tri fait ici, raptor par raptor
        im.count = 0;
        im.visible = false;
        groupe.add(im);
        return im;
      });
      const mat = meshes[0].instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (const im of meshes.slice(1)) im.instanceMatrix = mat; // mêmes raptors pour les deux matériaux
      mesh[lod] = { meshes, A, B, mat, n: 0 };
    }
    pret = true;
  });

  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sphere = new THREE.Sphere();
  const stats = { pres: 0, loin: 0, caches: 0 };
  function ecrire(L, e) {
    const j = L.n++, h = e.h, c = Math.cos(e.angle) * h, s = Math.sin(e.angle) * h, m = L.mat.array, o = j * 16;
    m[o] = c; m[o + 1] = 0; m[o + 2] = -s; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = h; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = s; m[o + 9] = 0; m[o + 10] = c; m[o + 11] = 0;
    m[o + 12] = e.x; m[o + 13] = e.y; m[o + 14] = e.z; m[o + 15] = 1;
    const C = M.clips[e.clip], a = L.A.array, b = L.B.array;
    if (e.prec && e.fondu < FONDU) {
      const P = M.clips[e.prec.clip];
      a[j * 4] = P.debut; a[j * 4 + 1] = P.nb; a[j * 4 + 2] = e.prec.image; a[j * 4 + 3] = e.fondu / FONDU;
      b[j * 3] = C.debut; b[j * 3 + 1] = C.nb; b[j * 3 + 2] = e.image;
    } else {
      a[j * 4] = C.debut; a[j * 4 + 1] = C.nb; a[j * 4 + 2] = e.image; a[j * 4 + 3] = 0;
    }
  }

  function update(dt, camera) {
    t += dt;
    if (!pret || !camera) return;
    // le kart (devant la caméra) : sa place le long de la route, pour les coureurs
    let Lc = piste.localiser(camera.position.x, camera.position.z, iCam); // recherche locale (rapide)
    if (Math.abs(Lc.lateral) > 40) Lc = piste.localiser(camera.position.x, camera.position.z); // perdue : tout le tour
    iCam = Lc.indice;
    const sK = Lc.indice * pas + Lc.long + 7.2;
    kart = { s: sK, v: kart && dt > 0 ? Math.min(40, Math.abs(ecart(Math.round(sK / pas), Math.round(kart.s / pas)) * pas) / dt) * 0.3 + kart.v * 0.7 : 0 };
    for (const g of groupes) if (g.type === "coureurs") majCoureurs(g, dt);
    camera.updateMatrixWorld();
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    mesh.pres.n = mesh.loin.n = 0;
    stats.caches = 0;
    for (const e of etats) {
      const { g } = e;
      // position approximative d'abord (le groupe) : rien à calculer pour ce qui est hors champ
      const ancien = e.clip, ancienneImage = e.image;
      if (g.type === "meute") poserMeute(e, t);
      else if (g.type === "chasseurs") poserChasseur(e, t);
      else poserCoureur(e, dt);
      if (e.clip !== ancien) { e.prec = { clip: ancien, image: ancienneImage, v: 0 }; e.fondu = 0; }
      else if (e.prec) {
        e.fondu += dt;
        e.prec.image += (M.clips[e.prec.clip].nb * dt) / M.clips[e.prec.clip].duree;
        if (e.fondu >= FONDU) e.prec = null;
      }
      const d = Math.hypot(e.x - camera.position.x, e.z - camera.position.z);
      sphere.center.set(e.x, e.y + e.h * 0.5, e.z);
      sphere.radius = e.h * 1.15;
      const vu = d < DIST_MAX && frustum.intersectsSphere(sphere);
      e.m.vu = vu;
      if (!vu) { stats.caches++; continue; }
      ecrire(d < DIST_LOD ? mesh.pres : mesh.loin, e);
    }
    for (const lod of ["pres", "loin"]) {
      const L = mesh[lod];
      stats[lod] = L.n;
      for (const im of L.meshes) { im.count = L.n; im.visible = L.n > 0; }
      if (L.n) {
        L.mat.clearUpdateRanges(); L.mat.addUpdateRange(0, L.n * 16); L.mat.needsUpdate = true;
        L.A.clearUpdateRanges(); L.A.addUpdateRange(0, L.n * 4); L.A.needsUpdate = true;
        L.B.clearUpdateRanges(); L.B.addUpdateRange(0, L.n * 3); L.B.needsUpdate = true;
      }
    }
  }

  if (import.meta.env.DEV) {
    window.__raptors = {
      get prets() { return pret; },
      get temps() { return { placement: +tempsPlacement.toFixed(1), cuisson: M?.tempsCuisson }; },
      get grilles() { return grilles?.map((G) => { let l = []; for (let b = G.nl - 1; b >= 0; b -= 1) { let s = String(Math.round(G.l0 + b * PAS_G)).padStart(4) + " "; for (let a = 0; a < G.nk; a++) s += G.libre[a * G.nl + b] ? "." : "#"; l.push(s); } return `plaine ${G.P.debut}\n` + l.join("\n"); }).join("\n"); },
      groupes, etats, stats, refus, raisonDisque, voieLibre: (i, lat) => voieLibre(i, lat, HAUTEUR * 2),
      /** Emprise de chaque raptor à sa place actuelle : distance mini à l'axe de la route, lave, jungle. */
      verifier() {
        const barriere = piste.demi + piste.marge + 0.8, hors = [];
        let latMin = 1e9;
        if (!pret) return { latMin, hors };
        for (const e of etats) {
          let lm = 1e9;
          for (const [px, pz] of contour(M.boite, e.h, e.x, e.z, e.angle, 0)) lm = Math.min(lm, Math.abs(piste.localiser(px, pz).lateral));
          latMin = Math.min(latMin, lm);
          const L = piste.localiser(e.x, e.z);
          const pb = lm < barriere ? "route" : laveProbable(e.x, e.z, Math.abs(L.lateral), bord) ? "lave" : e.g.type !== "coureurs" && ouverture(L.indice, L.lateral) < 0.6 ? "jungle" : "";
          if (pb) hors.push({ type: e.g.type, k: e.m.k, pb, lat: +lm.toFixed(1) });
        }
        return { latMin: +latMin.toFixed(1), hors };
      },
      /** Tous les trajets (meutes et chasseurs sur 2 min, toute la voie des coureurs). */
      verifierTrajets() { return groupes.map((g) => ({ type: g.type, n: g.membres.length, gene: trajetGene(g, 0.25, 120) })); },
      bilan() {
        return {
          nombre: etats.length, groupes: groupes.map((g) => `${g.type}:${g.membres.length}`), ...stats,
          triangles: M && { pres: M.triangles.pres, loin: M.triangles.loin }, boite: M && [M.boite.min, M.boite.max].map((v) => v.toArray().map((a) => +a.toFixed(2))), coureurs: groupes.filter((g) => g.type === "coureurs").map((g) => ({ etat: g.etat, L: Math.round(g.L), i0: g.i0, s: g.membres.map((m) => Math.round(m.s)) })),
        };
      },
    };
  }
  return update;
}
