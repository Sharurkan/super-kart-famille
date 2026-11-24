import * as THREE from "three";
import { audio } from "./audio.js";
import { Sprites, CELLULE, CELLULES_FUMEE, textureParticules } from "./volcan.js";
import { chargerModelesNature } from "./vegetation.js";

// La météorite du circuit Dinosaures : dès le départ, elle brille dans le ciel derrière le volcan,
// grossit tour après tour, puis au dernier tour (le 3e) elle fonce sur le cratère et explose :
// flash, boule de feu, onde de choc, colonne de cendres, pluie de lave, éruption maximale.
//
// Que des vrais assets libres :
//  - la roche : rocher scanné "rock_07" de Poly Haven (CC0, déjà dans public/nature/realiste.glb),
//    sa photo assombrie, les creux de la photo rougeoient (lave) ;
//  - le feu, la fumée, le flash, l'anneau : planche du Kenney Particle Pack (CC0,
//    public/meteorite/particules.webp, voir volcan.js), teintée et animée ;
//  - les sons : Kenney Sci-Fi Sounds (CC0, public/meteorite/*.ogg).
//
// Léger pour une tablette : 4 draw calls en plus (roche, feu, fumée, onde au sol), au plus
// 120 + 150 sprites, aucune lumière ajoutée, rien n'est alloué à chaque image.
// Tout se passe autour du sommet du volcan (à plus de 300 m de la route) : rien ne tombe sur la piste.

const NB_FEU = 120, NB_FUMEE = 150;
const DUREE_CHUTE = 3.2; // s : la dernière ligne droite de la météorite (elle accélère)
const F_AVANT = 0.6; // part du trajet faite avant le dernier tour
const F_DERNIER = 0.1; // part du trajet faite pendant le dernier tour, avant la chute
const GRAVITE = 22;
const DISTANCES_ARBRES = [10, 20, 32, 45, 60, 80, 105, 135]; // m : où l'on cherche des arbres entre la caméra et le volcan
const BASE = import.meta.env.BASE_URL + "meteorite/";
const SONS = { chute: BASE + "thrusterFire_000.ogg", boum: BASE + "explosionCrunch_004.ogg", sourd: BASE + "lowFrequency_explosion_000.ogg" };

/**
 * volcan : retour de creerVolcan ; piste : la piste (piste.infoCourse est tenue à jour par la course :
 * { tours, tour, progression, etat, temps } ; sans elle, la météorite reste au loin).
 * Renvoie { update(dt, camera), impact(), etat }.
 */
export function creerMeteorite(groupe, volcan, piste) {
  const support = volcan.support; // tout est placé dans le repère du volcan (origine au pied)
  for (const u of Object.values(SONS)) audio.precharger(u);

  // ---------- la roche ----------
  const uniformes = { uChaleur: { value: 0.6 }, uTemps: { value: 0 } };
  const roche = new THREE.Group();
  roche.visible = false;
  support.add(roche);
  chargerModelesNature().then((modeles) => {
    const pieces = modeles.Rocher_07 ?? modeles.Gros_Rocher;
    if (!pieces) return;
    // ramenée à une boule de rayon 1 environ (le scan est un peu plat : on l'arrondit)
    const boite = new THREE.Box3();
    for (const { geometrie } of pieces) { geometrie.computeBoundingBox(); boite.union(geometrie.boundingBox); }
    const taille = boite.getSize(new THREE.Vector3()), centre = boite.getCenter(new THREE.Vector3());
    for (const { geometrie, materiau } of pieces) {
      const g = geometrie.clone().translate(-centre.x, -centre.y, -centre.z).scale(2 / taille.x, 1.7 / taille.y, 2 / taille.z);
      const m = new THREE.Mesh(g, materiauBraise(materiau, uniformes));
      m.frustumCulled = false;
      roche.add(m);
    }
  });

  // ---------- sprites : feu (additif) et fumée ----------
  const feu = new Sprites(NB_FEU, textureParticules(), THREE.AdditiveBlending);
  const fumee = new Sprites(NB_FUMEE, textureParticules(), THREE.NormalBlending);
  feu.mesh.frustumCulled = fumee.mesh.frustumCulled = false; // la météorite part loin du volcan
  feu.mesh.renderOrder = 5; // par-dessus la fumée du volcan
  fumee.mesh.renderOrder = 4;
  support.add(feu.mesh, fumee.mesh);

  // ---------- onde de choc : anneau de la planche, couché à hauteur du cratère ----------
  // (sa propre copie de la planche : même fichier, déjà en cache, mais un cadrage à part)
  const texAnneau = new THREE.TextureLoader().load(BASE + "particules.webp");
  texAnneau.colorSpace = THREE.SRGBColorSpace;
  texAnneau.repeat.set(1 / 4, 1 / 2);
  texAnneau.offset.set((CELLULE.anneau % 4) / 4, 0); // 2e ligne de la planche (en bas)
  const onde = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: texAnneau, color: 0xffb070, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false })
  );
  onde.visible = false;
  onde.frustumCulled = false;
  onde.renderOrder = 5;
  support.add(onde);

  // particules : type 0 traînée, 1 boule de feu, 2 pluie de lave, 3 étincelles de la traînée
  const P_FEU = Array.from({ length: NB_FEU }, () => ({ vivant: false, type: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, vie: 1, t0: 1, t1: 1, rot: 0, dr: 0, posee: -1 }));
  // fumée : type 0 traînée, 1 colonne de cendres
  const P_FUMEE = Array.from({ length: NB_FUMEE }, () => ({ vivant: false, type: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), age: 0, vie: 1, t0: 1, t1: 1, rot: 0, dr: 0, cell: 0 }));
  let iFeu = 0, iFumee = 0;

  const etat = {
    phase: "approche", // approche | chute | apres
    f: 0, // avancée sur le trajet (0 : au loin, 1 : dans le cratère)
    fChute: 0, tChute: 0,
    tImpact: -1, // temps depuis l'impact
    t: 0, tDebutDernier: -1,
    rougeur: 0, tremble: 0,
    emisFeu: 0, emisFumee: 0, emisCendres: 0,
    pret: false,
  };

  // trajet : départ haut dans le ciel, derrière le volcan vu de la piste et un peu de côté
  const depart = new THREE.Vector3(), dir = new THREE.Vector3(), tete = new THREE.Vector3();
  function preparerTrajet() {
    const S = volcan.etat.sommet;
    const ux = support.position.x - piste.centre.x, uz = support.position.z - piste.centre.z;
    const lu = Math.hypot(ux, uz) || 1;
    const u = new THREE.Vector2(ux / lu, uz / lu), w = new THREE.Vector2(-u.y, u.x);
    // les points de la piste (dans le repère du volcan) : la météorite doit rester à moins de
    // ~880 m de chacun (la caméra ne voit pas plus loin que 1000 m) et pas trop haut dans le ciel
    let recul = 420;
    for (let essai = 0; essai < 12; essai++) {
      const hx = S.x + u.x * recul + w.x * recul * 0.45, hz = S.z + u.y * recul + w.y * recul * 0.45;
      let dMin = Infinity, dMax = 0;
      for (let i = 0; i < piste.N; i += 4) {
        const d = Math.hypot(piste.cx[i] - support.position.x - hx, piste.cz[i] - support.position.z - hz);
        dMin = Math.min(dMin, d); dMax = Math.max(dMax, d);
      }
      // au-dessus du sommet, mais pas trop haut dans le ciel vue du point de la piste le plus
      // proche (la caméra regarde un peu vers le bas) : elle reste dans l'écran
      const h = S.y + THREE.MathUtils.clamp(Math.tan(THREE.MathUtils.degToRad(12)) * dMin - S.y, 45, 160);
      depart.set(hx, h, hz);
      if (Math.hypot(dMax, h) < 880) break;
      recul *= 0.88;
    }
    dir.copy(S).sub(depart).normalize();
    etat.pret = true;
  }

  // ---------- émission ----------
  function prendreFeu() { const q = P_FEU[iFeu]; iFeu = (iFeu + 1) % NB_FEU; q.vivant = true; q.age = 0; q.posee = -1; return q; }
  function prendreFumee() { const q = P_FUMEE[iFumee]; iFumee = (iFumee + 1) % NB_FUMEE; q.vivant = true; q.age = 0; return q; }
  const alea = (a) => (Math.random() * 2 - 1) * a;

  function emettreTrainee(r, vitesseTrainee) {
    // (flammes opaques, pas additives : sur le ciel orangé du circuit, elles se voient bien mieux)
    const q = prendreFumee();
    q.type = 3;
    q.p.copy(tete).addScaledVector(dir, -r * 0.3);
    q.p.x += alea(r * 0.4); q.p.y += alea(r * 0.4); q.p.z += alea(r * 0.4);
    q.v.copy(dir).multiplyScalar(-vitesseTrainee);
    q.v.x += alea(4); q.v.y += alea(4); q.v.z += alea(4);
    q.vie = 0.9 + Math.random() * 0.5;
    q.t0 = r * (2.4 + Math.random()); q.t1 = r * 1.2;
    q.rot = Math.random() * 6.283; q.dr = alea(2);
    q.cell = CELLULES_FUMEE[Math.floor(Math.random() * 3)]; // l'image de fumée qu'elle devient
  }
  function emettreFumeeTrainee(r, vitesseTrainee) {
    const q = prendreFumee();
    q.type = 0;
    q.p.copy(tete).addScaledVector(dir, -r * 2);
    q.p.x += alea(r * 0.5); q.p.y += alea(r * 0.5); q.p.z += alea(r * 0.5);
    q.v.copy(dir).multiplyScalar(-vitesseTrainee * 0.55);
    q.v.y += 2;
    q.vie = 3 + Math.random() * 1.5;
    q.t0 = r * 1.8; q.t1 = r * (5 + Math.random() * 2);
    q.rot = Math.random() * 6.283; q.dr = alea(0.4);
    q.cell = CELLULES_FUMEE[Math.floor(Math.random() * 3)];
  }
  function emettreCendres(force) {
    const S = volcan.etat.sommet, q = prendreFumee();
    q.type = 1;
    q.p.set(S.x + alea(12), S.y + Math.random() * 10, S.z + alea(12));
    q.v.set(alea(5), 28 + Math.random() * 18 * force, alea(5));
    q.vie = 9 + Math.random() * 4;
    q.t0 = 35 + Math.random() * 15; q.t1 = q.t0 * (3.2 + Math.random());
    q.rot = Math.random() * 6.283; q.dr = alea(0.15);
    q.cell = CELLULES_FUMEE[Math.floor(Math.random() * 3)];
  }

  // ---------- l'impact ----------
  function impact() {
    if (etat.phase === "apres" || !volcan.pret) return;
    etat.phase = "apres";
    etat.tImpact = 0;
    etat.f = 1;
    roche.visible = false;
    const S = volcan.etat.sommet;
    // boule de feu : grosses flammes qui gonflent et montent
    for (let k = 0; k < 20; k++) {
      const q = prendreFeu();
      q.type = 1;
      q.p.set(S.x + alea(10), S.y + Math.random() * 8, S.z + alea(10));
      const a = Math.random() * 6.283, e = Math.random() * 1.2 + 0.2, v = 18 + Math.random() * 30;
      q.v.set(Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v + 8, Math.sin(a) * Math.cos(e) * v);
      q.vie = 1.8 + Math.random() * 1.6;
      q.t0 = 30 + Math.random() * 25; q.t1 = q.t0 * (2.2 + Math.random());
      q.rot = Math.random() * 6.283; q.dr = alea(1.2);
    }
    // pluie de lave : retombe sur les flancs (vitesse horizontale limitée : < ~170 m de l'axe)
    for (let k = 0; k < 60; k++) {
      const q = prendreFeu();
      q.type = 2;
      q.p.set(S.x + alea(8), S.y + 2, S.z + alea(8));
      const a = Math.random() * 6.283, vh = 8 + Math.random() * 16;
      q.v.set(Math.cos(a) * vh, 32 + Math.random() * 34, Math.sin(a) * vh);
      q.vie = 12;
      q.t0 = q.t1 = 7 + Math.random() * 6;
      q.rot = 0; q.dr = 0;
    }
    // la même boule de feu en flammes opaques (bien lisible sur le ciel orangé), qui finit en fumée
    for (let k = 0; k < 18; k++) {
      const q = prendreFumee();
      q.type = 2;
      q.p.set(S.x + alea(12), S.y + Math.random() * 10, S.z + alea(12));
      const a = Math.random() * 6.283, e = Math.random() * 1.1 + 0.3, v = 14 + Math.random() * 24;
      q.v.set(Math.cos(a) * Math.cos(e) * v, Math.sin(e) * v + 6, Math.sin(a) * Math.cos(e) * v);
      q.vie = 3 + Math.random() * 2;
      q.t0 = 35 + Math.random() * 20; q.t1 = q.t0 * (2.4 + Math.random());
      q.rot = Math.random() * 6.283; q.dr = alea(0.8);
      q.cell = CELLULES_FUMEE[Math.floor(Math.random() * 3)];
    }
    for (let k = 0; k < 14; k++) emettreCendres(1.3);
    volcan.eruption(1.5, false); // éruption maximale et longue (le son vient de la météorite)
    volcan.renforcer(1); // puis le volcan reste en colère jusqu'à la fin de la course
    etat.tremble = 1;
    // son : un grand boum (plus fort si on est près), le sourd par-dessous, puis le volcan gronde
    const d = camPos ? Math.hypot(camPos.x - support.position.x, camPos.z - support.position.z) : 600;
    const fort = THREE.MathUtils.clamp(1.25 - d / 1100, 0.55, 1);
    const ok = audio.jouer(SONS.boum, 1.1 * fort, 0.7);
    audio.jouer(SONS.sourd, 1.2 * fort, 0.6);
    if (!ok) audio.choc?.(); // fichier pas encore décodé : au moins un choc
    audio.grondement?.(fort);
  }

  // ---------- état de la course ----------
  function avanceeVoulue(info) {
    const T = Math.max(1, Math.min(3, info.tours ?? 3)); // le 3e tour, ou le dernier si la course est plus courte
    const tour = info.tour ?? 0;
    if (tour >= T) {
      if (etat.tDebutDernier < 0) etat.tDebutDernier = etat.t;
      return { T, f: F_AVANT + F_DERNIER * Math.min(1, (etat.t - etat.tDebutDernier) / 20) };
    }
    const prog = THREE.MathUtils.clamp(((info.progression ?? 0) - 1) / Math.max(1, T - 1), 0, 1);
    return { T, f: T > 1 ? F_AVANT * prog : 0 };
  }

  // la chute commence quand on voit le volcan (2,5 s au moins après le début du dernier tour),
  // ou au plus tard 20 s après, ou tout de suite si la course est finie
  const ndc = new THREE.Vector3(), sommetMonde = new THREE.Vector3();
  let derniereVue = -1, vueEnCache = false;
  function volcanVisible(camera) {
    if (etat.t - derniereVue < 0.2) return vueEnCache; // 5 fois par seconde suffit
    derniereVue = etat.t;
    return (vueEnCache = calculerVue(camera));
  }
  function calculerVue(camera) {
    if (!dome?.visible) return false; // dans le ventre du T-rex : on ne voit pas le ciel
    sommetMonde.copy(volcan.etat.sommet).add(support.position);
    ndc.copy(sommetMonde).project(camera);
    if (ndc.z > 1 || Math.abs(ndc.x) > 0.7 || ndc.y < -0.6 || ndc.y > 0.75) return false;
    ndc.copy(tete).add(support.position).project(camera);
    if (ndc.z > 1 || Math.abs(ndc.x) > 0.9 || ndc.y > 0.95) return false;
    // les arbres de la forêt dense (jusqu'à ~25 m) ne cachent-ils pas le sommet ?
    if (!piste.dansJungle) return true;
    const cp = camera.position, dx = sommetMonde.x - cp.x, dz = sommetMonde.z - cp.z, dh = Math.hypot(dx, dz);
    const pente = (sommetMonde.y - cp.y) / dh;
    for (const d of DISTANCES_ARBRES) {
      if (cp.y + d * pente > 24) break; // plus haut que les arbres : la vue est dégagée
      if (piste.dansJungle(cp.x + (dx / dh) * d, cp.z + (dz / dh) * d)) return false;
    }
    return true;
  }

  // visibilité du volcan le long du tour : 0 inconnue, 1 toujours vu, 2 caché au moins une fois
  const NB_CASES = 200;
  const cases = new Uint8Array(NB_CASES);
  const tCase = new Float32Array(NB_CASES).fill(-1), tCasePrec = new Float32Array(NB_CASES).fill(-1);
  let tourVu = -1, tDebutTour = 0;

  // ---------- ciel, brume, lumière : rougissent (le dôme du ciel est le premier enfant du décor) ----------
  const dome = groupe.children.find((o) => o.isMesh && o.material?.side === THREE.BackSide && o.geometry?.parameters?.radius >= 500);
  let scene = null, hemi = null;
  const brumeOrig = new THREE.Color(), hemiOrig = new THREE.Color();
  let hemiIntOrig = 1;
  const BLANC = new THREE.Color(1, 1, 1), CIEL_ROUGE = new THREE.Color(0.95, 0.42, 0.3), BRUME_ROUGE = new THREE.Color(0.78, 0.46, 0.36), HEMI_ROUGE = new THREE.Color(1, 0.62, 0.45);
  function trouverScene() {
    let s = support;
    while (s.parent) s = s.parent;
    if (!s.isScene) return;
    scene = s;
    hemi = s.children.find((o) => o.isHemisphereLight) ?? null;
    if (s.fog) brumeOrig.copy(s.fog.color);
    if (hemi) { hemiOrig.copy(hemi.color); hemiIntOrig = hemi.intensity; }
    feu.lierBrouillard(support);
    fumee.lierBrouillard(support);
  }
  function teinter(flash) {
    const r = etat.rougeur;
    if (dome) dome.material.color.copy(BLANC).lerp(CIEL_ROUGE, r);
    // (le ventre du T-rex et l'aquarium changent la brume et la lumière après nous : ils gardent la main)
    if (scene?.fog) scene.fog.color.copy(brumeOrig).lerp(BRUME_ROUGE, r * 0.55);
    if (hemi) {
      hemi.color.copy(hemiOrig).lerp(HEMI_ROUGE, r * 0.5);
      hemi.intensity = hemiIntOrig * (1 - r * 0.12 + flash * 0.35);
    }
  }

  // ---------- mise à jour ----------
  const camLocale = new THREE.Vector3(), tmp = new THREE.Vector3();
  const c = new THREE.Color(), blanc = new THREE.Color(1, 0.97, 0.85), jaune = new THREE.Color(1, 0.78, 0.3), orange = new THREE.Color(1, 0.4, 0.08), rouge = new THREE.Color(0.5, 0.06, 0.02), gris = new THREE.Color(0.22, 0.2, 0.19);
  function couleurFeu(u, cible) {
    if (u < 0.25) cible.copy(blanc).lerp(jaune, u / 0.25);
    else if (u < 0.6) cible.copy(jaune).lerp(orange, (u - 0.25) / 0.35);
    else cible.copy(orange).lerp(rouge, (u - 0.6) / 0.4);
    return cible;
  }
  let camPos = null, sonsPrets = false;

  function update(dt, camera) {
    etat.t += dt;
    uniformes.uTemps.value = etat.t;
    if (!volcan.pret) return;
    if (!etat.pret) preparerTrajet();
    if (!scene) trouverScene();
    if (!sonsPrets && audio.ctx) { sonsPrets = true; for (const u of Object.values(SONS)) audio.precharger(u); } // décodés bien avant l'impact
    camPos = camera.position;
    camLocale.copy(camera.position).sub(support.position);
    const S = volcan.etat.sommet;
    const info = piste.infoCourse;

    // --- avancée de la météorite ---
    if (etat.phase === "approche") {
      if (info) {
        const { f } = avanceeVoulue(info);
        etat.f = Math.max(etat.f, etat.f + (f - etat.f) * Math.min(1, dt * 1.5)); // jamais en arrière
        const fini = info.etat === "arrivee" || info.etat === "podium";
        const dans = etat.tDebutDernier < 0 ? -1 : etat.t - etat.tDebutDernier;
        // carte de visibilité apprise aux tours précédents : la chute part d'un endroit d'où l'on
        // voit le volcan pendant toute la chute (sinon au plus tard 35 s après le début du tour)
        const humain = piste.humains?.[0];
        const frac = (((info.progression ?? 0) % 1) + 1) % 1;
        const b = Math.floor(frac * NB_CASES) % NB_CASES;
        const vu = info.etat === "course" && !humain?.scenario && volcanVisible(camera);
        if (info.etat === "course") cases[b] = humain?.scenario ? 2 : cases[b] === 2 ? 2 : vu ? 1 : 2;
        // temps de passage dans chaque case (depuis le début du tour), gardés du tour précédent
        if (info.tour !== tourVu) {
          if (tourVu >= 1) tCasePrec.set(tCase);
          tCase.fill(-1);
          tourVu = info.tour;
          tDebutTour = etat.t;
        }
        if (tCase[b] < 0) tCase[b] = etat.t - tDebutTour;
        // on lance la chute pour que l'impact tombe là où, au tour précédent, on voyait bien le
        // volcan, et encore 1,5 s après (le flash et la boule de feu) ; les temps de passage
        // tiennent compte des passages scriptés (looping...) où l'on avance moins vite
        let bonEndroit = false;
        if (dans > 1 && info.etat === "course" && tCasePrec[b] >= 0) {
          let n = 0;
          bonEndroit = true;
          for (let k = 1; k < NB_CASES && bonEndroit; k++) {
            const j = (b + k) % NB_CASES, dtj = tCasePrec[j] - tCasePrec[b];
            if (tCasePrec[j] < 0) continue;
            if (dtj < 0 || dtj > DUREE_CHUTE + 1.5) break;
            if (dtj >= DUREE_CHUTE) { n++; bonEndroit = cases[j] === 1; }
          }
          bonEndroit &&= n >= 2;
        }
        if (fini || dans > 35 || bonEndroit) {
          etat.phase = "chute";
          etat.fChute = etat.f;
          etat.tChute = 0;
          audio.jouer(SONS.chute, 0.9, 0.55); // grondement de la météorite qui fonce
        }
      }
    } else if (etat.phase === "chute") {
      etat.tChute += dt;
      const k = Math.min(1, etat.tChute / DUREE_CHUTE);
      etat.f = etat.fChute + (1 - etat.fChute) * k * k * k; // elle accélère
      if (k >= 1) impact();
    }

    // position et taille de la roche
    const f = etat.f;
    tete.copy(depart).lerp(S, f);
    const rayon = 13 + 13 * Math.pow(f, 0.8); // m (elle « grossit » en plus de se rapprocher)
    if (etat.phase !== "apres") {
      roche.visible = roche.children.length > 0;
      roche.position.copy(tete);
      roche.scale.setScalar(rayon);
      roche.rotation.x += dt * 0.25; roche.rotation.y += dt * 0.4;
      uniformes.uChaleur.value = 0.5 + f * 0.9 + (etat.phase === "chute" ? 0.6 : 0);
      // traînée : flammes et fumée soufflées vers l'arrière (plus longue quand elle fonce)
      const vt = 30 + f * 25 + (etat.phase === "chute" ? 60 : 0);
      etat.emisFeu += dt * (26 + (etat.phase === "chute" ? 30 : 0));
      while (etat.emisFeu >= 1) { etat.emisFeu--; emettreTrainee(rayon, vt); }
      etat.emisFumee += dt * (10 + (etat.phase === "chute" ? 10 : 0));
      while (etat.emisFumee >= 1) { etat.emisFumee--; emettreFumeeTrainee(rayon, vt); }
    }

    // --- après l'impact : colonne de cendres pendant ~9 s, onde de choc, tremblement ---
    let flash = 0;
    if (etat.phase === "apres") {
      etat.tImpact += dt;
      const ti = etat.tImpact;
      if (ti < 9) {
        etat.emisCendres += dt * (ti < 2 ? 10 : 6);
        while (etat.emisCendres >= 1) { etat.emisCendres--; emettreCendres(1.2 - ti / 9); }
      }
      flash = ti < 0.15 ? ti / 0.15 : Math.max(0, 1 - (ti - 0.15) / 1.4);
      // onde de choc couchée : s'étend jusqu'à ~480 m en 3,5 s (passe au-dessus de la route, sans rien toucher)
      const k = ti / 3.5;
      onde.visible = k < 1;
      if (onde.visible) {
        const R = 30 + 450 * (1 - Math.pow(1 - k, 2.2));
        onde.position.set(S.x, S.y - 12, S.z);
        onde.scale.set(R * 2, 1, R * 2);
        onde.material.opacity = Math.pow(1 - k, 1.4);
      }
    }

    // --- ciel : rougit un peu au 2e tour, davantage pendant la chute, très fort à l'impact puis revient ---
    let cible = 0;
    if (info) {
      const T = Math.max(1, Math.min(3, info.tours ?? 3));
      if (etat.phase === "approche") cible = T > 1 ? 0.3 * THREE.MathUtils.clamp(((info.progression ?? 0) - 1) / (T - 1), 0, 1) + (etat.tDebutDernier >= 0 ? 0.08 : 0) : 0;
      else if (etat.phase === "chute") cible = 0.4 + 0.3 * (etat.tChute / DUREE_CHUTE);
      else cible = 0.25 + 0.75 * Math.exp(-Math.max(0, etat.tImpact - 2.5) / 9);
    }
    etat.rougeur += (cible - etat.rougeur) * Math.min(1, dt * (etat.phase === "apres" && etat.tImpact < 1 ? 5 : 0.8));
    teinter(flash);

    // --- tremblement de la caméra du joueur (court et doux) ---
    if (etat.tremble > 0) {
      etat.tremble = Math.max(0, etat.tremble - dt / 1.6);
      const d = Math.hypot(camLocale.x, camLocale.z);
      const a = 0.16 * etat.tremble * etat.tremble * THREE.MathUtils.clamp(1.4 - d / 900, 0.4, 1);
      const t = etat.t;
      camera.position.x += Math.sin(t * 37) * a;
      camera.position.y += Math.sin(t * 43 + 1) * a * 0.6;
      camera.position.z += Math.sin(t * 31 + 2) * a;
    }

    // --- feu ---
    let n = 0;
    for (const q of P_FEU) {
      if (!q.vivant) continue;
      q.age += dt;
      if (q.type === 2) {
        // pluie de lave : vol, puis quelques secondes posée sur le flanc où elle refroidit
        if (q.posee < 0) {
          q.v.y -= GRAVITE * dt;
          q.p.addScaledVector(q.v, dt);
          const r = Math.hypot(q.p.x - S.x, q.p.z - S.z), sol = volcan.etat.profil(r) + 1.5;
          if (q.v.y < 0 && (q.p.y < sol || r > 170)) { q.posee = 0; q.p.y = sol; }
        } else {
          q.posee += dt;
          if (q.posee > 3) { q.vivant = false; continue; }
        }
        const froid = q.posee < 0 ? Math.min(0.5, q.age / 6) : 0.5 + q.posee / 6;
        feu.poser(n++, q.p, q.t0 * (1 - froid * 0.4), 0, couleurFeu(0.3 + froid * 0.7, c), 1 - Math.max(0, froid - 0.7) * 2, camLocale, CELLULE.lueur);
        continue;
      }
      const u = q.age / q.vie;
      if (u >= 1) { q.vivant = false; continue; }
      if (q.type === 1) { q.v.multiplyScalar(Math.exp(-dt * 1.6)); q.v.y += 5 * dt; } // la boule de feu ralentit et monte
      q.p.addScaledVector(q.v, dt);
      q.rot += q.dr * dt;
      const s = q.t0 + (q.t1 - q.t0) * Math.sqrt(u);
      const alpha = Math.min(1, u * 8) * Math.pow(1 - u, q.type === 1 ? 1.1 : 1.6);
      // petite animation : les deux images de flammes alternent
      const cel = Math.floor(q.age * 9 + q.rot) % 2 ? CELLULE.feu1 : CELLULE.feu2;
      feu.poser(n++, q.p, s, q.rot, couleurFeu(u, c), alpha, camLocale, cel);
    }
    if (etat.phase !== "apres" && roche.visible) {
      // halo autour de la roche (elle brûle en entrant dans l'atmosphère)
      feu.poser(n++, tete, rayon * 5.5, 0, c.setRGB(1, 0.42, 0.12), 0.85, camLocale, CELLULE.lueur);
      feu.poser(n++, tete, rayon * 3, etat.t * 0.7, c.setRGB(1, 0.85, 0.55), 0.55, camLocale, CELLULE.eclair);
    }
    if (flash > 0) {
      // flash : éclat en étoile + halo, limités en taille à l'écran (jamais tout blanc)
      const d = Math.hypot(camLocale.x - S.x, camLocale.y - S.y, camLocale.z - S.z);
      const taille = Math.min(320, d * 0.75);
      tmp.set(S.x, S.y + 20, S.z);
      feu.poser(n++, tmp, taille * (0.5 + 0.5 * flash), etat.tImpact * 0.4, c.setRGB(1, 0.95, 0.8), 0.95 * flash, camLocale, CELLULE.eclair);
      feu.poser(n++, tmp, taille * 0.9, 0, c.setRGB(1, 0.6, 0.25), 0.8 * flash, camLocale, CELLULE.lueur);
      // bulle de l'onde de choc vue de face
      const k = etat.tImpact / 2.2;
      if (k < 1) feu.poser(n++, tmp, Math.min(d * 1.2, 60 + 520 * Math.sqrt(k)), 0, c.setRGB(1, 0.7, 0.4), 0.6 * (1 - k), camLocale, CELLULE.anneau);
    }
    if (etat.phase === "apres" && etat.tImpact < 20) {
      // lueur rouge sur le cratère qui s'éteint doucement
      tmp.set(S.x, S.y + 15, S.z);
      feu.poser(n++, tmp, 150, 0, c.setRGB(1, 0.35, 0.08), 0.7 * Math.max(0, 1 - etat.tImpact / 20), camLocale, CELLULE.lueur);
    }
    feu.finir(n, false);

    // --- fumée ---
    n = 0;
    for (const q of P_FUMEE) {
      if (!q.vivant) continue;
      q.age += dt;
      const u = q.age / q.vie;
      if (u >= 1) { q.vivant = false; continue; }
      if (q.type === 1) q.v.y *= Math.exp(-dt * 0.18);
      else if (q.type === 2) { q.v.multiplyScalar(Math.exp(-dt * 1.4)); q.v.y += 4 * dt; } // boule de feu : ralentit et monte
      else q.v.multiplyScalar(Math.exp(-dt * 0.6));
      q.p.addScaledVector(q.v, dt);
      q.rot += q.dr * dt;
      const s = q.t0 + (q.t1 - q.t0) * Math.sqrt(u);
      if (q.type >= 2) {
        // flammes : blanc-jaune, orange, rouge, puis fumée sombre ; deux images qui alternent
        const feuU = q.type === 3 ? u : Math.min(1, u * 1.6);
        if (feuU < 0.75) couleurFeu(feuU / 0.75, c);
        else c.copy(rouge).lerp(gris, (feuU - 0.75) / 0.25);
        const alpha = Math.min(1, u * 10) * Math.pow(1 - u, q.type === 3 ? 1.4 : 1.1);
        const cel = feuU > 0.8 ? q.cell : Math.floor(q.age * 9 + q.rot) % 2 ? CELLULE.feu1 : CELLULE.feu2;
        fumee.poser(n++, q.p, s, q.rot, c, alpha, camLocale, cel);
        continue;
      }
      const alpha = Math.min(1, u * 5) * Math.pow(1 - u, 1.3) * (q.type === 1 ? 0.95 : 0.8);
      // cendres très sombres, éclairées par le feu en bas de la colonne
      const g = q.type === 1 ? 0.28 + 0.2 * u : 0.35 + 0.25 * u;
      const chaud = q.type === 1 ? Math.max(0, 1 - u * 5) : Math.max(0, 1 - u * 4) * 0.6;
      c.setRGB(g + (1 - g) * chaud, g + (0.45 - g) * chaud, g + (0.15 - g) * chaud);
      fumee.poser(n++, q.p, s, q.rot, c, alpha, camLocale, q.cell);
    }
    fumee.finir(n, true);
  }

  return {
    get etat() { return etat; },
    get cases() { return cases; }, // carte de visibilité (tests)
    update(dt, camera) { if (camera) update(dt, camera); },
    /** Fait tomber la météorite tout de suite (tests). */
    chute() { if (etat.phase === "approche") { etat.phase = "chute"; etat.fChute = etat.f; etat.tChute = 0; } },
    impact,
  };
}

// La roche : la photo du rocher scanné, assombrie (brûlée) ; les creux de la photo rougeoient
// comme de la lave et le bord s'allume (chaleur de l'entrée dans l'atmosphère).
function materiauBraise(ancien, uniformes) {
  const m = new THREE.MeshLambertMaterial({ map: ancien.map, normalMap: ancien.normalMap, color: 0x6b5a50, fog: false });
  if (ancien.normalMap) m.normalScale.copy(ancien.normalScale ?? new THREE.Vector2(1, 1)).multiplyScalar(1.5);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniformes);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uChaleur, uTemps;\nfloat lumPhoto = 0.5;")
      .replace("#include <map_fragment>", "#include <map_fragment>\n#ifdef USE_MAP\nlumPhoto = dot(sampledDiffuseColor.rgb, vec3(0.3, 0.55, 0.15));\n#endif")
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
// les creux sombres de la photo : fissures de lave qui palpitent
float fissure = smoothstep(0.42, 0.18, lumPhoto) * (0.75 + 0.25 * sin(uTemps * 3.0 + lumPhoto * 40.0));
vec3 laveC = mix(vec3(1.0, 0.28, 0.03), vec3(1.0, 0.75, 0.3), fissure);
totalEmissiveRadiance += laveC * fissure * (0.6 + uChaleur);
// bord incandescent
float bord = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.5);
totalEmissiveRadiance += vec3(1.0, 0.45, 0.1) * bord * (0.4 + uChaleur);`);
  };
  m.customProgramCacheKey = () => "meteorite-braise";
  return m;
}
