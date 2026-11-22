import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/** Boîte aux coins arrondis (les pièces très fines restent des boîtes simples). */
export function boiteRonde(l, h, p) {
  const m = Math.min(l, h, p);
  return m < 0.15 ? new THREE.BoxGeometry(l, h, p) : new RoundedBoxGeometry(l, h, p, 1, m * 0.3);
}
import { decorPlage, decorNeige } from "./decors-circuits.js";
import { decorDino, decorJouets, decorConcert } from "./decors-themes.js";

/** Générateur aléatoire reproductible (même décor à chaque partie). */
function aleatoire(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ciel(def) {
  const geo = new THREE.SphereGeometry(850, 24, 12);
  const haut = new THREE.Color(def.ciel.haut), horizon = new THREE.Color(def.ciel.horizon);
  const pos = geo.attributes.position;
  const col = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp((pos.getY(i) / 850) * 2.2, 0, 1);
    c.copy(horizon).lerp(haut, t);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -1;
  return m;
}

/** Remplit un InstancedMesh avec une liste de {x, y, z, s, sy, r, couleur}. */
export function instances(geo, mat, liste) {
  const m = new THREE.InstancedMesh(geo, mat, liste.length);
  const o = new THREE.Object3D();
  const c = new THREE.Color();
  liste.forEach((p, i) => {
    o.position.set(p.x, p.y ?? 0, p.z);
    o.rotation.set(0, p.r ?? 0, 0);
    o.scale.set(p.s, p.sy ?? p.s, p.s);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
    if (p.couleur !== undefined) m.setColorAt(i, c.set(p.couleur));
  });
  return m;
}

/** Tire des positions au hasard autour du circuit, hors de la piste. */
export function positions(piste, rnd, nombre, distMin, distMax) {
  const res = [];
  const R = piste.rayon + distMax;
  let essais = 0;
  while (res.length < nombre && essais++ < nombre * 40) {
    const x = piste.centre.x + (rnd() * 2 - 1) * R;
    const z = piste.centre.z + (rnd() * 2 - 1) * R;
    const d = piste.distanceCentre(x, z);
    if (d > distMin && d < distMax) res.push({ x, z, d });
  }
  return res;
}

export function construireDecor(def, piste) {
  const groupe = new THREE.Group();
  const rnd = aleatoire(42);
  const horsPiste = piste.demi + piste.marge + 2.5;

  const leCiel = ciel(def);
  groupe.add(leCiel);

  // sol
  // (ptero.js retrouve ce plan de 2400 m pour y creuser le ravin : le matériau ne dépend pas des UV)
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), materiauSol(def, piste));
  sol.rotation.x = -Math.PI / 2;
  sol.position.set(piste.centre.x, 0, piste.centre.z);
  groupe.add(sol);

  const DECORS = { prairie: decorPrairie, plage: decorPlage, neige: decorNeige, dino: decorDino, jouets: decorJouets, concert: decorConcert };
  const obstacles = []; // objets ronds qu'on ne traverse pas (ex. pieds du T-rex géant)
  const animer = DECORS[def.decor]?.(groupe, piste, rnd, horsPiste, obstacles);

  return { groupe, ciel: leCiel, animer: animer ?? (() => {}), obstacles };
}

function decorPrairie(groupe, piste, rnd, horsPiste) {
  const verts = [0x2f9e44, 0x37b24d, 0x40c057, 0x2b8a3e, 0x51cf66];

  // arbres ronds (tronc + feuillage partagent la même liste)
  const arbres = positions(piste, rnd, 220, horsPiste + 2, 140).map((p) => ({
    ...p, s: 0.9 + rnd() * 0.7, r: rnd() * 6, couleur: verts[Math.floor(rnd() * verts.length)],
  }));
  const troncs = new THREE.CylinderGeometry(0.35, 0.55, 2.4, 12).translate(0, 1.2, 0);
  const feuillage = new THREE.IcosahedronGeometry(2.3, 2).translate(0, 3.8, 0);
  groupe.add(instances(troncs, new THREE.MeshLambertMaterial({ color: 0x8b5a2b, flatShading: false }),
    arbres.map(({ couleur, ...p }) => p)));
  groupe.add(instances(feuillage, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: false }), arbres));

  // buissons
  const buissons = positions(piste, rnd, 90, horsPiste, 90);
  groupe.add(instances(new THREE.IcosahedronGeometry(1, 2).translate(0, 0.5, 0),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: false }),
    buissons.map((p) => ({ ...p, s: 0.8 + rnd() * 0.9, sy: 0.7 + rnd() * 0.4, r: rnd() * 6, couleur: verts[Math.floor(rnd() * verts.length)] }))));

  // fleurs (aussi dans l'herbe entre la route et la barrière)
  const couleursFleurs = [0xff6b6b, 0xffd43b, 0xffffff, 0xf783ac, 0xb197fc, 0xff922b];
  const fleurs = [
    ...positions(piste, rnd, 260, piste.demi + 2, piste.demi + piste.marge - 0.5),
    ...positions(piste, rnd, 260, horsPiste, 60),
  ];
  groupe.add(instances(new THREE.IcosahedronGeometry(0.28, 1).translate(0, 0.25, 0),
    new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: false }),
    fleurs.map((p) => ({ ...p, s: 0.8 + rnd() * 0.6, couleur: couleursFleurs[Math.floor(rnd() * couleursFleurs.length)] }))));

  // collines lointaines
  const collines = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rnd() * 0.3;
    const r = piste.rayon + 230 + rnd() * 80;
    const s = 70 + rnd() * 60;
    collines.push({ x: piste.centre.x + Math.cos(a) * r, y: -8, z: piste.centre.z + Math.sin(a) * r, s, sy: 25 + rnd() * 30, couleur: [0x5fb83f, 0x4ea836, 0x74c94f][i % 3] });
  }
  groupe.add(instances(new THREE.SphereGeometry(1, 22, 13), new THREE.MeshLambertMaterial({ color: 0xffffff }), collines));

  // nuages
  const nuages = [];
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 150 + rnd() * 300;
    const x = piste.centre.x + Math.cos(a) * r, z = piste.centre.z + Math.sin(a) * r, y = 70 + rnd() * 40;
    for (let k = 0; k < 4; k++)
      nuages.push({ x: x + (k - 1.5) * 9 + rnd() * 4, y: y + rnd() * 4, z: z + rnd() * 6, s: 7 + rnd() * 5, sy: 4 + rnd() * 3 });
  }
  groupe.add(instances(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), nuages));
}

// ---------------------------------------------------------------------------
// TEXTURE DU SOL (herbe) : tout est dans materiauSol(), facile à remplacer plus tard par une
// vraie texture. Deux petites images dessinées au chargement, sans fichier :
//  - "detail" (256², répétée tous les quelques mètres) : grain de l'herbe et taches moyennes ;
//  - "carte" (1024², tout le circuit) : grandes zones d'herbe plus sombre ou plus sèche,
//    plaques de terre, bande d'herbe usée le long de la route et terre au pied des barrières.
// Le shader lit les deux avec les coordonnées du monde (x, z) : il marche aussi après que
// ptero.js a remplacé le plan par une forme trouée (dont les UV ne sont plus les mêmes).
const PERIODE_DETAIL = 9; // m
const PERIODE_TACHES = 53; // m (deuxième lecture du détail, casse la répétition)
const cacheSol = new Map();

/** Bruit de valeur périodique (tuile sans raccord) : taille² valeurs entre 0 et 1. */
function bruitPeriodique(taille, octaves, rnd) {
  const res = new Float32Array(taille * taille);
  let amp = 1, total = 0;
  for (const cellules of octaves) {
    const g = Float32Array.from({ length: cellules * cellules }, () => rnd());
    const lisse = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < taille; y++) {
      const fy = (y / taille) * cellules, y0 = Math.floor(fy), ty = lisse(fy - y0);
      for (let x = 0; x < taille; x++) {
        const fx = (x / taille) * cellules, x0 = Math.floor(fx), tx = lisse(fx - x0);
        const v = (i, j) => g[((j % cellules) * cellules) + (i % cellules)];
        const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
        const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
        res[y * taille + x] += (a + (b - a) * ty) * amp;
      }
    }
    total += amp;
    amp *= 0.55;
  }
  for (let k = 0; k < res.length; k++) res[k] /= total;
  return res;
}

function imagesSol(piste, photo = false) {
  let rs = 1234567;
  const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
  // détail : R = grain fin de l'herbe, G = taches moyennes
  const T = 256;
  const fin = bruitPeriodique(T, [16, 32, 64], rnd);
  const moyen = bruitPeriodique(T, [4, 8, 16], rnd);
  const cd = document.createElement("canvas");
  cd.width = cd.height = T;
  const gd = cd.getContext("2d");
  const id = gd.createImageData(T, T);
  for (let k = 0; k < T * T; k++) {
    id.data[k * 4] = Math.round(fin[k] * 255);
    id.data[k * 4 + 1] = Math.round(moyen[k] * 255);
    id.data[k * 4 + 2] = 128;
    id.data[k * 4 + 3] = 255;
  }
  gd.putImageData(id, 0, 0);

  // carte du circuit : R = luminosité, G = terre, B = herbe sèche (128 / 0 / 0 = herbe normale)
  const C = 1024, marge = 160;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < piste.N; i++) {
    minX = Math.min(minX, piste.cx[i]); maxX = Math.max(maxX, piste.cx[i]);
    minZ = Math.min(minZ, piste.cz[i]); maxZ = Math.max(maxZ, piste.cz[i]);
  }
  const taille = Math.max(maxX - minX, maxZ - minZ) + 2 * marge;
  const x0 = (minX + maxX) / 2 - taille / 2, z0 = (minZ + maxZ) / 2 - taille / 2;
  const px = C / taille; // pixels par mètre
  const grand = bruitPeriodique(C, [6, 12, 24], rnd), plaques = bruitPeriodique(C, [10, 20, 40], rnd);
  // sol en photos : en plus, des taches moyennes (10 à 20 m) qui restent visibles au loin,
  // là où le détail des photos se fond en une couleur unie
  const taches = photo ? bruitPeriodique(C, [40, 80], rnd) : null;
  const cc = document.createElement("canvas");
  cc.width = cc.height = C;
  const gc = cc.getContext("2d");
  const ic = gc.createImageData(C, C);
  for (let y = 0; y < C; y++)
    for (let x = 0; x < C; x++) {
      const k = y * C + x;
      // vers les bords de la carte, tout redevient neutre (au-delà : herbe simple)
      const bord = Math.min(x, y, C - 1 - x, C - 1 - y) / (C * 0.08);
      const f = Math.min(1, bord);
      const v = grand[k], m = taches ? taches[k] - 0.5 : 0;
      ic.data[k * 4] = Math.round(128 + (v - 0.5) * 150 * f + m * 220 * f); // zones plus sombres / plus claires
      ic.data[k * 4 + 1] = Math.round(Math.max(0, (plaques[k] - 0.66) * 4) * 150 * f); // plaques de terre
      ic.data[k * 4 + 2] = Math.round((Math.max(0, (v - 0.56) * 3) * 140 + Math.max(0, m - 0.1) * 380) * f); // herbe sèche (photos : sous-bois)
      ic.data[k * 4 + 3] = 255;
    }
  gc.putImageData(ic, 0, 0);
  // le long de la route : on trace des bandes (de la plus large à la plus étroite)
  const trace = (demiLargeur, style, flou) => {
    gc.save();
    gc.filter = `blur(${flou}px)`;
    gc.globalCompositeOperation = "source-over";
    gc.strokeStyle = style;
    gc.lineWidth = demiLargeur * 2 * px;
    gc.lineJoin = gc.lineCap = "round";
    gc.beginPath();
    for (let i = 0; i <= piste.N; i++) {
      const j = i % piste.N;
      const X = (piste.cx[j] - x0) * px, Y = (piste.cz[j] - z0) * px;
      i ? gc.lineTo(X, Y) : gc.moveTo(X, Y);
    }
    gc.stroke();
    gc.restore();
  };
  const bord = piste.demi + piste.marge;
  trace(bord + 4, "rgba(112,0,60,0.5)", 3); // herbe un peu sèche derrière les barrières
  trace(bord + 1.3, "rgb(104,150,40)", 1.5); // terre au pied des barrières
  trace(bord - 0.8, "rgba(132,30,70,0.8)", 1.5); // herbe usée entre la bordure et la barrière
  trace(piste.demi + 2.2, "rgb(110,95,20)", 1); // terre tassée le long de la bordure
  return { detail: cd, carte: cc, carteMin: new THREE.Vector2(x0, z0), carteTaille: taille };
}

/** Matériau du grand sol (carte du circuit + détail dessiné, ou vraies textures pour la forêt jurassique). */
export function materiauSol(def, piste) {
  const cle = def.nom + ":" + piste.N;
  if (!cacheSol.has(cle)) {
    const im = imagesSol(piste, def.decor === "dino");
    const detail = new THREE.CanvasTexture(im.detail);
    detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
    detail.anisotropy = 4;
    const carte = new THREE.CanvasTexture(im.carte);
    carte.anisotropy = 4;
    carte.flipY = false; // ligne 0 du dessin = z minimal
    cacheSol.set(cle, { detail, carte, carteMin: im.carteMin, carteTaille: im.carteTaille });
  }
  const t = cacheSol.get(cle);
  if (def.decor === "dino") return materiauSolPhoto(def, t);
  const uniforms = {
    tDetail: { value: t.detail },
    tCarte: { value: t.carte },
    uCarteMin: { value: t.carteMin },
    uCarteTaille: { value: t.carteTaille },
    uTerre: { value: new THREE.Color(def.terre ?? 0x9a7748) },
    uSec: { value: new THREE.Color(def.sec ?? 0xc2b25a) },
  };
  const m = new THREE.MeshLambertMaterial({ color: def.sol });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vSolXZ;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvSolXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec2 vSolXZ;
uniform sampler2D tDetail, tCarte;
uniform vec2 uCarteMin;
uniform float uCarteTaille;
uniform vec3 uTerre, uSec;`)
      .replace("#include <map_fragment>", `
vec4 carte = texture2D(tCarte, clamp((vSolXZ - uCarteMin) / uCarteTaille, 0.0, 1.0));
float grain = texture2D(tDetail, vSolXZ / ${PERIODE_DETAIL.toFixed(1)}).r;
float taches = texture2D(tDetail, vSolXZ / ${PERIODE_TACHES.toFixed(1)} + 0.37).g;
vec3 c = diffuseColor.rgb;
c = mix(c, uSec, min(1.0, carte.b * 1.5));
c = mix(c, uTerre, min(1.0, carte.g * (1.0 + 0.8 * grain)));
c *= (0.6 + 0.8 * carte.r) * (0.76 + 0.48 * grain) * (0.84 + 0.32 * taches);
diffuseColor.rgb = c;`);
  };
  m.customProgramCacheKey = () => "sol-herbe";
  return m;
}

// ---------------------------------------------------------------------------
// SOL EN VRAIES TEXTURES (forêt jurassique) : photos Poly Haven (CC0) préparées par
// outils/blender/textures_sol.py dans public/textures/. Trois photos mélangées par la
// carte du circuit (voir imagesSol) : G = terre tassée (bordures, pied des barrières, plaques),
// B = sous-bois (terre brune et feuilles), R = zones plus sombres ou plus claires.
// 4 lectures de texture par pixel (carte + 3 photos), rien d'autre : léger pour une tablette.
// Contre la répétition : les coordonnées ondulent doucement selon la carte, et le sous-bois
// (grande période, tourné) module aussi la luminosité de l'herbe.
// "moyenne" : couleur moyenne de chaque photo (sRGB, affichée par textures_sol.py) ; la teinte
// du shader ramène chaque photo vers la couleur voulue (def.sol pour l'herbe) sans perdre son grain.
const TEXTURES_SOL = {
  herbe: { fichier: "sol-herbe.jpg", moyenne: 0x918761, periode: 7 }, // forrest_ground_01
  terre: { fichier: "sol-terre.jpg", moyenne: 0x8d8163, periode: 4.5 }, // grass_path_2
  sousBois: { fichier: "sol-sous-bois.jpg", moyenne: 0x655433, periode: 13 }, // brown_mud_leaves_01
};
let texturesPhoto = null;

/** Charge les photos du sol une seule fois (elles arrivent pendant le décompte). */
function chargerTexturesSol() {
  if (!texturesPhoto) {
    const chargeur = new THREE.TextureLoader();
    texturesPhoto = {};
    for (const [nom, t] of Object.entries(TEXTURES_SOL)) {
      const tex = chargeur.load(import.meta.env.BASE_URL + "textures/" + t.fichier);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      texturesPhoto[nom] = tex;
    }
  }
  return texturesPhoto;
}

/** Teinte qui amène la couleur moyenne d'une photo vers la couleur voulue (force 0..1). */
function teinte(voulue, moyenne, force = 1) {
  const v = new THREE.Color(voulue), m = new THREE.Color(moyenne);
  return new THREE.Vector3(v.r / m.r, v.g / m.g, v.b / m.b).lerp(new THREE.Vector3(1, 1, 1), 1 - force);
}

function materiauSolPhoto(def, t) {
  const tex = chargerTexturesSol();
  const lum = (hex) => { const c = new THREE.Color(hex); return 0.3 * c.r + 0.5 * c.g + 0.2 * c.b; };
  const uniforms = {
    tCarte: { value: t.carte },
    tHerbe: { value: tex.herbe },
    tTerre: { value: tex.terre },
    tSousBois: { value: tex.sousBois },
    uCarteMin: { value: t.carteMin },
    uCarteTaille: { value: t.carteTaille },
    // herbe un peu moins vive que def.sol (couleur pensée pour un sol uni) : la photo garde ses nuances
    uTeinteHerbe: { value: teinte(new THREE.Color(def.sol).lerp(new THREE.Color(0x7d9a4a), 0.45), TEXTURES_SOL.herbe.moyenne, 0.8) },
    uTeinteTerre: { value: teinte(0xa88a5e, TEXTURES_SOL.terre.moyenne, 0.8) },
    uTeinteSousBois: { value: teinte(0x6e5636, TEXTURES_SOL.sousBois.moyenne, 0.6) },
    uLum: { value: new THREE.Vector3(lum(TEXTURES_SOL.herbe.moyenne), lum(TEXTURES_SOL.terre.moyenne), lum(TEXTURES_SOL.sousBois.moyenne)) },
  };
  const f = (x) => x.toFixed(2);
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    // coordonnées du monde (aussi pour un InstancedMesh, ex. les collines au loin)
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vSolXZ;")
      .replace("#include <project_vertex>", `#include <project_vertex>
vec4 solMonde = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
solMonde = instanceMatrix * solMonde;
#endif
vSolXZ = (modelMatrix * solMonde).xz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec2 vSolXZ;
uniform sampler2D tCarte, tHerbe, tTerre, tSousBois;
uniform vec2 uCarteMin;
uniform float uCarteTaille;
uniform vec3 uTeinteHerbe, uTeinteTerre, uTeinteSousBois, uLum;`)
      .replace("#include <map_fragment>", `
vec4 carte = texture2D(tCarte, clamp((vSolXZ - uCarteMin) / uCarteTaille, 0.0, 1.0));
vec2 p = vSolXZ + (carte.r - 0.5) * vec2(9.0, -6.0);
vec3 herbe = texture2D(tHerbe, p / ${f(TEXTURES_SOL.herbe.periode)}).rgb;
vec3 terre = texture2D(tTerre, p.yx / ${f(TEXTURES_SOL.terre.periode)}).rgb;
vec3 sb = texture2D(tSousBois, mat2(0.8, -0.6, 0.6, 0.8) * p / ${f(TEXTURES_SOL.sousBois.periode)}).rgb;
vec3 poids = vec3(0.3, 0.5, 0.2);
float lH = dot(herbe, poids) / uLum.x, lT = dot(terre, poids) / uLum.y, lS = dot(sb, poids) / uLum.z;
vec3 c = herbe * uTeinteHerbe * mix(1.0, clamp(lS, 0.5, 1.6), 0.35);
// transitions "par la hauteur" : la terre gagne d'abord dans les creux de l'herbe
// sous-bois : plaques de la carte et zones sombres (comme sous les arbres)
float wS = smoothstep(0.05, 0.75, carte.b * 1.3 + (1.0 - lH) * 0.25 + smoothstep(0.47, 0.3, carte.r) * 0.45);
float wT = smoothstep(0.25, 0.75, carte.g * 1.3 + (lT - lH) * 0.3);
c = mix(c, sb * uTeinteSousBois, wS);
c = mix(c, terre * uTeinteTerre, wT);
c *= 0.62 + 0.76 * carte.r;
diffuseColor.rgb *= c;`);
  };
  m.customProgramCacheKey = () => "sol-photo";
  return m;
}
