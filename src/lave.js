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
float sol0 = 1.0;
if (wL > 0.002) {
  vec2 q = p / 9.0;
  vec3 roche = texture2D(tRocheLave, q).rgb * vec3(0.44, 0.4, 0.39); // basalte sombre (lave refroidie)
  vec3 braise = texture2D(tBraiseLave, q).rgb;
  // proximité de la route : pas de lave ouverte près de la route ni sur ses bas-côtés
  float proche = texture2D(tProche, clamp((vSolXZ - uCarteMin) / uCarteTaille, 0.0, 1.0)).r;
  float loin = 1.0 - smoothstep(0.05, 0.35, proche);
  // mares et coulées : là où la photo de lave, vue de très haut, est la plus claire
  vec3 grand = texture2D(tLave, vSolXZ / 650.0 + vec2(0.13, 0.71)).rgb;
  float g = dot(grand, vec3(0.45, 0.45, 0.1));
  float riviere = smoothstep(0.465, 0.525, g) * loin;   // la lave et sa croûte
  float coeur = smoothstep(0.51, 0.57, g) * loin;    // le milieu, plus chaud, moins croûté
  float halo = smoothstep(0.41, 0.49, g) * loin;      // la roche autour, éclairée par la lave
  // écoulement : la photo de lave se déforme (deux lectures décalées par une 3e, plus grande) ;
  // pas un simple défilement uniforme
  vec2 dw = texture2D(tLave, vSolXZ / 70.0 + vec2(uLaveTemps * 0.002, -uLaveTemps * 0.0015)).rg - 0.5;
  vec3 fusion = texture2D(tLave, (vSolXZ + dw * 16.0) / 17.0 + vec2(uLaveTemps * 0.008, uLaveTemps * 0.013)).rgb;
  // croûte : les fissures de "Lava 001" deviennent des plaques noires qui dérivent lentement
  // par-dessus la lave en fusion, la lave brille entre les plaques
  float fente = texture2D(tBraiseLave, (vSolXZ + dw * 5.0) / 10.0 + vec2(uLaveTemps * 0.003, uLaveTemps * 0.005)).r;
  float croute = 1.0 - clamp(coeur * 0.85 + fente * 1.8, 0.0, 1.0);
  croute = max(croute, (riviere - coeur) * 0.75); // bords épais et croûtés
  vec3 plaque = texture2D(tRocheLave, (vSolXZ + dw * 5.0) / 7.0).rgb * 0.32;
  // fissures du sol qui palpitent (plus calmes près de la route) ; cœur blanc-jaune là où la photo est la plus claire
  float pouls = 0.75 + 0.25 * sin(uLaveTemps * 2.2 + dot(vSolXZ, vec2(0.05, 0.08)));
  // la roche refroidie ne rougeoie presque plus, sauf près des coulées (chaleur)
  vec3 fissures = braise * (1.0 + 2.5 * braise.r * braise.r) * pouls * (0.1 + 1.6 * halo);
  // casse la répétition de la photo de roche : grandes zones plus claires ou plus sombres
  sol0 = 0.55 + 0.9 * texture2D(tRocheLave, vSolXZ / 97.0 + 0.31).g;
  float chaud = dot(fusion, vec3(0.4, 0.4, 0.2));
  vec3 eclat = fusion * (1.0 + 4.0 * chaud * chaud * chaud); // > 1 : elle brille même sous le ciel orangé
  vec3 sol = mix(roche * sol0, mix(fusion * 0.55, plaque, croute), riviere);
  c = mix(c, sol, wL);
  // le front de la vague brille
  float front = wL * (1.0 - wL) * 4.0;
  laveSol = (fissures * (1.0 - riviere) + eclat * riviere * (1.0 - croute) * 2.4
            + grand * (halo - riviere * 0.7) * 0.55 + fusion * front * 1.2) * wL;}`,
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
 * Cendres qui tombent et braises qui montent autour de la caméra (là où la vague est passée),
 * plus, au-dessus des mares de lave : un halo (la lave éclaire l'air) et de la vapeur qui monte.
 * 2 draw calls, au plus 70 + 36 et 70 + 36 sprites (planche Kenney). Renvoie { update(dt, camera) }.
 */
export function creerCendres(groupe, piste) {
  const N = 70, NM = 36, BOITE = 45, HAUT = 28;
  const braises = new Sprites(N + NM, textureParticules(), THREE.AdditiveBlending);
  const cendres = new Sprites(N + NM, textureParticules(), THREE.NormalBlending);
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
  const lueurMare = new THREE.Color(1, 0.42, 0.1), vapeur = new THREE.Color(0.78, 0.72, 0.68);
  let t = 0;

  // ---- mares de lave : retrouvées dans la même photo que le shader du sol (lecture unique) ----
  const mares = []; // { x, z, ph, w }
  let maresCherchees = false;
  function chercherMares() {
    const img = LAVE.uniforms.tLave.value?.image;
    if (!img || !img.width || !piste) return false;
    const W = 128, cv = document.createElement("canvas");
    cv.width = cv.height = W;
    const g2 = cv.getContext("2d", { willReadFrequently: true });
    g2.drawImage(img, 0, 0, W, W);
    const d = g2.getImageData(0, 0, W, W).data;
    // même lecture que le shader : uv = xz / 650 + (0,13 ; 0,71), image retournée (flipY)
    const lire = (x, z) => {
      const u = THREE.MathUtils.euclideanModulo(x / 650 + 0.13, 1), v = THREE.MathUtils.euclideanModulo(z / 650 + 0.71, 1);
      const k = (Math.floor((1 - v) * W) % W * W + Math.floor(u * W) % W) * 4;
      return (0.45 * d[k] + 0.45 * d[k + 1] + 0.1 * d[k + 2]) / 255;
    };
    const R = piste.rayon + 280, cands = [];
    for (let gx = -R; gx < R; gx += 9)
      for (let gz = -R; gz < R; gz += 9) {
        const x = piste.centre.x + gx, z = piste.centre.z + gz;
        if (lire(x, z) < 0.54) continue;
        let dMin = Infinity;
        for (let i = 0; i < piste.N; i += 3) dMin = Math.min(dMin, (x - piste.cx[i]) ** 2 + (z - piste.cz[i]) ** 2);
        dMin = Math.sqrt(dMin);
        if (dMin > 32 && dMin < 220) cands.push({ x, z, d: dMin });
      }
    cands.sort((a, b) => a.d - b.d); // les plus proches de la route d'abord : on les voit
    for (const c of cands) {
      if (mares.length >= NM) break;
      if (mares.some((m) => (m.x - c.x) ** 2 + (m.z - c.z) ** 2 < 55 * 55)) continue;
      mares.push({ x: c.x, z: c.z, ph: Math.random() * 6.283, cell: CELLULES_FUMEE[mares.length % 3] });
    }
    return true;
  }

  function avancer(liste, s, dt, cam, w, montee) {
    let n = 0;
    if (w > 0.01) for (const q of liste) {
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
    // mares : halo qui respire (additif) ou vapeur qui monte en boucle
    for (const m of mares) {
      const wm = vagueLave(m.x, m.z);
      if (wm < 0.01) continue;
      if (montee) {
        monde.set(m.x, 0.8, m.z);
        s.poser(n++, monde, 34 + 5 * Math.sin(t * 1.3 + m.ph), 0, lueurMare, wm * (0.35 + 0.1 * Math.sin(t * 2.1 + m.ph)), cam, CELLULE.lueur);
      } else {
        const k = THREE.MathUtils.euclideanModulo(t * 0.09 + m.ph / 6.283, 1);
        monde.set(m.x + k * 4, 2 + k * 18, m.z);
        s.poser(n++, monde, 8 + k * 16, m.ph + k, vapeur, wm * 0.32 * Math.sin(k * Math.PI), cam, m.cell);
      }
    }
    s.finir(n, false);
  }

  return {
    update(dt, camera) {
      t += dt;
      if (!maresCherchees && LAVE.uniforms.uLaveRayon.value > 0) maresCherchees = chercherMares();
      const cam = camera.position;
      const w = vagueLave(cam.x, cam.z);
      avancer(B, braises, dt, cam, w, true);
      avancer(C, cendres, dt, cam, w, false);
    },
  };
}