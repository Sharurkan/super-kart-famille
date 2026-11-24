import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { chargerTexturesSol } from "./decor.js";
import { audio } from "./audio.js";
import { LAVE, GLSL_LAVE } from "./lave.js";

// Volcan en éruption (circuit Dinosaures), au fond de la grande plaine.
//
// Modèle : "Zheltovsky volcano" de SebastianSosnowski (Sketchfab, CC-BY 4.0), préparé par
// outils/blender/pack_zheltovsky.py : sommet recentré sur l'origine, pied qui plonge sous le sol
// (plus de bord carré), cratère peu profond creusé au sommet, textures réduites. La photo
// d'origine (roche, ravines) reste la couleur de base.
//
// Tout est fait pour rester léger sur une tablette :
//  - la montagne : 1 draw call ; son shader ajoute le pied qui se fond dans le sol, les coulées
//    de lave qui descendent dans les vraies ravines (photos de lave ambientCG, croûte qui dérive,
//    halos additifs le long des coulées) et le cratère qui rougeoie
//    (aucune lumière ajoutée à la scène : pas de PointLight, pas d'ombre) ;
//  - la fumée : 1 draw call (sprites face caméra, instanciés, triés du plus loin au plus près) ;
//  - les projections de lave et la lueur du cratère : 1 draw call (sprites additifs).
// Moins de 140 sprites en tout. Toutes les projections retombent sur les flancs (moins de
// 130 m de l'axe ; la route passe à plus de 300 m) et la fumée part à l'opposé de la piste.

// mètres (assez grand pour être imposant depuis la piste) ; un peu plus haut que les proportions
// réelles du modèle (×1,15 en hauteur) : plus lisible de loin pour les enfants
const DIMENSIONS = { hauteur: 140, largeur: 380 };
// le terrain du modèle plonge sous le sol avant son bord : au-delà de ~87 % du rayon, plus rien ne dépasse
const RAYON_PIED = (DIMENSIONS.largeur / 2) * 0.87;
const NB_FUMEE = 56;
const NB_LAVE = 72; // projections (les 2 dernières places : lueur du cratère)
const NB_HALOS = 40; // lueurs le long des coulées
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
    tCoulees: { value: null }, // masque des coulées (tracerCoulees)
    uSombre: { value: 0 }, // après l'impact : la roche noircit (la lave ressort)
  };
  const etat = {
    pret: false, t: 0,
    sommet: new THREE.Vector3(), rayon: 25, profil: null,
    prochaine: 8 + Math.random() * 6, // première grosse éruption assez tôt
    eruption: -1, // temps écoulé depuis le début de la grosse éruption en cours (-1 : aucune)
    emisFumee: 0, emisLave: 0,
    forceMax: 1, renfort: 0,
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
    const taille = boite.getSize(new THREE.Vector3());
    const sh = DIMENSIONS.largeur / Math.max(taille.x, taille.z), sv = DIMENSIONS.hauteur / taille.y;
    modele.scale.set(sh, sv, sh);
    // l'axe du cratère est déjà à l'origine du modèle ; son zéro (terrain d'origine) reste un peu
    // sous le sol du jeu, le bord du disque est bien plus bas (pas de bord visible)
    modele.position.set(0, -2, 0);
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
    tracerCoulees(pts, cx, cz, yMax, modele);
    etat.pret = true;
  });

  // ---------- coulées de lave : elles suivent les vraies ravines du modèle ----------
  // Une carte des hauteurs (cases de 4 m) est tirée des sommets ; depuis le bord du cratère, on
  // descend par la plus grande pente (avec un peu d'élan) : la coulée tombe dans les ravines.
  // Le résultat est un masque (données, pas une image affichée) : R = coulée (s'élargit en
  // descendant), G = avancée le long de la coulée (front croûté), B = halo sur la roche autour.
  // L'aspect vient des photos de lave (lave.js) lues dans le shader de la roche.
  const halosCoulees = []; // { p: Vector3, a (avancée 0..1), ph } : sprites de lueur le long des coulées
  function tracerCoulees(pts, cx, cz, yMax, modele) {
    // hauteur exacte de la surface (rayon vertical sur le modèle) : le maillage est simplifié, la
    // carte des hauteurs passerait sous ses grandes faces bombées
    const rayon = new THREE.Raycaster(), haut = new THREE.Vector3(), bas = new THREE.Vector3(0, -1, 0);
    const surface = (x, z) => {
      rayon.set(haut.set(x + support.position.x, 400, z + support.position.z), bas);
      const hit = rayon.intersectObject(modele, true)[0];
      return hit ? hit.point.y : H(x, z);
    };
    const CASE = 4, DEMI = 200, NG = (2 * DEMI) / CASE;
    const h = new Float32Array(NG * NG).fill(-1e9);
    for (let k = 0; k < pts.length; k += 3) {
      const i = Math.floor((pts[k] + DEMI) / CASE), j = Math.floor((pts[k + 2] + DEMI) / CASE);
      if (i >= 0 && j >= 0 && i < NG && j < NG) h[j * NG + i] = Math.max(h[j * NG + i], pts[k + 1]);
    }
    // cases vides : moyenne des voisines (quelques passes)
    for (let passe = 0; passe < 6; passe++)
      for (let j = 1; j < NG - 1; j++)
        for (let i = 1; i < NG - 1; i++) {
          if (h[j * NG + i] > -1e8) continue;
          let s = 0, n = 0;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = h[(j + dj) * NG + i + di]; if (v > -1e8) { s += v; n++; } }
          if (n) h[j * NG + i] = s / n;
        }
    // hauteur interpolée (bilinéaire) : les rubans de lave épousent le relief
    const Hc = (i, j) => { const v = h[THREE.MathUtils.clamp(j, 0, NG - 1) * NG + THREE.MathUtils.clamp(i, 0, NG - 1)]; return v > -1e8 ? v : 0; };
    const H = (x, z) => {
      const fx = (x + DEMI) / CASE - 0.5, fz = (z + DEMI) / CASE - 0.5, i = Math.floor(fx), j = Math.floor(fz), ax = fx - i, az = fz - j;
      return (Hc(i, j) * (1 - ax) + Hc(i + 1, j) * ax) * (1 - az) + (Hc(i, j + 1) * (1 - ax) + Hc(i + 1, j + 1) * ax) * az;
    };
    const pos = [], uvs = [], avs = [], idx = []; // géométrie des rubans
    const P = 512, px = P / (2 * DEMI);
    const cv = document.createElement("canvas");
    cv.width = cv.height = P;
    const g = cv.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, P, P);
    g.lineCap = g.lineJoin = "round";
    g.globalCompositeOperation = "lighten";
    // 4 coulées, du côté de la piste (versPiste) : bien visibles en roulant
    const departs = [0, -0.6, 0.62, -1.2];
    for (const [nf, da] of departs.entries()) {
      const a0 = versPiste + da + (Math.random() - 0.5) * 0.2;
      let x = cx + Math.cos(a0) * etat.rayon * 0.95, z = cz + Math.sin(a0) * etat.rayon * 0.95;
      let dx = Math.cos(a0), dz = Math.sin(a0);
      const chemin = [[x, z]];
      for (let s = 0; s < 150; s++) {
        const e = 6;
        let gx = H(x + e, z) - H(x - e, z), gz = H(x, z + e) - H(x, z - e);
        const gl = Math.hypot(gx, gz) || 1;
        // la pente + l'élan + une petite poussée vers l'extérieur (pas de demi-tour sur un replat)
        const rx = x - cx, rz = z - cz, rl = Math.hypot(rx, rz) || 1;
        dx = dx * 0.7 - (gx / gl) * 0.18 + (rx / rl) * 0.16;
        dz = dz * 0.7 - (gz / gl) * 0.18 + (rz / rl) * 0.16;
        const dl = Math.hypot(dx, dz) || 1;
        dx /= dl; dz /= dl;
        x += dx * 2.5; z += dz * 2.5;
        chemin.push([x, z]);
        if (H(x, z) < 4 || rl > RAYON_PIED * 0.92) break;
      }
      const L = chemin.length;
      // halo (B) large et doux, puis la coulée (R, G) qui s'élargit
      for (const passe of [0, 1]) {
        g.filter = passe ? `blur(${(2.2 * px).toFixed(1)}px)` : `blur(${(8 * px).toFixed(1)}px)`;
        for (let k = 1; k < L; k++) {
          const a = k / L, larg = largeur(a) * (passe ? 1.1 : 1.7);
          g.lineWidth = larg * px;
          g.strokeStyle = passe ? `rgb(255,${Math.round(a * 255)},0)` : "rgb(0,0,200)";
          g.beginPath();
          g.moveTo((chemin[k - 1][0] + DEMI) * px, (chemin[k - 1][1] + DEMI) * px);
          g.lineTo((chemin[k][0] + DEMI) * px, (chemin[k][1] + DEMI) * px);
          g.stroke();
        }
      }
      // le ruban : 3 sommets par section (bord, milieu un peu bombé, bord), posés sur le relief
      const base = pos.length / 3;
      let dist = 0;
      for (let k = 0; k < L; k += 2) {
        const [x0, z0] = chemin[k], [x1, z1] = chemin[Math.min(L - 1, k + 2)], [xp, zp] = chemin[Math.max(0, k - 2)];
        let tx = x1 - xp, tz = z1 - zp;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        if (k > 0) dist += Math.hypot(x0 - chemin[k - 2][0], z0 - chemin[k - 2][1]);
        const a = k / (L - 1), w = largeur(a) / 2;
        for (const s of [-1, 0, 1]) {
          const x = x0 - tz * w * s, z = z0 + tx * w * s;
          pos.push(x, surface(x, z) + (s ? 0.7 : 1.3), z);
          uvs.push((s + 1) / 2, dist);
          avs.push(a);
        }
      }
      const sections = (pos.length / 3 - base) / 3;
      for (let k = 0; k < sections - 1; k++)
        for (let s = 0; s < 2; s++) {
          const a = base + k * 3 + s, b = a + 3;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      // quelques lueurs le long de la coulée (sprites additifs, pas de vraie lumière)
      for (let k = 6; k < L; k += 14) {
        const [hx, hz] = chemin[k];
        halosCoulees.push({ p: new THREE.Vector3(hx, surface(hx, hz) + 5, hz), a: k / L, ph: Math.random() * 6.283 });
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.flipY = false; // ligne 0 du dessin = z minimal
    uniformes.tCoulees.value = tex;
    // les rubans de lave : 1 draw call, quelques centaines de triangles
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute("aAvance", new THREE.Float32BufferAttribute(avs, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const rubans = new THREE.Mesh(geo, materiauCoulee(uniformes));
    rubans.renderOrder = 1;
    support.add(rubans);
  }
  // largeur d'une coulée (m) selon l'avancée : 10 m au cratère, 25 m au pied
  const largeur = (a) => 10 + 15 * Math.pow(a, 0.7);

  // ---------- sprites (fumée, lave) ----------
  const fumee = new Sprites(NB_FUMEE, textureParticules(), THREE.NormalBlending);
  const lave = new Sprites(NB_LAVE + NB_HALOS, textureParticules(), THREE.AdditiveBlending);
  support.add(fumee.mesh, lave.mesh);

  // fumée : position, vitesse, âge, durée de vie, taille de départ/fin, sombre (cendres)
  const F = Array.from({ length: NB_FUMEE }, () => ({ vivant: false, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, vie: 1, t0: 1, t1: 1, sombre: 0, rot: 0, dr: 0, cell: 0 }));
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
    f.cell = CELLULES_FUMEE[Math.floor(Math.random() * CELLULES_FUMEE.length)];
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
    let force = 0; // 0 : activité normale ; 1 au plus fort d'une grosse éruption (plus après la météorite)
    if (etat.eruption >= 0) {
      etat.eruption += dt;
      const e = etat.eruption, duree = 5 * etat.forceMax; // une éruption plus forte dure plus longtemps
      force = (e < 0.4 ? e / 0.4 : Math.max(0, 1 - (e - 0.4) / duree)) * etat.forceMax;
      if (e > duree + 1) etat.eruption = -1;
    }
    const b = etat.renfort; // activité de fond renforcée (après l'impact de la météorite)
    uniformes.uSombre.value += (b - uniformes.uSombre.value) * Math.min(1, dt * 0.15);
    // rougeoiement : respire doucement, flambe pendant l'éruption
    uniformes.uLueur.value = 0.65 + 0.12 * Math.sin(etat.t * 1.7) + 0.08 * Math.sin(etat.t * 4.3) + force * 1.2 + b * 0.6;

    // --- émission --- (les projections restent assez lentes pour retomber sur les flancs)
    etat.emisFumee += dt * (3 + b * 3 + force * 9);
    while (etat.emisFumee >= 1) { etat.emisFumee--; lancerFumee(Math.max(force, b * 0.5)); }
    etat.emisLave += dt * (0.8 + b * 2.5 + force * (etat.eruption < 1.8 ? 34 : 4));
    while (etat.emisLave >= 1) { etat.emisLave--; lancerLave(Math.min(1.2, Math.max(force, b * 0.4))); }

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
      fumee.poser(n++, f.p, s, f.rot, coul, alpha, camLocale, f.cell);
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
      lave.poser(n++, l.p, l.taille * (1 - froid * 0.35), 0, coul, 1 - Math.max(0, froid - 0.7) / 0.3 * 0.9, camLocale, CELLULE.lueur);
    }
    // lueur au-dessus du cratère (deux halos qui respirent)
    const lu = uniformes.uLueur.value;
    halo.set(etat.sommet.x, etat.sommet.y + etat.rayon * 0.2, etat.sommet.z);
    lave.poser(n++, halo, etat.rayon * (2.6 + lu * 0.8), 0, coul.setRGB(1, 0.38, 0.08), Math.min(1, 0.35 + lu * 0.3), camLocale, CELLULE.lueur);
    halo.y += etat.rayon * 0.6;
    lave.poser(n++, halo, etat.rayon * (1.5 + lu * 0.9), 0, coul.setRGB(1, 0.75, 0.35), Math.min(1, 0.2 + lu * 0.35), camLocale, CELLULE.lueur);
    // la lave des coulées éclaire l'air au-dessus d'elle (plus fort près du cratère)
    for (const hc of halosCoulees) {
      if (n >= NB_LAVE + NB_HALOS) break;
      const a = (1 - hc.a * 0.6) * (0.75 + 0.25 * Math.sin(etat.t * 1.7 + hc.ph)) * Math.min(1, 0.6 + lu * 0.3);
      lave.poser(n++, hc.p, 16 + 18 * hc.a, 0, coul.setRGB(1, 0.42 - hc.a * 0.15, 0.1), a, camLocale, CELLULE.lueur);
    }
    lave.finir(n, false);
  }

  function declencher(forceMax = 1, son = true) {
    // une fois renforcé (météorite), le volcan repart toutes les 7 à 12 s
    etat.prochaine = etat.renfort > 0 ? 7 + Math.random() * 5 : 15 + Math.random() * 10;
    etat.eruption = 0;
    etat.forceMax = forceMax;
    // grondement si on est assez près pour l'entendre (le volcan est à 300 m et plus de la piste)
    if (camPos && son) {
      const d = Math.hypot(camPos.x - support.position.x, camPos.z - support.position.z);
      if (d < 800) audio.grondement?.(Math.min(1, Math.max(0.15, 1 - (d - 300) / 500)));
    }
  }
  let camPos = null;

  return {
    support,
    rayonPied: RAYON_PIED,
    get pret() { return etat.pret; },
    get etat() { return etat; },
    update(dt, camera) {
      if (!camera) return;
      camPos = camera.position;
      update(dt, camera);
    },
    /** Déclenche tout de suite une grosse éruption (force 1 : normale ; jusqu'à ~1,5 : maximale et plus longue). */
    eruption: (force = 1, son = true) => declencher(force, son),
    /** Activité de fond renforcée jusqu'à la fin de la course (0..1). */
    renforcer: (niveau = 1) => { etat.renfort = niveau; },
  };
}

// ---------------------------------------------------------------------------
// Matériau de la montagne : Lambert (même lumière que le décor) + quelques lignes de shader.
function materiauRoche(ancien, uniformes) {
  const m = new THREE.MeshLambertMaterial({ map: ancien.map, normalMap: ancien.normalMap });
  if (ancien.normalMap) m.normalScale.copy(ancien.normalScale).multiplyScalar(1.3);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, LAVE.uniforms, uniformes);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMonde;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvMonde = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vMonde;
uniform float uTemps, uLueur, uVue, uSombre;
uniform vec3 uOrigine;
uniform vec4 uCratere;
uniform sampler2D tSol, tRocheLave, tBraiseLave, tLave, tCoulees;
${GLSL_LAVE}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float bruit(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float sat(float x) { return clamp(x, 0.0, 1.0); }`)
      .replace("#include <map_fragment>", `#include <map_fragment>
// repère du volcan : q = position autour de l'axe du cratère, hn = 0 au bord, 1 au pied
vec3 local = vMonde - uOrigine;
vec2 q = local.xz - uCratere.xz;
float r = length(q);
float hn = clamp((uCratere.y - local.y) / uCratere.y, -0.2, 1.0);
// pied : la roche se couvre de terre et d'herbe (même photo que le sol de la forêt), sans bord net
vec3 sol = texture2D(tSol, vMonde.xz / 7.0).rgb * vec3(0.78, 0.86, 0.6);
// monde en lave (lave.js) : le pied herbeux devient de la roche volcanique, la mousse disparaît
float wLave = vagueLave(vMonde.xz);
if (wLave > 0.002) sol = mix(sol, texture2D(tRocheLave, vMonde.xz / 9.0).rgb * vec3(0.62, 0.56, 0.54), wLave);
float pied = 1.0 - smoothstep(4.0, 26.0 + 14.0 * bruit(vMonde.xz / 25.0), local.y);
// un peu de mousse et de buissons sur le bas des pentes
float mousse = (1.0 - smoothstep(20.0, 55.0, local.y)) * smoothstep(0.45, 0.75, bruit(vMonde.xz / 9.0)) * 0.45;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.7, 1.05, 0.55) + vec3(0.02, 0.04, 0.0), mousse * (1.0 - wLave));
diffuseColor.rgb = mix(diffuseColor.rgb, sol, pied);
// près du cratère : roche à peine roussie par la chaleur (la photo du modèle reste la base)
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.2, 0.9, 0.8), smoothstep(0.12, 0.0, hn) * 0.5);
// coulées de lave : masque des vraies ravines (tracerCoulees) ; l'aspect vient des photos de lave
vec4 cm = texture2D(tCoulees, (local.xz + 200.0) / 400.0);
float c = cm.r, avance = sat(cm.g / max(cm.r, 0.02)), haloC = cm.b;
// repère de l'écoulement : la lave descend depuis le cratère ; la photo se déforme en coulant
vec2 fl = vec2(atan(q.y, q.x) * 40.0, r);
vec2 dw = texture2D(tLave, fl / 80.0 + vec2(0.0, -uTemps * 0.003)).rg - 0.5;
vec3 fusion = texture2D(tLave, (fl + dw * 14.0) / 20.0 + vec2(0.0, -uTemps * 0.018)).rgb;
// plaques de croûte noire qui dérivent plus lentement, lave brillante dans les fentes
float fente = texture2D(tBraiseLave, (fl + dw * 5.0) / 12.0 + vec2(0.0, -uTemps * 0.006)).r;
float coeurC = smoothstep(0.8, 1.0, c) * (1.0 - avance);
float croute = 1.0 - sat(coeurC * 0.45 + fente * 1.7); // plaques partout, lave dans les fentes ; plus ouverte près du cratère
croute = max(croute, smoothstep(0.6, 1.0, avance) * 0.85); // front sombre et croûté
croute = max(croute, (1.0 - smoothstep(0.3, 0.6, c)) * 0.7); // bords épais et croûtés
float couv = smoothstep(0.08, 0.45, c);
vec3 plaque = texture2D(tRocheLave, (fl + dw * 5.0) / 8.0).rgb * 0.5;
// sous les rubans (rendus à part, voir materiauCoulee) : roche sombre et croûtée
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(plaque, vec3(0.33))) * vec3(0.5, 0.42, 0.36), couv);
// après l'impact : la roche noircit, la neige disparaît (on garde le grain de la photo)
float lumR = dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(min(lumR, 0.45)) * vec3(0.42, 0.33, 0.27), uSombre * 0.9);
float chaudC = dot(fusion, vec3(0.4, 0.4, 0.2));
vec3 laveV = fusion * haloC * (1.0 - couv) * (0.04 + 0.06 * uSombre); // la roche autour, éclairée par la lave des rubans
// fond du cratère : lave
float fond = (1.0 - smoothstep(uCratere.w * 0.5, uCratere.w * 0.85, r)) * smoothstep(-0.02, 0.06, hn);
vec3 fusionF = texture2D(tLave, q / 18.0 + vec2(uTemps * 0.01, uTemps * 0.007) + dw * 0.4).rgb;`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
totalEmissiveRadiance += laveV * (0.8 + 0.25 * uLueur);
totalEmissiveRadiance += fusionF * (1.0 + 3.0 * pow(dot(fusionF, vec3(0.4, 0.4, 0.2)), 3.0)) * fond * (1.2 + 0.8 * uLueur);// le bord et le haut des pentes reflètent la lueur du cratère
totalEmissiveRadiance += vec3(0.6, 0.16, 0.03) * uLueur * 0.22 * smoothstep(0.18, 0.0, hn) * (1.0 - smoothstep(uCratere.w, uCratere.w * 2.2, r));`)
      .replace("#include <fog_fragment>", `#ifdef USE_FOG
  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth) * ${BROUILLARD.toFixed(2)};
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`);
  };
  m.customProgramCacheKey = () => "volcan-roche-lave";
  return m;
}


// ---------------------------------------------------------------------------
// Les coulées : rubans posés sur le relief. Aspect = photos ambientCG (lave.js) : lave en fusion
// (Lava 004) qui se déforme en descendant, plaques de croûte (fissures de Lava 001) qui dérivent
// plus lentement, bords épais et front croûtés, cœur très lumineux (> 1). Pas de lumière ajoutée.
function materiauCoulee(uniformes) {
  return new THREE.ShaderMaterial({
    uniforms: { uTemps: uniformes.uTemps, uLueur: uniformes.uLueur, tLave: LAVE.uniforms.tLave, tBraiseLave: LAVE.uniforms.tBraiseLave, tRocheLave: LAVE.uniforms.tRocheLave },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    vertexShader: `
attribute float aAvance;
varying vec2 vUv; varying float vA;
void main() {
  vUv = uv; vA = aAvance;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: `
uniform float uTemps, uLueur;
uniform sampler2D tLave, tBraiseLave, tRocheLave;
varying vec2 vUv; varying float vA;
void main() {
  float larg = 10.0 + 15.0 * pow(vA, 0.7);
  vec2 fl = vec2((vUv.x - 0.5) * larg, vUv.y);
  vec2 dw = texture2D(tLave, fl / 50.0 + vec2(0.0, -uTemps * 0.004)).rg - 0.5;
  vec3 fusion = texture2D(tLave, (fl + dw * 9.0) / 14.0 + vec2(0.0, -uTemps * 0.045)).rgb;
  float fente = texture2D(tBraiseLave, (fl + dw * 4.0) / 8.0 + vec2(0.0, -uTemps * 0.012)).r;
  float bord = abs(vUv.x - 0.5) * 2.0;
  float chaud = pow(dot(fusion, vec3(0.4, 0.4, 0.2)), 0.4545); // valeurs de l'image (lue en linéaire)
  // croûte : les veines sombres de la photo de lave, qui dérivent ; la lave reste ouverte au milieu
  float croute = smoothstep(0.46, 0.33, chaud - fente * 0.15) * (0.55 + 0.45 * vA);
  croute = max(croute, smoothstep(0.72, 0.95, bord) * 0.9); // bords épais (levées de lave refroidie)
  croute = max(croute, smoothstep(0.8, 1.0, vA) * 0.75);    // front plus sombre
  vec3 plaque = vec3(dot(texture2D(tRocheLave, fl / 6.0).rgb, vec3(0.33))) * vec3(0.28, 0.24, 0.22);
  vec3 lave = fusion * (2.2 + 9.0 * chaud * chaud * chaud * chaud) * (0.9 + 0.15 * uLueur);
  gl_FragColor = vec4(mix(lave, plaque, croute), 1.0 - smoothstep(0.9, 1.0, bord));
}`,
  });
}
// ---------------------------------------------------------------------------
// Planche de particules (public/meteorite/particules.webp) : 8 images du Kenney Particle Pack
// (CC0, https://kenney.nl/assets/particle-pack), en blanc, teintées dans le shader.
// Grille 4 × 2, de gauche à droite puis de haut en bas.
export const CELLULE = {
  fumee1: 0, fumee2: 1, fumee3: 2, // bouffées de fumée (smoke_04, smoke_08, smoke_07)
  feu1: 3, feu2: 4, // flammes (fire_01, fire_02) : alternées comme une petite animation
  lueur: 5, // halo rond et doux (circle_05)
  anneau: 6, // anneau (circle_03) : onde de choc
  eclair: 7, // éclat en étoile (scorch_01) : flash de l'impact
};
export const CELLULES_FUMEE = [CELLULE.fumee1, CELLULE.fumee2, CELLULE.fumee3];
const GRILLE = [4, 2];
let texturePartagee = null;
/** La planche de particules (chargée une seule fois, partagée par le volcan et la météorite). */
export function textureParticules() {
  if (!texturePartagee) {
    texturePartagee = new THREE.TextureLoader().load(import.meta.env.BASE_URL + "meteorite/particules.webp");
    texturePartagee.colorSpace = THREE.SRGBColorSpace;
  }
  return texturePartagee;
}

// Sprites face caméra instanciés : 1 draw call pour toute une famille (fumée ou lave).
// Chaque sprite choisit son image dans la planche (cellule).
export class Sprites {
  constructor(max, texture, blending) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(max * 4); // x, y, z, taille
    this.coul = new Float32Array(max * 4); // r, g, b, alpha
    this.rot = new Float32Array(max * 2); // rotation, cellule
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 4).setUsage(THREE.DynamicDrawUsage);
    this.aCoul = new THREE.InstancedBufferAttribute(this.coul, 4).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.InstancedBufferAttribute(this.rot, 2).setUsage(THREE.DynamicDrawUsage);
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
attribute vec4 aPos; attribute vec4 aCoul; attribute vec2 aRot;
varying vec2 vUv; varying vec4 vCoul; varying float vBrume;
uniform vec2 uBrumeNF;
void main() {
  // image de la planche (grille ${GRILLE[0]} × ${GRILLE[1]}, la première en haut à gauche)
  float cel = aRot.y;
  vec2 cellule = vec2(mod(cel, ${GRILLE[0]}.0), ${GRILLE[1] - 1}.0 - floor(cel / ${GRILLE[0]}.0));
  vUv = (cellule + uv) / vec2(${GRILLE[0]}.0, ${GRILLE[1]}.0);
  vCoul = aCoul;
  vec4 mv = modelViewMatrix * vec4(aPos.xyz, 1.0);
  float c = cos(aRot.x), s = sin(aRot.x);
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
    this.parDistance = (a, b) => this.tri[b] - this.tri[a]; // créée une fois (pas de déchets à chaque image)
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

  poser(i, p, taille, rot, c, alpha, cam, cellule = CELLULE.lueur) {
    if (i >= this.max) return;
    this.pos[i * 4] = p.x; this.pos[i * 4 + 1] = p.y; this.pos[i * 4 + 2] = p.z; this.pos[i * 4 + 3] = taille;
    this.coul[i * 4] = c.r; this.coul[i * 4 + 1] = c.g; this.coul[i * 4 + 2] = c.b; this.coul[i * 4 + 3] = alpha;
    this.rot[i * 2] = rot; this.rot[i * 2 + 1] = cellule;
    this.tri[i] = (p.x - cam.x) ** 2 + (p.y - cam.y) ** 2 + (p.z - cam.z) ** 2;
  }

  finir(n, trier) {
    n = Math.min(n, this.max);
    if (trier && n > 1) {
      // du plus loin au plus près (transparence correcte) ; tableaux réutilisés (pas de déchets à chaque image)
      if (!this.ordre) {
        this.ordre = [];
        this.copie = { p: new Float32Array(this.max * 4), c: new Float32Array(this.max * 4), r: new Float32Array(this.max * 2) };
      }
      const ordre = this.ordre, { p, c, r } = this.copie;
      ordre.length = n;
      for (let i = 0; i < n; i++) ordre[i] = i;
      ordre.sort(this.parDistance);
      p.set(this.pos.subarray(0, n * 4)); c.set(this.coul.subarray(0, n * 4)); r.set(this.rot.subarray(0, n * 2));
      for (let i = 0; i < n; i++) {
        const j = ordre[i];
        for (let k = 0; k < 4; k++) { this.pos[i * 4 + k] = p[j * 4 + k]; this.coul[i * 4 + k] = c[j * 4 + k]; }
        this.rot[i * 2] = r[j * 2]; this.rot[i * 2 + 1] = r[j * 2 + 1];
      }
    }
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = this.aCoul.needsUpdate = this.aRot.needsUpdate = true;
  }
}
