import * as THREE from "three";
import { audio } from "./audio.js";

// Le grand T-rex debout au bord de la route « fait semblant » d'attraper le joueur.
// Quand un kart joueur arrive (piste.humains), il se tourne vers lui et se penche ; au moment où le
// kart passe à sa hauteur (instant prédit avec la vitesse du kart), il plonge la tête vers la route,
// gueule grande ouverte, et CLAC ! ses mâchoires se referment à côté du kart, bien au-dessus de lui.
// Puis il se redresse, secoue la tête (raté !) et rugit.
//
// Animations : les vrais clips du modèle (« Idle », « Attack » : la gueule s'ouvre en grand de 2,6 à
// 5,1 s, rugissement) mélangés par le mixer, puis, chaque image, des rotations d'os calculées par-dessus
// (comme le cou du brachiosaure, brachio.js) :
//  - lacet ψ et tangage θ répartis sur la colonne (Spine1, Spine2, Neck, Neck1, Neck2) ; la queue se
//    relève quand le buste plonge (contrepoids) ;
//  - (ψ, θ) résolus (Newton, 2 inconnues, repart de la solution précédente) pour que la gueule arrive
//    sur la cible : direction et hauteur ; la distance suit la courbure de la colonne ;
//  - tête : le museau vise le kart ; mâchoire : fermée de force pour le CLAC, puis rouverte (rugissement) ;
//  - sons : cri puis grognement quand il voit arriver le kart, claquement au CLAC, rugissement au raté
//    (enregistrements CC0 de public/sons ; sons synthétisés d'audio.js en secours) ;
//  - sécurité : les points extrêmes de la tête et de la mâchoire (mesurés sur le maillage) restent à
//    plus de ATTAQUE.plancher au-dessus de la route ; sinon le tangage est réduit (dichotomie).
export const ATTAQUE = {
  approche: 85, // m avant le point de frappe : il se tourne vers le kart et se penche un peu
  hauteurBouche: 4.2, // m au-dessus de la route : milieu de la gueule au plus bas de la frappe
  plancher: 2.6, // m : aucun point de la tête ni de la mâchoire plus bas au-dessus de la route
  descenteMin: 0.4, // s : durée du plongeon (selon la vitesse du kart ; rapide : il ne rate jamais le départ)
  descenteMax: 0.7,
  tenue: 0.35, // s : gueule fermée, au plus bas, juste après le CLAC
  remontee: 1.2, // s : il se redresse
  rugit: 2.4, // s après le CLAC : la gueule se referme, retour au repos
  cote: 3.2, // m : la gueule claque à côté du kart (du côté du T-rex)
  avance: 13, // m : ... et devant lui : la gueule claque bien dans le champ de la caméra (derrière le kart)
  pivot: 0.7, // rad : il pivote au plus de tant sur ses pieds vers le kart (le reste : buste et cou)
};

// Sons enregistrés (CC0, voir public/CREDITS.txt et outils/blender/sons_trex.py)
const SONS = {
  rugit: `${import.meta.env.BASE_URL}sons/trex-rugissement.ogg`, // « T-rex calls » (CaveboyTup)
  grogne: `${import.meta.env.BASE_URL}sons/trex-grognement.ogg`, // idem
  cri: `${import.meta.env.BASE_URL}sons/trex-cri.ogg`, // long cri perçant (voir CREDITS)
  clac: `${import.meta.env.BASE_URL}sons/trex-clac.ogg`, // « 80 CC0 creature SFX #2 » (rubberduck)
};
let sonsPrets = false;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lisse = (x) => { const u = clamp(x, 0, 1); return u * u * (3 - 2 * u); };
const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * objet : le T-rex de creerDino (déjà placé et ajouté à la scène), mixer et clips de ce modèle ;
 * cote : +1 / -1, côté de la route où il se tient ; iFrappe : échantillon de la route où il mord.
 * Renvoie { update(dt) } à appeler APRÈS mixer.update(dt) (les os sont tournés par-dessus le clip).
 */
export function attaqueTrex({ objet, mixer, clips, piste, cote, iFrappe }) {
  const A = ATTAQUE;
  const { N, pas } = piste;
  for (const u of Object.values(SONS)) audio.precharger?.(u); // fichiers téléchargés tout de suite
  const yRoute = piste.hauteurTremplin?.(iFrappe, 0, 0)?.h ?? 0; // hauteur de la route au point de frappe
  const modele = objet.children[0];
  const clip = (n) => clips.find((c) => c.name === n);
  const repos = mixer.clipAction(clip("Idle"), modele);
  const cri = clip("Attack") ? mixer.clipAction(clip("Attack"), modele) : null;
  if (cri) {
    cri.setLoop(THREE.LoopOnce, 1);
    cri.clampWhenFinished = true;
  }

  // --- os (noms du glTF sans les points, comme les nettoie GLTFLoader) ---
  const tousOs = [];
  modele.traverse((o) => { if (o.isBone) tousOs.push(o); });
  const os = (nom) => tousOs.find((o) => o.name === nom.replace(/\./g, ""));
  const bassin = os("bn_Spine.4_4");
  const chaine = ["bn_Spine1.5_5", "bn_Spine2.6_6", "bn_Neck.7_7", "bn_Neck1.8_8", "bn_Neck2.9_9"].map(os);
  const tete = os("bn_Head.10_10"), machoire = os("bn_Jaw.11_11");
  const queue = ["bn_Tail01.67_67", "bn_Tail02.68_68", "bn_Tail03.69_69"].map(os);
  if (!bassin || chaine.some((o) => !o) || !tete || !machoire) {
    console.warn("T-rex : os introuvables, pas d'attaque");
    return { update() {} };
  }
  const cuisses = ["bn_LeftUpLeg.45_45", "bn_RightUpLeg.56_56"].map(os).filter(Boolean);
  const KY = [0.12, 0.18, 0.24, 0.22, 0.24]; // part du lacet par os
  const KB = 0.5; // part du tangage du buste θ prise aux hanches (bassin ; les cuisses ne bougent pas)
  const KP = [0.3, 0.2, 0, 0, 0]; // part du tangage du buste θ (Spine1, Spine2)
  const KC = [0, 0, 0.4, 0.33, 0.27]; // part de la courbure du cou κ (Neck, Neck1, Neck2)
  const touches = [bassin, ...cuisses, ...chaine, tete, machoire, ...queue];
  const base = new Map(touches.map((o) => [o, new THREE.Quaternion()]));

  // --- repère du T-rex (racine : mètres, +Y en haut, il regarde vers +Z) ---
  const invF = new THREE.Matrix4(), m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion(), qp = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const v = new THREE.Vector3(), sc = new THREE.Vector3(), HAUT = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
  const quatF = (o, cible) => { m4.multiplyMatrices(invF, o.matrixWorld).decompose(v, cible, sc); return cible; };
  const posF = (o, cible) => cible.setFromMatrixPosition(o.matrixWorld).applyMatrix4(invF);
  /** Tourne l'os d'une rotation r exprimée dans le repère du T-rex, puis met à jour ses enfants. */
  function tourner(o, r) {
    quatF(o.parent, qp);
    q.copy(qp).invert().multiply(r).multiply(qp);
    o.quaternion.premultiply(q);
    o.updateMatrixWorld(true);
  }

  // --- points extrêmes de la tête et de la mâchoire (dans le repère de leur os), mesurés une fois ---
  mixer.update(0);
  objet.updateMatrixWorld(true);
  const sousArbre = (racine, sauf) => { const s = new Set(); racine.traverse((o) => { if (o.isBone && !sauf?.has(o)) s.add(o); }); return s; };
  const grpJ = sousArbre(machoire), grpH = sousArbre(tete, grpJ);
  const ptsH = [], ptsJ = [];
  modele.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    m.skeleton.update();
    const { skinIndex: si, skinWeight: sw, position } = m.geometry.attributes;
    const invH = tete.matrixWorld.clone().invert(), invJ = machoire.matrixWorld.clone().invert();
    for (let i = 0; i < position.count; i++) {
      let k = 0;
      for (let c = 1; c < 4; c++) if (sw.getComponent(i, c) > sw.getComponent(i, k)) k = c;
      const b = m.skeleton.bones[si.getComponent(i, k)];
      const enH = grpH.has(b), enJ = grpJ.has(b);
      if (!enH && !enJ) continue;
      const p = m.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(m.matrixWorld).applyMatrix4(enH ? invH : invJ);
      (enH ? ptsH : ptsJ).push(p);
    }
  });
  /** Garde seulement les sommets extrêmes (26 directions) et le plus éloigné de l'os (bout du museau). */
  function extremes(pts) {
    if (!pts.length) return { pts: [new THREE.Vector3()], bout: new THREE.Vector3() };
    const garde = new Set();
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      if (!a && !b && !c) continue;
      let mieux = pts[0], max = -Infinity;
      for (const p of pts) { const s = p.x * a + p.y * b + p.z * c; if (s > max) { max = s; mieux = p; } }
      garde.add(mieux);
    }
    const bout = pts.reduce((m, p) => (p.lengthSq() > m.lengthSq() ? p : m), pts[0]);
    garde.add(bout);
    return { pts: [...garde], bout };
  }
  const EH = extremes(ptsH), EJ = extremes(ptsJ);
  const pw = new THREE.Vector3(), pw2 = new THREE.Vector3();
  /** Milieu de la gueule (bout du museau, bout de la mâchoire), dans le repère du T-rex. */
  const bouche = (cible) => {
    pw.copy(EH.bout).applyMatrix4(tete.matrixWorld);
    pw2.copy(EJ.bout).applyMatrix4(machoire.matrixWorld);
    return cible.copy(pw).add(pw2).multiplyScalar(0.5).applyMatrix4(invF);
  };
  /** Point le plus bas de la tête et de la mâchoire (hauteur dans le monde). */
  const plusBas = () => {
    let y = Infinity;
    for (const p of EH.pts) y = Math.min(y, pw.copy(p).applyMatrix4(tete.matrixWorld).y);
    for (const p of EJ.pts) y = Math.min(y, pw.copy(p).applyMatrix4(machoire.matrixWorld).y);
    return y;
  };
  const qMachoireRepos = machoire.quaternion.clone(); // « Idle » : gueule fermée
  // PIÈGE (la mâchoire « partait en vrille ») : le mixer de three.js n'écrit un os que si la valeur du
  // clip a CHANGÉ depuis l'image précédente (PropertyMixer.apply). Or dans « Idle » la mâchoire, Spine1,
  // etc. ont une piste constante, et le bassin (bn_Spine) n'en a pas du tout : le mixer ne les
  // réécrivait jamais et nos rotations s'ajoutaient d'image en image (mâchoire jusqu'à 180°).
  // Correction : avant chaque mixer.update, chaque os modifié retrouve la valeur du clip mémorisée
  // juste avant nos rotations (base) ; le mixer écrit par-dessus si le clip a bougé.
  const repos0 = new Map(touches.map((o) => [o, o.quaternion.clone()])); // (mesures en dev)
  let modifie = false; // des os ont été tournés à cette image
  /** À appeler juste AVANT mixer.update(dt). */
  function remettre() {
    if (!modifie) return;
    for (const o of touches) o.quaternion.copy(base.get(o));
    modifie = false;
  }

  // --- pose : base (clips) + lacet / tangage + tête + mâchoire ---
  const opts = { regard: null, wTete: 0, ouvre: 0, ferme: 0, secoue: 0 };
  const axe = new THREE.Vector3(), dCur = new THREE.Vector3(), dVoulu = new THREE.Vector3(), pT = new THREE.Vector3(), pS = new THREE.Vector3();
  function restaurer() {
    for (const o of touches) o.quaternion.copy(base.get(o));
    bassin.updateMatrixWorld(true);
  }
  const qInv = new THREE.Quaternion();
  function poser(psi, theta, kappa) {
    restaurer();
    // il se penche depuis les hanches (la queue se relève : bascule naturelle) ; les cuisses gardent
    // leur orientation, les pieds restent au sol
    if (theta) {
      qInv.setFromAxisAngle(X, theta * KB);
      tourner(bassin, qInv);
      qInv.invert();
      for (const c of cuisses) tourner(c, qInv);
    }
    let cumul = 0;
    for (let k = 0; k < chaine.length; k++) {
      const dy = psi * KY[k];
      cumul += dy;
      axe.set(Math.cos(cumul), 0, -Math.sin(cumul));
      tourner(chaine[k], qa.setFromAxisAngle(axe, theta * KP[k] + kappa * KC[k]).multiply(qb.setFromAxisAngle(HAUT, dy)));
    }
    // la queue (déjà relevée par le bassin) se courbe un peu vers le bas au bout : elle reste naturelle
    const qt = Math.max(0, theta);
    tourner(queue[1], qa.setFromAxisAngle(X, -qt * 0.15));
    tourner(queue[2], qa.setFromAxisAngle(X, -qt * 0.1));
    // secoue la tête (« raté ! »)
    if (opts.secoue) {
      tourner(chaine[4], qa.setFromAxisAngle(HAUT, opts.secoue * 0.5));
      tourner(tete, qa.setFromAxisAngle(HAUT, opts.secoue * 0.6));
    }
    // le museau vise le kart (au plus 0,6 rad de correction)
    if (opts.regard && opts.wTete > 0.001) {
      posF(tete, pT);
      pS.copy(EH.bout).applyMatrix4(tete.matrixWorld).applyMatrix4(invF);
      dCur.copy(pS).sub(pT).normalize();
      dVoulu.copy(opts.regard).sub(pT).normalize();
      const a = Math.min(dCur.angleTo(dVoulu), 0.6) * opts.wTete;
      if (a > 1e-4) {
        axe.crossVectors(dCur, dVoulu).normalize();
        tourner(tete, qa.setFromAxisAngle(axe, a));
      }
    }
    // mâchoire : fermée de force (CLAC), ou ouverte un peu plus que le clip
    if (opts.ferme > 0) {
      machoire.quaternion.slerp(qMachoireRepos, opts.ferme);
      machoire.updateMatrixWorld(true);
    }
    if (opts.ouvre > 0.001) {
      posF(tete, pT);
      pS.copy(EH.bout).applyMatrix4(tete.matrixWorld).applyMatrix4(invF);
      dCur.copy(pS).sub(pT).normalize();
      axe.crossVectors(HAUT, dCur).normalize(); // tourner autour de cet axe abaisse la mâchoire
      tourner(machoire, qa.setFromAxisAngle(axe, opts.ouvre));
    }
  }

  // --- résolution : la gueule sur la cible T (repère du T-rex) ---
  // 3 inconnues (lacet ψ, buste θ, cou κ) pour 3 écarts : direction, hauteur, distance (m)
  const pivot = new THREE.Vector3(), M = new THREE.Vector3(), sol = { psi: 0, theta: 0, kappa: 0 };
  const az = (p) => Math.atan2(p.x - pivot.x, p.z - pivot.z);
  const loin = (p) => Math.hypot(p.x - pivot.x, p.z - pivot.z);
  // poids : la hauteur d'abord (jamais trop bas), puis la direction ; si la cible est hors de portée,
  // la gueule s'arrête un peu avant (côté T-rex), jamais au-delà
  const POIDS = [1, 1.5, 0.6];
  function residu(x, T) {
    poser(x[0], x[1], x[2]);
    bouche(M);
    return [angle(az(M) - az(T)) * loin(T) * POIDS[0], (M.y - T.y) * POIDS[1], (loin(M) - loin(T)) * POIDS[2]];
  }
  const BORNES = [[-1.5, 1.5], [-0.4, 1.1], [-0.9, 1.1]];
  /** Déterminant 3×3 (colonnes a, b, c). */
  const det3 = (a, b, c) => a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
  /** Moindres carrés amortis (Levenberg-Marquardt), 3 inconnues, repart de la solution précédente. */
  function resoudre(T) {
    const x = [sol.psi, sol.theta, sol.kappa], e = 0.01;
    let r = residu(x, T), lambda = 2;
    for (let it = 0; it < 5; it++) {
      const n0 = Math.hypot(...r);
      if (n0 < 0.08) break;
      const J = [0, 1, 2].map((k) => {
        const xe = x.slice();
        xe[k] += e;
        return residu(xe, T).map((v, n) => (v - r[n]) / e);
      }); // J[k] : colonne k (dérivées par rapport à x[k])
      const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const A3 = J.map((a, i) => J.map((b, j) => dot(a, b) + (i === j ? lambda : 0))); // JᵀJ + λI (symétrique)
      const g = J.map((a) => -dot(a, r));
      const D = det3(A3[0], A3[1], A3[2]);
      if (Math.abs(D) < 1e-12) break;
      const dx = [det3(g, A3[1], A3[2]) / D, det3(A3[0], g, A3[2]) / D, det3(A3[0], A3[1], g) / D];
      const xn = x.map((v, k) => clamp(v + clamp(dx[k], -0.4, 0.4), BORNES[k][0], BORNES[k][1]));
      const rn = residu(xn, T);
      if (Math.hypot(...rn) < n0) { x.splice(0, 3, ...xn); r = rn; lambda = Math.max(0.05, lambda * 0.3); }
      else lambda *= 4;
    }
    [sol.psi, sol.theta, sol.kappa] = x;
    return sol;
  }

  // --- le joueur qui arrive : distance (m, le long de la route) jusqu'au point de frappe ---
  function joueur() {
    let mieux = null;
    for (const k of piste.humains ?? []) {
      const p = k.phys;
      if (!p || p.indice < 0) continue;
      let e = (iFrappe - p.indice + N) % N;
      if (e > N / 2) e -= N;
      const d = e * pas;
      if (d < -45 || d > A.approche + 30) continue;
      if (!mieux || Math.abs(d) < Math.abs(mieux.d)) mieux = { d, phys: p };
    }
    return mieux;
  }

  // --- état de l'attaque ---
  const etat = { phase: "repos", tau: 0, duree: 0.7, arme: true, regard: 0, pivot: 0, attaques: 0, clacs: [], dernier: null };
  const angle0 = objet.rotation.y; // orientation de repos (sa place a été vérifiée ainsi)
  const cible = new THREE.Vector3(), regardF = new THREE.Vector3(), Mrepos = new THREE.Vector3();
  let derniereCible = null;
  function jouerCri(depuis) {
    if (!cri) return;
    cri.reset();
    cri.time = depuis;
    cri.play();
    cri.crossFadeFrom(repos, 0.2, false);
  }
  function finirCri() {
    if (!cri) return;
    repos.reset().play();
    repos.crossFadeFrom(cri, 0.6, false);
  }

  function update(dt) {
    const J = joueur();
    const E = etat;
    E.tau += dt;
    let wFrappe = 0, ouvre = 0, ferme = 0, secoue = 0, regardCible = 0;
    if (!J && E.phase === "repos") E.arme = true; // le joueur est loin : prêt pour le prochain tour

    if (!sonsPrets && audio.ctx) { sonsPrets = true; for (const u of Object.values(SONS)) audio.precharger(u); } // décodés dès que le son démarre
    if (E.phase === "repos" && E.arme && J && J.d > 0 && J.d < A.approche) {
      E.phase = "guette";
      E.tau = 0;
      E.grogne = false;
      if (!audio.jouer?.(SONS.cri, 1.0)) audio.grondement?.(0.4); // il pousse un cri en voyant arriver le kart
    }
    if (E.phase === "guette") {
      if (!J || J.d < -5) { E.phase = "repos"; E.arme = false; }
      else {
        regardCible = 1;
        if (!E.grogne && E.tau > 1.2) { E.grogne = true; audio.jouer?.(SONS.grogne, 0.8); } // puis il gronde
        ouvre = 0.12 * lisse(E.tau / 0.8); // babines entrouvertes : il attend
        const v = Math.max(J.phys.vitesse ?? 0, 3);
        const tImp = (J.d - A.avance) / v;
        // il plonge juste à temps pour que la gueule claque quand le kart passe
        if (tImp <= A.descenteMax) {
          E.phase = "frappe";
          E.tau = 0;
          E.duree = clamp(tImp, A.descenteMin, A.descenteMax);
          E.attaques++;
          jouerCri(3.0 - E.duree); // le clip a la gueule grande ouverte à 3,0 s
        }
      }
    }
    if (E.phase === "frappe") {
      const u = E.tau / E.duree;
      // un petit recul (il prend son élan), puis le plongeon
      wFrappe = u < 0.15 ? -0.1 * lisse(u / 0.15) : -0.1 + 1.1 * lisse((u - 0.15) / 0.85);
      regardCible = 1;
      ouvre = 0.1 + 0.05 * lisse(u); // le clip ouvre déjà la gueule de ~55° : à peine plus
      if (u >= 1) {
        E.phase = "clac";
        E.tau = 0;
        if (!audio.jouer?.(SONS.clac, 1.0)) audio.croc?.(); // CLAC ! (son synthétisé si le fichier n'est pas prêt)
        E.clacs.push(J ? { d: J.d, lateral: J.phys.lateral, vitesse: J.phys.vitesse } : null);
      }
    }
    if (E.phase === "clac") {
      wFrappe = 1;
      regardCible = 1;
      ferme = lisse(E.tau / 0.07);
      if (E.tau >= A.tenue) {
        E.phase = "remonte";
        E.tau = 0;
        if (!audio.jouer?.(SONS.rugit, 1.1)) audio.grondement?.(0.45); // il rugit, furieux (secours : grondement synthétisé)
      }
    }
    if (E.phase === "remonte") {
      const t = E.tau;
      wFrappe = 1 - lisse(t / A.remontee);
      ferme = 1 - lisse(t / 0.3); // la gueule se rouvre : rugissement (clip)
      secoue = 0.32 * Math.sin(t * Math.PI * 2 * 2.6) * (1 - lisse(t / 1.8)); // « raté ! »
      regardCible = 1 - lisse(t / 1.6);
      if (t >= A.rugit) { E.phase = "repos"; E.arme = false; finirCri(); }
    }
    E.regard += (regardCible - E.regard) * Math.min(1, dt * 2.5);
    E.wFrappe = wFrappe;

    const actif = E.phase !== "repos" || E.regard > 0.01;
    if (!actif) { E.dernier = null; E.pivot = 0; objet.rotation.y = angle0; return; }

    // --- pose de l'image ---
    // il pivote sur ses pieds vers le kart (puis vers la cible de la frappe), au plus A.pivot
    if (J || derniereCible) {
      const vise = E.phase === "guette" || !derniereCible ? J?.phys : derniereCible.c;
      const visee = vise ? clamp(angle(Math.atan2(vise.x - objet.position.x, vise.z - objet.position.z) - angle0), -A.pivot, A.pivot) : 0;
      E.pivot += (visee * E.regard - E.pivot) * Math.min(1, dt * 2.5);
    } else E.pivot *= Math.max(0, 1 - dt * 2.5);
    objet.rotation.y = angle0 + E.pivot;
    objet.updateMatrixWorld(true);
    invF.copy(objet.matrixWorld).invert();
    for (const o of touches) base.get(o).copy(o.quaternion); // valeurs du clip (voir remettre)
    modifie = true;
    // cible : la gueule à côté du kart (côté T-rex), au-dessus du bord de la route
    if (J) {
      const lat = clamp(cote * (J.phys.lateral ?? 0) + A.cote, 2.5, piste.demi + 1.5) * cote;
      cible.set(piste.cx[iFrappe] + piste.nx[iFrappe] * lat, yRoute + A.hauteurBouche, piste.cz[iFrappe] + piste.nz[iFrappe] * lat);
      regardF.set(J.phys.x, (J.phys.y ?? 0) + 1, J.phys.z);
      derniereCible = { c: cible.clone(), r: regardF.clone() };
    } else if (derniereCible) {
      cible.copy(derniereCible.c);
      regardF.copy(derniereCible.r);
    } else return;
    const T = cible.clone().applyMatrix4(invF);
    const R = regardF.clone().applyMatrix4(invF);

    // regard : seulement le lacet vers le kart, le buste un peu penché
    opts.regard = null; opts.wTete = 0; opts.ouvre = 0; opts.ferme = 0; opts.secoue = 0;
    restaurer();
    posF(chaine[0], pivot);
    bouche(Mrepos);
    const psiR = clamp(angle(az(R) - az(Mrepos)), -1.3, 1.3) * E.regard;
    const thetaR = 0.22 * E.regard; // déjà penché pendant la guette : le plongeon est plus court
    let psi = psiR, theta = thetaR, kappa = 0;
    opts.regard = R; opts.wTete = E.regard; opts.ouvre = ouvre; opts.ferme = ferme; opts.secoue = secoue;
    if (wFrappe !== 0) {
      const s = resoudre(T);
      const f = Math.max(0, wFrappe);
      psi = psiR + (s.psi - psiR) * f;
      theta = thetaR + (s.theta - thetaR) * wFrappe;
      kappa = s.kappa * wFrappe;
    } else { sol.psi = psiR; sol.theta = thetaR; sol.kappa = 0; }

    poser(psi, theta, kappa);
    // sécurité : jamais la tête ni la mâchoire à moins de « plancher » au-dessus de la route (ni du kart
    // tout proche) ; sinon buste et cou se relèvent (s < 0 : plus haut que le clip, ex. rugissement)
    const yRef = Math.max(yRoute, J && Math.abs(J.d) < 25 ? J.phys.y ?? 0 : 0);
    if (plusBas() - yRef < A.plancher) {
      let lo = -0.8, hi = 1;
      for (let k = 0; k < 8; k++) {
        const mi = (lo + hi) / 2;
        poser(psi, theta * mi + (mi < 0 ? 0.3 * mi : 0), kappa * mi + (mi < 0 ? 0.5 * mi : 0));
        if (plusBas() - yRef < A.plancher) hi = mi; else lo = mi;
      }
      const s = lo;
      theta = theta * s + (s < 0 ? 0.3 * s : 0);
      kappa = kappa * s + (s < 0 ? 0.5 * s : 0);
      poser(psi, theta, kappa);
    }
    bouche(M);
    E.dernier = { psi, theta, kappa, bas: plusBas() - yRef, bouche: M.clone().applyMatrix4(objet.matrixWorld), cible: cible.clone() };
  }

  const outils = import.meta.env.DEV ? { repos0, bassin, tete, machoire, mixer, repos, cri, poser, resoudre, bouche, restaurer, residu, sol, opts, invF, pivot, base, touches, objet, posF, chaine } : null;
  return { update, remettre, etat, plusBas, outils };
}
