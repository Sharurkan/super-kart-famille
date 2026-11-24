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
    // distance à la route (masque de decor.js) : où la lave peut couler
    tProche: { value: null },
    uLaveCarteMin: { value: new THREE.Vector2() },
    uLaveCarteTaille: { value: 1 },
    uBordLave: { value: 14 }, // m de l'axe de la route jusqu'aux barrières
  },
};
/** Distance maximale codée dans le masque de proximité de la route (decor.js). */
export const DIST_MAX_ROUTE = 45;

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

/** decor.js : la carte de proximité de la route du circuit en cours. */
export function lierRouteLave(proche, carteMin, carteTaille, bord) {
  const u = LAVE.uniforms;
  u.tProche.value = proche;
  u.uLaveCarteMin.value.copy(carteMin);
  u.uLaveCarteTaille.value = carteTaille;
  u.uBordLave.value = bord;
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

/**
 * GLSL : où coule la lave (x = lave, y = cœur chaud, z = halo sur la roche autour).
 * Deux sources : des rivières qui longent la route par endroits, de 7 à 20 m derrière les
 * barrières (jamais sur l'herbe roulable), et de grandes mares plus loin. Les deux sont lues
 * dans la photo "Lava 004" vue de très haut (ses zones claires), pas dessinées en code.
 */
export const GLSL_RIVIERES = `
uniform sampler2D tLave, tProche;
uniform vec2 uLaveCarteMin;
uniform float uLaveCarteTaille, uBordLave;
float distRoute(vec2 xz) {
  return (1.0 - textureLod(tProche, clamp((xz - uLaveCarteMin) / uLaveCarteTaille, 0.0, 1.0), 0.0).r) * ${DIST_MAX_ROUTE.toFixed(1)};
}
vec3 riviereLave(vec2 xz) {
  float d = distRoute(xz), b = uBordLave;
  // (les photos sont lues en linéaire : on revient aux valeurs de l'image pour les seuils)
  // niveau de détail fixe : la même forme de près comme de loin (sinon, au loin, la moyenne des mipmaps noierait tout)
  float g = pow(dot(textureLod(tLave, xz / 650.0 + vec2(0.13, 0.71), 2.0).rgb, vec3(0.45, 0.45, 0.1)), 0.4545);
  float g2 = pow(dot(textureLod(tLave, xz / 380.0 + vec2(0.57, 0.21), 2.0).rgb, vec3(0.45, 0.45, 0.1)), 0.4545);
  float loin = smoothstep(b + 6.0, b + 9.0, d);
  // le long de la route : une bande de 7 à 20 m derrière les barrières, présente par endroits
  float par = smoothstep(0.43, 0.47, g2);
  float bande = loin * (1.0 - smoothstep(b + 17.0, b + 22.0, d)) * par;
  float bandeC = bande * smoothstep(b + 8.0, b + 10.0, d) * (1.0 - smoothstep(b + 17.0, b + 20.0, d));
  float lave = max(smoothstep(0.545, 0.59, g) * loin, bande);
  float coeur = max(smoothstep(0.565, 0.62, g) * loin, bandeC);
  float halo = max(smoothstep(0.52, 0.58, g), par * (1.0 - smoothstep(b + 20.0, b + 30.0, d))) * smoothstep(b + 1.0, b + 6.0, d);
  return vec3(lave, coeur, halo);
}`;

/** Où en est la vague en un point (pour le JS : cendres autour de la caméra). */
export function vagueLave(x, z) {
  const u = LAVE.uniforms, d = Math.hypot(x - u.uLaveCentre.value.x, z - u.uLaveCentre.value.y);
  return THREE.MathUtils.smoothstep(u.uLaveRayon.value - d, 0, LARGEUR);
}

/**
 * Le sol (matériau photo de decor.js) : morceaux de shader à insérer.
 * Variables disponibles dans le shader du sol : vSolXZ, p (coordonnées ondulées), c (couleur).
 */
export const GLSL_SOL_LAVE = {
  declarations: `${GLSL_LAVE}${GLSL_RIVIERES}
uniform sampler2D tRocheLave, tBraiseLave;`,
  // à la fin du calcul de la couleur du sol (avant diffuseColor.rgb *= c)
  couleur: `
vec3 laveSol = vec3(0.0);
float wL = vagueLave(vSolXZ);
if (wL > 0.002) {
  // roche refroidie : noire et mate (la photo "Lava 001" sans ses couleurs, grande échelle),
  // avec de grandes variations lues dans la même photo à très grande échelle (pas de tapis répété)
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * p / 23.0;
  float lr = dot(texture2D(tRocheLave, q).rgb, vec3(0.33));
  float macro = dot(texture2D(tRocheLave, vSolXZ / 230.0 + 0.31).rgb, vec3(0.33)) * dot(texture2D(tRocheLave, vSolXZ / 61.0 + 0.77).rgb, vec3(0.33));
  vec3 roche = vec3(lr) * vec3(0.3, 0.27, 0.25) * (0.45 + 2.2 * macro);
  vec3 braise = texture2D(tBraiseLave, p / 7.0).rgb;
  vec3 R = riviereLave(vSolXZ);
  float riviere = R.x, coeur = R.y, halo = R.z;
  float d = distRoute(vSolXZ);
  // écoulement : la photo de lave se déforme (lue deux fois, décalée par une 3e plus grande)
  vec2 dw = texture2D(tLave, vSolXZ / 70.0 + vec2(uLaveTemps * 0.002, -uLaveTemps * 0.0015)).rg - 0.5;
  vec3 fusion = texture2D(tLave, (vSolXZ + dw * 16.0) / 15.0 + vec2(uLaveTemps * 0.012, uLaveTemps * 0.018)).rgb;
  // croûte : plaques noires (fissures de "Lava 001") qui dérivent lentement sur la lave en fusion
  float fente = texture2D(tBraiseLave, (vSolXZ + dw * 5.0) / 9.0 + vec2(uLaveTemps * 0.004, uLaveTemps * 0.006)).r;
  float chaud = pow(dot(fusion, vec3(0.4, 0.4, 0.2)), 0.4545);
  // les veines sombres de la photo de lave deviennent la croûte qui dérive ; plaques plus grandes au bord
  float croute = smoothstep(0.46, 0.33, chaud - fente * 0.15) * 0.9;
  croute = max(croute, (riviere - coeur) * 0.8); // bords épais et croûtés
  vec3 plaque = vec3(dot(texture2D(tRocheLave, (vSolXZ + dw * 5.0) / 7.0).rgb, vec3(0.33))) * vec3(0.22, 0.19, 0.17);
  // fines fissures lumineuses : sur les bas-côtés et près des coulées seulement
  float pouls = 0.8 + 0.2 * sin(uLaveTemps * 2.2 + dot(vSolXZ, vec2(0.05, 0.08)));
  float cote = 1.0 - smoothstep(uBordLave - 2.0, uBordLave + 2.0, d);
  vec3 fissures = braise * braise.r * braise.r * pouls * (0.5 * cote + 1.6 * halo);
  vec3 eclat = fusion * (1.6 + 4.5 * chaud * chaud * chaud); // > 1 : elle brille même sous le ciel orangé
  c = mix(c, mix(roche, mix(fusion * 0.5, plaque, croute), riviere), wL);
  float front = wL * (1.0 - wL) * 4.0; // le front de la vague brille
  laveSol = (fissures * (1.0 - riviere) + eclat * riviere * (1.0 - croute) * 2.2
            + fusion * halo * (1.0 - riviere) * 0.16 + fusion * front * 1.2) * wL;
}`,  emission: `totalEmissiveRadiance += laveSol;`,
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
      .replace("#include <common>", `#include <common>\nvarying vec3 vLaveInst;${GLSL_LAVE}${GLSL_RIVIERES}`)
      .replace("#include <fog_vertex>", `#include <fog_vertex>
#ifdef USE_INSTANCING
vLaveInst = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
vLaveInst = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif
// englouti par une rivière de lave : la plante a brûlé, elle disparaît
if (vagueLave(vLaveInst.xz) > 0.6 && riviereLave(vLaveInst.xz).x > 0.3) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);`);
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
  const N = 70, NM = 48, BOITE = 45, HAUT = 28;
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
    // même lecture que le shader (riviereLave) : image retournée (flipY)
    const lire = (x, z, echelle, ox, oz) => {
      const u = THREE.MathUtils.euclideanModulo(x / echelle + ox, 1), v = THREE.MathUtils.euclideanModulo(z / echelle + oz, 1);
      const k = (Math.floor((1 - v) * W) % W * W + Math.floor(u * W) % W) * 4;
      return (0.45 * d[k] + 0.45 * d[k + 1] + 0.1 * d[k + 2]) / 255;
    };
    const bord = LAVE.uniforms.uBordLave.value, R = piste.rayon + 280, cands = [];
    for (let gx = -R; gx < R; gx += 6)
      for (let gz = -R; gz < R; gz += 6) {
        const x = piste.centre.x + gx, z = piste.centre.z + gz;
        const mare = lire(x, z, 650, 0.13, 0.71) >= 0.58, bande = lire(x, z, 380, 0.57, 0.21) >= 0.46;
        if (!mare && !bande) continue;
        let dMin = Infinity;
        for (let i = 0; i < piste.N; i += 2) dMin = Math.min(dMin, (x - piste.cx[i]) ** 2 + (z - piste.cz[i]) ** 2);
        dMin = Math.sqrt(dMin);
        if ((bande && dMin > bord + 10 && dMin < bord + 16) || (mare && dMin > bord + 10 && dMin < 220)) cands.push({ x, z, d: dMin });
      }    cands.sort((a, b) => a.d - b.d); // les plus proches de la route d'abord : on les voit
    for (const c of cands) {
      if (mares.length >= NM) break;
      if (mares.some((m) => (m.x - c.x) ** 2 + (m.z - c.z) ** 2 < 40 * 40)) continue;
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