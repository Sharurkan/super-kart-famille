import * as THREE from "three";
import { Sprites, CELLULE, CELLULES_FUMEE, textureParticules } from "./volcan.js";

// Le monde en lave (circuit Dinosaures) : après l'impact de la météorite, une vague part du
// volcan et transforme tout sur son passage : le sol devient de la roche volcanique craquelée
// où la lave rougeoie, des mares et coulées de lave s'ouvrent loin de la route, les arbres et
// les plantes se calcinent (certains rougeoient), des cendres tombent et des braises montent.
//
// Vraies textures libres (ambientCG, CC0), préparées en JPEG dans public/lave/ :
//  - roche-lave.jpg + roche-lave-braise.jpg : "Lava 001" (couleur + émission : roche et fissures)
//  - lave.jpg : "Lava 004" (lave en fusion : les mares et les coulées)
//
// Tout passe par quelques uniforms partagés (LAVE.uniforms) que les matériaux du sol et de la
// végétation lisent : aucune géométrie ajoutée, aucun nouveau matériau, rien alloué par image.
// La route (son propre matériau) ne change pas. Remis à zéro à chaque course (reinitialiserLave).

const BASE = import.meta.env.BASE_URL + "lave/";
let textures = null;
function chargerTextures() {
  if (!textures) {
    const ch = new THREE.TextureLoader();
    const t = (f, srgb = true) => {
      const x = ch.load(BASE + f);
      x.wrapS = x.wrapT = THREE.RepeatWrapping;
      if (srgb) x.colorSpace = THREE.SRGBColorSpace;
      x.anisotropy = 4;
      return x;
    };
    textures = { roche: t("roche-lave.jpg"), braise: t("roche-lave-braise.jpg"), lave: t("lave.jpg") };
  }
  return textures;
}

/** Uniforms partagés par tous les matériaux qui se transforment. */
export const LAVE = {
  uniforms: {
    uLaveCentre: { value: new THREE.Vector2() },
    uLaveRayon: { value: -500 }, // front de la vague (m depuis le volcan) ; négatif : rien
    uLaveTemps: { value: 0 },
    tRocheLave: { value: null },
    tBraiseLave: { value: null },
    tLave: { value: null },
  },
};

/** Nouvelle course : plus de lave, la vague partira de ce point (le volcan). */
export function reinitialiserLave(x, z) {
  const t = chargerTextures(), u = LAVE.uniforms;
  u.tRocheLave.value = t.roche;
  u.tBraiseLave.value = t.braise;
  u.tLave.value = t.lave;
  u.uLaveCentre.value.set(x, z);
  u.uLaveRayon.value = -500;
  u.uLaveTemps.value = 0;
}

// largeur du front (m) : tout ce qui est à moins de LARGEUR derrière le front est entièrement transformé
const LARGEUR = 70;
/** GLSL commun : déclaration des uniforms et force de la transformation en un point (0..1). */
export const GLSL_LAVE = `
uniform vec2 uLaveCentre;
uniform float uLaveRayon, uLaveTemps;
float vagueLave(vec2 xz) {
  return smoothstep(uLaveRayon, uLaveRayon - ${LARGEUR.toFixed(1)}, distance(xz, uLaveCentre));
}`;

/** Où en est la vague en un point (pour le JS : cendres autour de la caméra). */
export function vagueLave(x, z) {
  const u = LAVE.uniforms, d = Math.hypot(x - u.uLaveCentre.value.x, z - u.uLaveCentre.value.y);
  return THREE.MathUtils.smoothstep(u.uLaveRayon.value - d, 0, LARGEUR);
}

/**
 * Le sol (matériau photo de decor.js) : morceaux de shader à insérer.
 * Variables disponibles dans le shader du sol : vSolXZ, p (coordonnées ondulées), c (couleur),
 * tProche / uCarteMin / uCarteTaille (proximité de la route : 1 sur la route, 0 au loin).
 */
export const GLSL_SOL_LAVE = {
  declarations: `${GLSL_LAVE}
uniform sampler2D tRocheLave, tBraiseLave, tLave, tProche;`,
  // à la fin du calcul de la couleur du sol (avant diffuseColor.rgb *= c)
  couleur: `
vec3 laveSol = vec3(0.0);
float wL = vagueLave(vSolXZ);
if (wL > 0.002) {
  vec2 q = p / 9.0;
  vec3 roche = texture2D(tRocheLave, q).rgb * vec3(0.62, 0.56, 0.54); // basalte sombre
  vec3 braise = texture2D(tBraiseLave, q).rgb;
  // proximité de la route : pas de lave ouverte près de la route ni sur ses bas-côtés
  float proche = texture2D(tProche, clamp((vSolXZ - uCarteMin) / uCarteTaille, 0.0, 1.0)).r;
  float loin = 1.0 - smoothstep(0.05, 0.35, proche);
  // mares et coulées : là où la photo de lave, vue de très haut, est la plus claire ; elle coule doucement
  vec3 grand = texture2D(tLave, vSolXZ / 340.0 + vec2(0.13, 0.71)).rgb;
  float riviere = smoothstep(0.6, 0.68, dot(grand, vec3(0.45, 0.45, 0.1))) * loin;
  vec3 coule = texture2D(tLave, vSolXZ / 16.0 + vec2(uLaveTemps * 0.012, uLaveTemps * 0.02)).rgb;
  // fissures qui palpitent (plus calmes près de la route)
  float pouls = 0.75 + 0.25 * sin(uLaveTemps * 2.2 + dot(vSolXZ, vec2(0.05, 0.08)));
  vec3 sol = mix(roche, coule * 0.35, riviere);
  c = mix(c, sol, wL);
  // le front de la vague brille
  float front = wL * (1.0 - wL) * 4.0;
  laveSol = (braise * pouls * (0.6 + 0.8 * loin) + coule * riviere * 1.35 + vec3(1.0, 0.35, 0.05) * front * 0.8) * wL;
}`,
  emission: `totalEmissiveRadiance += laveSol;`,
};

/**
 * Végétation (imposteurs et plantes instanciées) : se calcine au passage de la vague ;
 * une plante sur six rougeoie. À appeler une fois par matériau (garde son onBeforeCompile).
 */
export function brulable(materiau) {
  if (materiau.userData.brulable) return;
  materiau.userData.brulable = true;
  const avant = materiau.onBeforeCompile;
  const cleAvant = materiau.customProgramCacheKey?.bind(materiau);
  materiau.onBeforeCompile = (sh, r) => {
    avant?.call(materiau, sh, r);
    Object.assign(sh.uniforms, LAVE.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLaveInst;")
      .replace("#include <fog_vertex>", `#include <fog_vertex>
#ifdef USE_INSTANCING
vLaveInst = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
vLaveInst = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vLaveInst;${GLSL_LAVE}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
float wB = vagueLave(vLaveInst.xz);
if (wB > 0.002) {
  float h = fract(sin(dot(floor(vLaveInst.xz * 3.0), vec2(12.9898, 78.233))) * 43758.5453);
  float l = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
  // calciné : presque noir, un peu brun
  vec3 brule = vec3(0.022, 0.016, 0.013) + diffuseColor.rgb * 0.05;
  // certaines plantes rougeoient (braises dans les parties claires du feuillage)
  float rouge = step(0.83, h) * (0.6 + 0.4 * sin(uLaveTemps * 3.0 + h * 40.0));
  brule += vec3(1.0, 0.28, 0.03) * rouge * smoothstep(0.02, 0.18, l) * 1.3;
  diffuseColor.rgb = mix(diffuseColor.rgb, brule, wB);
}`);
  };
  materiau.customProgramCacheKey = () => (cleAvant ? cleAvant() : "") + "|brulable";
  materiau.needsUpdate = true;
}

/**
 * Cendres qui tombent et braises qui montent autour de la caméra (là où la vague est passée).
 * 2 draw calls, 70 + 70 sprites (planche Kenney). Renvoie { update(dt, camera) }.
 */
export function creerCendres(groupe) {
  const N = 70, BOITE = 45, HAUT = 28;
  const braises = new Sprites(N, textureParticules(), THREE.AdditiveBlending);
  const cendres = new Sprites(N, textureParticules(), THREE.NormalBlending);
  for (const s of [braises, cendres]) {
    s.mesh.frustumCulled = false;
    groupe.add(s.mesh);
  }
  const P = (montee) => Array.from({ length: N }, () => ({
    p: new THREE.Vector3((Math.random() - 0.5) * 2 * BOITE, Math.random() * HAUT, (Math.random() - 0.5) * 2 * BOITE),
    v: montee ? 1.2 + Math.random() * 2.2 : -(1 + Math.random() * 1.2),
    ph: Math.random() * 6.283, t: 0.15 + Math.random() * 0.35, rot: Math.random() * 6.283,
    cell: CELLULES_FUMEE[Math.floor(Math.random() * 3)],
  }));
  const B = P(true), C = P(false);
  const monde = new THREE.Vector3(), coul = new THREE.Color(), orange = new THREE.Color(1, 0.45, 0.1), gris = new THREE.Color(0.3, 0.28, 0.27);
  let t = 0;

  function avancer(liste, s, dt, cam, w, montee) {
    let n = 0;
    for (const q of liste) {
      q.p.y += q.v * dt;
      // la boîte suit la caméra : ce qui sort d'un côté revient de l'autre
      q.p.x += Math.sin(t * 0.9 + q.ph) * dt * (montee ? 0.8 : 1.5);
      if (montee && q.p.y > HAUT) q.p.y -= HAUT;
      if (!montee && q.p.y < 0) q.p.y += HAUT;
      monde.set(
        cam.x + THREE.MathUtils.euclideanModulo(q.p.x - cam.x + BOITE, 2 * BOITE) - BOITE,
        q.p.y,
        cam.z + THREE.MathUtils.euclideanModulo(q.p.z - cam.z + BOITE, 2 * BOITE) - BOITE
      );
      if (montee) {
        const a = w * (0.55 + 0.45 * Math.sin(t * 5 + q.ph)) * (1 - q.p.y / HAUT);
        s.poser(n++, monde, q.t * 1.6, 0, coul.copy(orange), a, cam, CELLULE.lueur);
      } else {
        s.poser(n++, monde, q.t * 1.3, q.rot + t * 0.5, coul.copy(gris), 0.85 * w, cam, q.cell);
      }
    }
    s.finir(w > 0.01 ? n : 0, false);
  }

  return {
    update(dt, camera) {
      t += dt;
      const cam = camera.position;
      const w = vagueLave(cam.x, cam.z);
      avancer(B, braises, dt, cam, w, true);
      avancer(C, cendres, dt, cam, w, false);
    },
  };
}
