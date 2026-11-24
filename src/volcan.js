import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { chargerTexturesSol } from "./decor.js";
import { audio } from "./audio.js";

// Volcan en éruption (circuit Dinosaures), au fond de la grande plaine.
//
// Modèle : "Volcano" de santhu48 (Sketchfab, CC-BY 4.0), préparé par outils/blender/pack_volcan.py
// puis outils/blender/volcan_realiste.py (vrai cratère au sommet, roche volcanique sombre).
//
// Tout est fait pour rester léger sur une tablette :
//  - la montagne : 1 draw call ; son shader ajoute le pied qui se fond dans le sol, les coulées
//    de lave qui descendent (texture de bruit qui défile, émissive) et le cratère qui rougeoie
//    (aucune lumière ajoutée à la scène : pas de PointLight, pas d'ombre) ;
//  - la fumée : 1 draw call (sprites face caméra, instanciés, triés du plus loin au plus près) ;
//  - les projections de lave et la lueur du cratère : 1 draw call (sprites additifs).
// Moins de 140 sprites en tout. Toutes les projections retombent sur les flancs (moins de
// 130 m de l'axe ; la route passe à plus de 300 m) et la fumée part à l'opposé de la piste.

const DIMENSIONS = { hauteur: 125, largeur: 340 }; // mètres (assez grand pour être imposant depuis la piste)
const NB_FUMEE = 56;
const NB_LAVE = 72; // projections (les 2 dernières places : lueur du cratère)
const GRAVITE = 22; // m/s² (un peu moins que la vraie : les boules restent lisibles plus longtemps)
const BROUILLARD = 0.55; // le volcan traverse moins de brume que le reste (il doit se voir de loin)

/** Volcan + éruption. Renvoie { update(dt, camera), eruption(), pret, rayonPied }. */
export function creerVolcan(groupe, x, z, { versPiste = 0 } = {}) {
  const support = new THREE.Group();
  support.name = "volcan";
  support.position.set(x, 0, z);
  groupe.add(support);

  // vent : la fumée part de côté et s'éloigne de la piste (versPiste : angle (x, z) du volcan vers
  // la piste) ; de biais, le panache se voit mieux depuis la route que s'il fuyait tout droit
  const vent = new THREE.Vector2(Math.cos(versPiste + Math.PI + 1.1), Math.sin(versPiste + Math.PI + 1.1));
  const uniformes = {
    uTemps: { value: 0 },
    uLueur: { value: 0.7 }, // force du rougeoiement (monte pendant les éruptions)
    uCratere: { value: new THREE.Vector4(0, 100, 0, 25) }, // x, y (bord), z, rayon — repère du support
    uVue: { value: versPiste },
    uOrigine: { value: new THREE.Vector3(x, 0, z) }, // pied du volcan (origine du repère du support)
    tSol: { value: chargerTexturesSol().herbe },
  };
  const etat = {
    pret: false, t: 0,
    sommet: new THREE.Vector3(), rayon: 25, profil: null,
    prochaine: 8 + Math.random() * 6, // première grosse éruption assez tôt
    eruption: -1, // temps écoulé depuis le début de la grosse éruption en cours (-1 : aucune)
    emisFumee: 0, emisLave: 0,
  };

  // ---------- la montagne ----------
  new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "nature/volcan.glb").then((gltf) => {
    const modele = gltf.scene;
    modele.traverse((o) => {
      if (!o.isMesh) return;
      const a = o.material;
      o.material = materiauRoche(a, uniformes);
      if (a.map) a.map.anisotropy = 4;
      a.dispose();
    });
    const boite = new THREE.Box3().setFromObject(modele);
    const taille = boite.getSize(new THREE.Vector3()), centre = boite.getCenter(new THREE.Vector3());
    const sh = DIMENSIONS.largeur / Math.max(taille.x, taille.z), sv = DIMENSIONS.hauteur / taille.y;
    modele.scale.set(sh, sv, sh);
    modele.position.set(-centre.x * sh, -boite.min.y * sv - 4, -centre.z * sh); // un peu enfoncé : pas de bord visible
    support.add(modele);
    support.updateMatrixWorld(true);

    // sommets dans le repère du support : bord du cratère et profil (hauteur moyenne selon la distance à l'axe)
    const v = new THREE.Vector3(), pts = [];
    let yMax = -Infinity;
    modele.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position;
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k).applyMatrix4(o.matrixWorld).sub(support.position);
        yMax = Math.max(yMax, v.y);
        pts.push(v.x, v.y, v.z);
      }
    });
    let sx = 0, sz = 0, n = 0;
    for (let k = 0; k < pts.length; k += 3) if (pts[k + 1] > yMax - DIMENSIONS.hauteur * 0.05) { sx += pts[k]; sz += pts[k + 2]; n++; }
    const cx = sx / n, cz = sz / n;
    let sr = 0;
    for (let k = 0; k < pts.length; k += 3) if (pts[k + 1] > yMax - DIMENSIONS.hauteur * 0.05) sr += Math.hypot(pts[k] - cx, pts[k + 2] - cz);
    etat.rayon = sr / n;
    etat.sommet.set(cx, yMax, cz);
    uniformes.uCratere.value.set(cx, yMax, cz, etat.rayon);
    // profil : hauteur moyenne par anneau de 5 m (là où retombent les projections)
    const BIN = 5, nb = 50, somme = new Float32Array(nb), compte = new Float32Array(nb);
    for (let k = 0; k < pts.length; k += 3) {
      const b = Math.min(nb - 1, Math.floor(Math.hypot(pts[k] - cx, pts[k + 2] - cz) / BIN));
      somme[b] += pts[k + 1]; compte[b]++;
    }
    etat.profil = (r) => {
      const b = Math.min(nb - 1, Math.floor(r / BIN));
      return compte[b] ? somme[b] / compte[b] : 0;
    };
    etat.pret = true;
  });

  // ---------- sprites (fumée, lave) ----------
  const fumee = new Sprites(NB_FUMEE, textureFumee(), THREE.NormalBlending);
  const lave = new Sprites(NB_LAVE, textureLueur(), THREE.AdditiveBlending);
  support.add(fumee.mesh, lave.mesh);

  // fumée : position, vitesse, âge, durée de vie, taille de départ/fin, sombre (cendres)
  const F = Array.from({ length: NB_FUMEE }, () => ({ vivant: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, vie: 1, t0: 1, t1: 1, sombre: 0, rot: 0, dr: 0 }));
  // projections : position, vitesse, âge ; posee = temps passé sur le flanc (refroidit)
  const L = Array.from({ length: NB_LAVE - 2 }, () => ({ vivant: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, posee: -1, taille: 6 }));
  let iF = 0, iL = 0;

  function lancerFumee(force) {
    const f = F[iF]; iF = (iF + 1) % NB_FUMEE; // la plus ancienne est recyclée
    const a = Math.random() * 6.283, d = Math.random() * etat.rayon * 0.5;
    f.p.set(etat.sommet.x + Math.cos(a) * d, etat.sommet.y - 6, etat.sommet.z + Math.sin(a) * d);
    const montee = 6 + Math.random() * 3 + force * 26; // colonne de cendres bien droite pendant l'éruption
    f.v.set(vent.x * 3 + (Math.random() - 0.5) * 3, montee, vent.y * 3 + (Math.random() - 0.5) * 3);
    f.age = 0; f.vie = 14 + Math.random() * 5 - force * 3;
    f.t0 = etat.rayon * (1.1 + Math.random() * 0.4) * (1 + force * 0.3);
    f.t1 = f.t0 * (4 + Math.random()) * (1 + force * 0.3);
    f.sombre = Math.min(1, force * 1.2 + Math.random() * 0.25);
    f.rot = Math.random() * 6.283; f.dr = (Math.random() - 0.5) * 0.15;
    f.vivant = true;
  }

  function lancerLave(force) {
    const l = L[iL]; iL = (iL + 1) % L.length;
    const a = Math.random() * 6.283, d = Math.random() * etat.rayon * 0.4;
    l.p.set(etat.sommet.x + Math.cos(a) * d, etat.sommet.y - 4, etat.sommet.z + Math.sin(a) * d);
    // vers l'extérieur ; vitesse horizontale limitée : tout retombe sur les flancs (< ~130 m de l'axe)
    const vh = 5 + Math.random() * (7 + force * 9), vy = 26 + Math.random() * 14 + force * 22, b = Math.random() * 6.283;
    l.v.set(Math.cos(b) * vh, vy, Math.sin(b) * vh);
    l.age = 0; l.posee = -1;
    l.taille = (6 + Math.random() * 4) * (1 + force * 0.3);
    l.vivant = true;
  }

  const coul = new THREE.Color(), chaud = new THREE.Color(1, 0.93, 0.6), orange = new THREE.Color(1, 0.42, 0.08), rouge = new THREE.Color(0.55, 0.06, 0.02);
  const camLocale = new THREE.Vector3(), halo = new THREE.Vector3();
  let brouillardPret = false;

  function update(dt, camera) {
    etat.t += dt;
    uniformes.uTemps.value = etat.t;
    if (!etat.pret) return;
    if (!brouillardPret) brouillardPret = fumee.lierBrouillard(support) && lave.lierBrouillard(support);

    // --- calendrier : grosse éruption toutes les 15 à 25 s ---
    etat.prochaine -= dt;
    if (etat.prochaine <= 0) declencher();
    let force = 0; // 0 : activité normale ; jusqu'à 1 au plus fort d'une grosse éruption
    if (etat.eruption >= 0) {
      etat.eruption += dt;
      const e = etat.eruption;
      force = e < 0.4 ? e / 0.4 : Math.max(0, 1 - (e - 0.4) / 5);
      if (e > 6) etat.eruption = -1;
    }
    // rougeoiement : respire doucement, flambe pendant l'éruption
    uniformes.uLueur.value = 0.65 + 0.12 * Math.sin(etat.t * 1.7) + 0.08 * Math.sin(etat.t * 4.3) + force * 1.2;

    // --- émission ---
    etat.emisFumee += dt * (3 + force * 9);
    while (etat.emisFumee >= 1) { etat.emisFumee--; lancerFumee(force); }
    etat.emisLave += dt * (0.8 + force * (etat.eruption < 1.8 ? 34 : 4));
    while (etat.emisLave >= 1) { etat.emisLave--; lancerLave(force); }

    camLocale.copy(camera.position).sub(support.position);

    // --- fumée ---
    let n = 0;
    for (const f of F) {
      if (!f.vivant) continue;
      f.age += dt;
      const u = f.age / f.vie;
      if (u >= 1) { f.vivant = false; continue; }
      // la montée ralentit, le vent pousse de plus en plus (le panache s'incline loin de la piste)
      f.v.y *= Math.exp(-dt * 0.16);
      f.v.x += vent.x * dt * 2; f.v.z += vent.y * dt * 2;
      f.p.addScaledVector(f.v, dt);
      f.rot += f.dr * dt;
      const s = f.t0 + (f.t1 - f.t0) * Math.sqrt(u);
      const alpha = Math.min(1, u * 6) * Math.pow(1 - u, 1.3) * (0.82 + 0.15 * f.sombre);
      // en bas : éclairée par la lave ; puis grise (cendres plus sombres pendant l'éruption)
      const g = (0.48 + 0.32 * u) * (1 - 0.45 * f.sombre);
      const feu = Math.max(0, 1 - u * 7) * Math.min(1.5, uniformes.uLueur.value);
      coul.setRGB(g + (1 - g) * feu, g + (0.45 - g) * feu, g + (0.15 - g) * feu);
      fumee.poser(n++, f.p, s, f.rot, coul, alpha, camLocale);
    }
    fumee.finir(n, true);

    // --- projections de lave ---
    n = 0;
    for (const l of L) {
      if (!l.vivant) continue;
      l.age += dt;
      if (l.posee < 0) {
        l.v.y -= GRAVITE * dt;
        l.p.addScaledVector(l.v, dt);
        const r = Math.hypot(l.p.x - etat.sommet.x, l.p.z - etat.sommet.z);
        // retombée sur le flanc : la boule reste quelques secondes et refroidit
        if (l.v.y < 0 && (l.p.y < etat.profil(r) + 1.5 || r > 140)) { l.posee = 0; l.p.y = etat.profil(r) + 1.5; }
      } else {
        l.posee += dt;
        if (l.posee > 2.5) { l.vivant = false; continue; }
      }
      const froid = l.posee < 0 ? Math.min(1, l.age / 4) * 0.6 : 0.6 + l.posee / 2.5 * 0.4;
      if (froid < 0.5) coul.copy(chaud).lerp(orange, froid / 0.5);
      else coul.copy(orange).lerp(rouge, (froid - 0.5) / 0.5);
      lave.poser(n++, l.p, l.taille * (1 - froid * 0.35), 0, coul, 1 - Math.max(0, froid - 0.7) / 0.3 * 0.9, camLocale);
    }
    // lueur au-dessus du cratère (deux halos qui respirent)
    const lu = uniformes.uLueur.value;
    halo.set(etat.sommet.x, etat.sommet.y + etat.rayon * 0.2, etat.sommet.z);
    lave.poser(n++, halo, etat.rayon * (2.6 + lu * 0.8), 0, coul.setRGB(1, 0.38, 0.08), Math.min(1, 0.35 + lu * 0.3), camLocale);
    halo.y += etat.rayon * 0.6;
    lave.poser(n++, halo, etat.rayon * (1.5 + lu * 0.9), 0, coul.setRGB(1, 0.75, 0.35), Math.min(1, 0.2 + lu * 0.35), camLocale);
    lave.finir(n, false);
  }

  function declencher() {
    etat.prochaine = 15 + Math.random() * 10;
    etat.eruption = 0;
    // grondement si on est assez près pour l'entendre (le volcan est à 300 m et plus de la piste)
    if (camPos) {
      const d = Math.hypot(camPos.x - support.position.x, camPos.z - support.position.z);
      if (d < 800) audio.grondement?.(Math.min(1, Math.max(0.15, 1 - (d - 300) / 500)));
    }
  }
  let camPos = null;

  return {
    support,
    rayonPied: DIMENSIONS.largeur / 2,
    get pret() { return etat.pret; },
    get etat() { return etat; },
    update(dt, camera) {
      if (!camera) return;
      camPos = camera.position;
      update(dt, camera);
    },
    /** Déclenche tout de suite une grosse éruption (tests). */
    eruption: () => declencher(),
  };
}

// ---------------------------------------------------------------------------
// Matériau de la montagne : Lambert (même lumière que le décor) + quelques lignes de shader.
function materiauRoche(ancien, uniformes) {
  const m = new THREE.MeshLambertMaterial({ map: ancien.map, normalMap: ancien.normalMap });
  if (ancien.normalMap) m.normalScale.copy(ancien.normalScale).multiplyScalar(1.3);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniformes);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMonde;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvMonde = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vMonde;
uniform float uTemps, uLueur, uVue;
uniform vec3 uOrigine;
uniform vec4 uCratere;
uniform sampler2D tSol;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bruit(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float angleDiff(float a) { return atan(sin(a), cos(a)); }
// une coulée : angle de départ (par rapport à la vue), largeur (m), longueur (0..1 de la hauteur), décalage
float coulee(vec2 q, float hn, float r, float a0, float largeur, float longueur, float k) {
  float a = atan(q.y, q.x);
  float centre = uVue + a0 + 0.13 * sin(hn * 7.0 + k) + 0.06 * sin(hn * 19.0 + k * 3.0) + 0.05 * (bruit(vec2(hn * 12.0, k)) - 0.5);
  float d = abs(angleDiff(a - centre)) * r;
  float w = largeur * (0.6 + 0.6 * hn) * (0.7 + 0.6 * bruit(vec2(hn * 30.0, k * 7.0)));
  // front de la coulée irrégulier
  float fin = longueur + 0.05 * (bruit(vec2(d * 0.3, k)) - 0.5);
  return (1.0 - smoothstep(w * 0.4, w, d)) * (1.0 - smoothstep(fin - 0.04, fin, hn)) * step(0.0, hn);
}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
// repère du volcan : q = position autour de l'axe du cratère, hn = 0 au bord, 1 au pied
vec3 local = vMonde - uOrigine;
vec2 q = local.xz - uCratere.xz;
float r = length(q);
float hn = clamp((uCratere.y - local.y) / uCratere.y, -0.2, 1.0);
// pied : la roche se couvre de terre et d'herbe (même photo que le sol de la forêt), sans bord net
vec3 sol = texture2D(tSol, vMonde.xz / 7.0).rgb * vec3(0.78, 0.86, 0.6);
float pied = 1.0 - smoothstep(4.0, 26.0 + 14.0 * bruit(vMonde.xz / 25.0), local.y);
// un peu de mousse et de buissons sur le bas des pentes
float mousse = (1.0 - smoothstep(20.0, 55.0, local.y)) * smoothstep(0.45, 0.75, bruit(vMonde.xz / 9.0)) * 0.45;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.7, 1.05, 0.55) + vec3(0.02, 0.04, 0.0), mousse);
diffuseColor.rgb = mix(diffuseColor.rgb, sol, pied);
// près du sommet : roche oxydée, rougeâtre
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.35, 0.85, 0.7), smoothstep(0.25, 0.0, hn) * 0.6);
// coulées de lave (croûte sombre qui avance, lave visible dans les fissures)
float c = max(max(coulee(q, hn, r, -0.5, 6.0, 0.55, 1.0), coulee(q, hn, r, 0.08, 7.0, 0.72, 2.0)),
              max(coulee(q, hn, r, 0.55, 5.0, 0.42, 3.0), coulee(q, hn, r, 2.4, 7.0, 0.65, 4.0)));
// croûte qui descend lentement : la lave n'apparaît que dans les fissures, plus vive près du cratère
float croute = bruit(vec2(r * 0.15 + hn * 4.0, hn * 30.0 - uTemps * 0.4)) * 0.6 + bruit(vec2(r * 0.5, hn * 90.0 - uTemps * 1.1)) * 0.4;
float chaleur = c * c * smoothstep(0.4 + 0.25 * hn, 0.8, croute + c * 0.25);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.035, 0.03), smoothstep(0.0, 0.35, c));
// fond du cratère : lave
float fond = (1.0 - smoothstep(uCratere.w * 0.5, uCratere.w * 0.85, r)) * smoothstep(-0.02, 0.06, hn);
`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
vec3 laveC = mix(vec3(0.75, 0.07, 0.0), vec3(1.0, 0.4, 0.04), chaleur) + vec3(0.0, 0.25, 0.08) * chaleur * chaleur * chaleur;
totalEmissiveRadiance += laveC * chaleur * (0.85 + 0.3 * uLueur) * (1.0 - 0.45 * hn) + vec3(0.25, 0.03, 0.0) * c * (1.0 - hn) * uLueur * 0.4;
totalEmissiveRadiance += vec3(1.0, 0.45, 0.08) * fond * (0.6 + 0.6 * uLueur) * (0.7 + 0.3 * bruit(q * 0.15 + uTemps * 0.3));
// le bord et le haut des pentes reflètent la lueur du cratère
totalEmissiveRadiance += vec3(0.6, 0.16, 0.03) * uLueur * 0.22 * smoothstep(0.18, 0.0, hn) * (1.0 - smoothstep(uCratere.w, uCratere.w * 2.2, r));`)
      .replace("#include <fog_fragment>", `#ifdef USE_FOG
  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth) * ${BROUILLARD.toFixed(2)};
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`);
  };
  m.customProgramCacheKey = () => "volcan-roche";
  return m;
}

// ---------------------------------------------------------------------------
// Sprites face caméra instanciés : 1 draw call pour toute une famille (fumée ou lave).
class Sprites {
  constructor(max, texture, blending) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(max * 4); // x, y, z, taille
    this.coul = new Float32Array(max * 4); // r, g, b, alpha
    this.rot = new Float32Array(max);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 4).setUsage(THREE.DynamicDrawUsage);
    this.aCoul = new THREE.InstancedBufferAttribute(this.coul, 4).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.InstancedBufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aPos", this.aPos);
    geo.setAttribute("aCoul", this.aCoul);
    geo.setAttribute("aRot", this.aRot);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 200, 0), 420); // tout le volcan et son panache
    this.uniforms = { map: { value: texture }, uBrume: { value: new THREE.Color(0xffffff) }, uBrumeNF: { value: new THREE.Vector2(1e5, 1e6) } };
    const additif = blending === THREE.AdditiveBlending;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending,
      vertexShader: `
attribute vec4 aPos; attribute vec4 aCoul; attribute float aRot;
varying vec2 vUv; varying vec4 vCoul; varying float vBrume;
uniform vec2 uBrumeNF;
void main() {
  vUv = uv; vCoul = aCoul;
  vec4 mv = modelViewMatrix * vec4(aPos.xyz, 1.0);
  float c = cos(aRot), s = sin(aRot);
  mv.xy += mat2(c, s, -s, c) * position.xy * aPos.w;
  vBrume = smoothstep(uBrumeNF.x, uBrumeNF.y, -mv.z) * ${(BROUILLARD * 0.5).toFixed(2)}; // fumée sombre : contraste avec le ciel
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: `
uniform sampler2D map; uniform vec3 uBrume;
varying vec2 vUv; varying vec4 vCoul; varying float vBrume;
void main() {
  vec4 t = texture2D(map, vUv);
  ${additif
    ? "gl_FragColor = vec4(vCoul.rgb * t.rgb * (1.0 - vBrume * 0.6), t.a * vCoul.a);"
    : "gl_FragColor = vec4(mix(vCoul.rgb * t.rgb, uBrume, vBrume), t.a * vCoul.a);"}
}`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = additif ? 3 : 2;
    this.geo = geo;
    this.max = max;
    this.tri = []; // pour trier la fumée
  }

  /** Copie la brume de la scène (une fois la scène trouvée). */
  lierBrouillard(objet) {
    let s = objet;
    while (s.parent) s = s.parent;
    if (!s.isScene) return false;
    if (s.fog?.isFog) {
      this.uniforms.uBrume.value.copy(s.fog.color);
      this.uniforms.uBrumeNF.value.set(s.fog.near, s.fog.far);
    }
    return true;
  }

  poser(i, p, taille, rot, c, alpha, cam) {
    if (i >= this.max) return;
    this.pos[i * 4] = p.x; this.pos[i * 4 + 1] = p.y; this.pos[i * 4 + 2] = p.z; this.pos[i * 4 + 3] = taille;
    this.coul[i * 4] = c.r; this.coul[i * 4 + 1] = c.g; this.coul[i * 4 + 2] = c.b; this.coul[i * 4 + 3] = alpha;
    this.rot[i] = rot;
    this.tri[i] = (p.x - cam.x) ** 2 + (p.y - cam.y) ** 2 + (p.z - cam.z) ** 2;
  }

  finir(n, trier) {
    if (trier && n > 1) {
      // du plus loin au plus près (transparence correcte) ; tableaux réutilisés (pas de déchets à chaque image)
      if (!this.ordre) {
        this.ordre = [];
        this.copie = { p: new Float32Array(this.max * 4), c: new Float32Array(this.max * 4), r: new Float32Array(this.max) };
      }
      const ordre = this.ordre, { p, c, r } = this.copie, tri = this.tri;
      ordre.length = n;
      for (let i = 0; i < n; i++) ordre[i] = i;
      ordre.sort((a, b) => tri[b] - tri[a]);
      p.set(this.pos.subarray(0, n * 4)); c.set(this.coul.subarray(0, n * 4)); r.set(this.rot.subarray(0, n));
      for (let i = 0; i < n; i++) {
        const j = ordre[i];
        for (let k = 0; k < 4; k++) { this.pos[i * 4 + k] = p[j * 4 + k]; this.coul[i * 4 + k] = c[j * 4 + k]; }
        this.rot[i] = r[j];
      }
    }
    this.geo.instanceCount = Math.min(n, this.max);
    this.aPos.needsUpdate = this.aCoul.needsUpdate = this.aRot.needsUpdate = true;
  }
}

// Textures dessinées dans un canvas (aucun fichier à charger)
function textureFumee() {
  const T = 128, cv = document.createElement("canvas");
  cv.width = cv.height = T;
  const g = cv.getContext("2d");
  // une bouffée = plusieurs disques flous qui se chevauchent (bord irrégulier, volume)
  let graine = 7;
  const rnd = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 14; k++) {
    const a = rnd() * 6.283, d = rnd() * T * 0.2, r = T * (0.14 + rnd() * 0.16);
    const x = T / 2 + Math.cos(a) * d, y = T / 2 + Math.sin(a) * d;
    const l = Math.round(205 + rnd() * 50 - (y / T) * 40); // un peu plus sombre en bas (ombre)
    const dg = g.createRadialGradient(x, y, 0, x, y, r);
    dg.addColorStop(0, `rgba(${l},${l},${l},0.55)`);
    dg.addColorStop(1, `rgba(${l},${l},${l},0)`);
    g.fillStyle = dg;
    g.fillRect(0, 0, T, T);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textureLueur() {
  const T = 64, cv = document.createElement("canvas");
  cv.width = cv.height = T;
  const g = cv.getContext("2d");
  const dg = g.createRadialGradient(T / 2, T / 2, 0, T / 2, T / 2, T / 2);
  dg.addColorStop(0, "rgba(255,255,255,1)");
  dg.addColorStop(0.25, "rgba(255,255,255,0.8)");
  dg.addColorStop(0.55, "rgba(255,255,255,0.25)");
  dg.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = dg;
  g.fillRect(0, 0, T, T);
  return new THREE.CanvasTexture(cv);
}
