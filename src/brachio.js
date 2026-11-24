import * as THREE from "three";
import { creerDino } from "./dinos.js";

// Brachiosaure géant debout au-dessus de la route : pattes gauches d'un côté, pattes droites de
// l'autre, on passe entre ses pattes sous son ventre. Il regarde les karts arriver ; quand un
// joueur s'approche, il courbe son long cou et descend la tête devant le kart pour lui faire
// coucou (petits hochements), puis la remonte quand le kart passe dessous.
//
// Modèle : le sauropode du troupeau (« Brachiosaurus_AR card », Zinaida.Kovrova, CC-BY, voir
// public/CREDITS.txt), même fichier dinos/sauropode-troupeau.glb (6 908 triangles, squelette Biped :
// 10 os de cou + tête, 10 os de queue). Une seule instance, sans ombre.
// Pose : celle du clip « Idle » à 8 s (debout, cou levé), pattes écartées vers l'extérieur et corps
// élargi pour enjamber la route ; ensuite tout est procédural (pas de mixer) :
//  - cou : chaîne de 9 os (Neck1 à Neck9 ; Neck porte les épaules et reste fixe) dans un plan vertical tourné vers la cible (lacet), chaque os incliné
//    d'un angle a + b·k (courbe régulière, en « col de cygne ») ; (a, b) est résolu pour que la
//    tête arrive sur la cible (Levenberg-Marquardt, 2 inconnues, repart de la solution précédente) ;
//  - tête : vise le kart (hochements pendant le coucou) ;
//  - queue : enroulée sur le côté (vers la forêt, hors de la route et du ravin), balancement lent ;
//    au repos, le cou ondule doucement
//    (respiration) et la tête regarde à droite et à gauche.
export const BRACHIO = {
  fraction: 0.172, // place des pattes avant (fraction du tour) : fin du 1er virage, avant le ravin
  S: 5.0, // mètres par unité du modèle (hanches ~15 m, ventre ≥ 6 m au-dessus de la route)
  large: 1.15, // corps élargi en travers (enjamber la route)
  ecart: 0.52, // rad : cuisses et bras écartés vers l'extérieur
  voie: 7.2, // demi-largeur roulable sous lui (m) : les karts restent sur le goudron, loin des pattes
  approche: 96, // m (le long de la route, avant les pattes avant) : il commence à baisser la tête
  pleine: 70, // m : tête complètement descendue (elle remonte de 36 à 14 m : on passe sous le cou)
  hauteurTete: 8.0, // m : os de la tête au-dessus de la route en coucou (le bout du museau reste à ~4 m)
  queue: 0.27, // rad par os (plus près de la base) : queue enroulée sur le côté, hors de la route
};

const lisse = (a, b, x) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * Pose le brachiosaure sur la piste (réserve sa place tout de suite : piste.retrecissements pour
 * les pattes, piste.zonesDecor pour la forêt) ; le modèle arrive ensuite. Renvoie { update(dt) }.
 * Les joueurs suivis : piste.humains (karts { phys }, posé par la course).
 */
export function installerBrachio(groupe, piste, { indice } = {}) {
  const { N, pas } = piste;
  const B = BRACHIO;
  const iAv = (indice ?? Math.round(N * B.fraction)) % N;
  const nPattes = Math.round((3.4 * B.S) / pas); // écart pattes avant / arrière (mesuré : 3,4 unités)
  const iAr = (iAv + nPattes) % N;
  const iM = (iAv + Math.round(nPattes / 2)) % N;
  // murs invisibles : la voie se resserre doucement jusqu'au goudron avant les pattes avant
  piste.retrecissements.push({ debut: (iAv - Math.round(30 / pas) + N) % N, fin: (iAr + Math.round(3 / pas)) % N, demiMin: B.voie });
  // la forêt laisse la place : tête qui descend devant, corps, queue enroulée derrière
  (piste.zonesDecor ??= []).push({ nom: "brachio", debut: (iAv - Math.round(50 / pas) + N) % N, fin: (iAr + Math.round(45 / pas)) % N, demi: 48 });
  piste.brachio = { indice: iAv, fin: iAr };

  // repère : centré sur la route entre les pattes, le dino regarde les karts qui arrivent (-tangente)
  const porteur = new THREE.Group();
  porteur.name = "brachio";
  porteur.position.set(piste.cx[iM], 0, piste.cz[iM]);
  porteur.rotation.y = Math.atan2(-piste.tx[iM], -piste.tz[iM]);
  groupe.add(porteur);

  const etat = { pret: false, t: 0, w: 0, nod: 0 };
  creerDino("Apatosaurus", { hauteur: 1 }).then(({ objet, mixer, clips }) => {
    preparer(objet, mixer, clips);
    porteur.add(objet);
    piste.brachio.objet = objet;
    etat.pret = true;
  }).catch((e) => console.warn("brachio indisponible", e));

  // --- squelette ---
  let modele, invModele, cou, tete, queue, L = [], base = new Map(), parametres, solution;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qp = new THREE.Quaternion(), qd = new THREE.Quaternion();
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), sc = new THREE.Vector3(), pB = new THREE.Vector3(), haut = new THREE.Vector3(0, 1, 0), devant = new THREE.Vector3(0, 0, 1);

  /** Matrice d'un os dans le repère du modèle (sans l'échelle non uniforme ni le placement). */
  function dansModele(o, cible = m4) {
    return cible.multiplyMatrices(invModele, o.matrixWorld);
  }
  const posModele = (o, cible) => cible.setFromMatrixPosition(dansModele(o));
  function quatModele(o, cible) {
    dansModele(o).decompose(v2, cible, sc);
    return cible;
  }
  /** Tourne l'os d'une rotation r exprimée dans le repère du modèle, puis met à jour ses enfants. */
  function tourner(os, r) {
    quatModele(os.parent, qp);
    q.copy(qp).invert().multiply(r).multiply(qp); // r ramenée dans le repère du parent
    os.quaternion.premultiply(q);
    os.updateMatrixWorld(true);
  }
  /** Oriente l'os pour que le vecteur (os → point) aille dans la direction d (repère du modèle). */
  function viser(os, versPoint, d) {
    const p0 = posModele(os, new THREE.Vector3());
    v.copy(versPoint).sub(p0).normalize();
    tourner(os, qd.setFromUnitVectors(v, d));
  }

  function preparer(objet, mixer, clips) {
    modele = objet.children[0];
    // pose de départ : « Idle » à 8 s (debout, cou levé) ; ensuite plus de mixer (tout est calculé ici)
    const idle = clips.find((c) => c.name === "Idle");
    if (idle) mixer.setTime(Math.min(8, idle.duration - 0.01));
    modele.position.set(0, 0, 0);
    modele.scale.set(B.S * B.large, B.S, B.S);
    objet.updateMatrixWorld(true);
    invModele = modele.matrixWorld.clone().invert();
    const os = [];
    modele.traverse((o) => { if (o.isBone) os.push(o); if (o.isMesh) o.castShadow = o.receiveShadow = false; });
    const trouver = (debut) => os.find((o) => o.name.startsWith(debut));
    // (le 1er os du cou porte aussi les épaules : il reste fixe, la chaîne part de Neck1)
    cou = Array.from({ length: 9 }, (_, k) => `Bip001_Neck${k + 1}_`).map(trouver);
    tete = trouver("Bip001_Head_");
    queue = ["Bip001_Tail_", ...Array.from({ length: 9 }, (_, k) => `Bip001_Tail${k + 1}_`)].map(trouver);

    // pattes écartées vers l'extérieur (gauche du modèle = +X), tibias et pieds redressés en partie
    const rz = (a) => new THREE.Quaternion().setFromAxisAngle(devant, a);
    for (const [cote, s] of [["L", 1], ["R", -1]]) {
      for (const [haute, basse, pied] of [["Thigh", "Calf", "Foot"], ["UpperArm", "Forearm", "Hand"]]) {
        tourner(trouver(`Bip001_${cote}_${haute}_`), rz(s * B.ecart));
        tourner(trouver(`Bip001_${cote}_${basse}_`), rz(-s * B.ecart * 0.45));
        tourner(trouver(`Bip001_${cote}_${pied}_`), rz(-s * B.ecart * 0.55));
      }
    }
    for (const o of os) base.set(o, o.quaternion.clone());

    // longueurs du cou (os k → os k+1, la tête au bout) et base du cou
    const chaine = [...cou, tete];
    for (let k = 0; k < cou.length; k++) L.push(posModele(chaine[k + 1], new THREE.Vector3()).distanceTo(posModele(chaine[k], new THREE.Vector3())));
    posModele(cou[0], pB);
    // pose de repos : cou levé, légère courbe vers l'avant (tête ~41 m au-dessus de la route)
    parametres = { psi: 0, a: 1.0, b: -0.07 };
    solution = { a: 1.0, b: -0.07 };

    // sur le sol, centré sur la route entre les quatre pieds (boîte exacte des sommets animés)
    const boite = new THREE.Box3().setFromObject(modele, true);
    const pieds = ["Bip001_L_Foot_", "Bip001_R_Foot_", "Bip001_L_Hand_", "Bip001_R_Hand_"].map((n) => trouver(n).getWorldPosition(new THREE.Vector3()));
    const milieu = pieds.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(0.25);
    modele.position.set(-milieu.x, -boite.min.y, -milieu.z);
    objet.updateMatrixWorld(true);
    invModele.copy(modele.matrixWorld).invert(); // (recalculé à chaque image : le repère suit le placement)
  }

  /** Position de la tête (h devant, y en haut, dans le plan du cou) pour les angles (a, b). */
  function bout(a, b) {
    let h = 0, y = 0;
    for (let k = 0; k < L.length; k++) { const f = a + b * k; h += L[k] * Math.cos(f); y += L[k] * Math.sin(f); }
    return [h, y];
  }
  /** Résout (a, b) pour que la tête arrive à (h, y) (moindres carrés amortis, 6 pas). */
  function resoudre(h, y, depart) {
    let { a, b } = depart;
    const lambda = 0.02, e = 1e-3;
    for (let it = 0; it < 6; it++) {
      const [h0, y0] = bout(a, b), rh = h - h0, ry = y - y0;
      if (rh * rh + ry * ry < 1e-6) break;
      const [ha, ya] = bout(a + e, b), [hb, yb] = bout(a, b + e);
      const J = [(ha - h0) / e, (hb - h0) / e, (ya - y0) / e, (yb - y0) / e]; // [dh/da dh/db ; dy/da dy/db]
      const A11 = J[0] * J[0] + J[2] * J[2] + lambda, A12 = J[0] * J[1] + J[2] * J[3], A22 = J[1] * J[1] + J[3] * J[3] + lambda;
      const g1 = J[0] * rh + J[2] * ry, g2 = J[1] * rh + J[3] * ry;
      const det = A11 * A22 - A12 * A12;
      a = Math.min(1.6, Math.max(-1.3, a + (A22 * g1 - A12 * g2) / det));
      b = Math.min(0.08, Math.max(-0.42, b + (A11 * g2 - A12 * g1) / det));
    }
    return { a, b };
  }

  /** Le joueur qui arrive le plus près : { d (m avant les pattes avant), phys }. */
  function joueurQuiArrive() {
    let mieux = null;
    for (const k of piste.humains ?? []) {
      const p = k.phys;
      if (!p || p.indice < 0 || k.dedans) continue;
      let e = (iAv - p.indice + N) % N;
      if (e > N / 2) e -= N;
      const d = e * pas;
      if (d < -30 || d > B.approche + 10) continue;
      if (!mieux || d < mieux.d) mieux = { d, phys: p };
    }
    return mieux;
  }

  const cible = new THREE.Vector3(), regard = new THREE.Vector3(), dir = new THREE.Vector3(), pk = new THREE.Vector3();
  function update(dt) {
    if (!etat.pret) return;
    const t = (etat.t += dt);
    const J = joueurQuiArrive();
    // w : 0 au repos, 1 tête descendue ; quand le kart arrive sous la tête, elle remonte (pose de repos)
    const wv = J ? lisse(B.approche, B.pleine, J.d) * (1 - lisse(36, 14, J.d)) : 0;
    etat.w += (wv - etat.w) * Math.min(1, dt * 2.2);
    const w = etat.w;

    // remise à la pose de base (cou, tête, queue)
    for (const o of [...cou, tete, ...queue]) o.quaternion.copy(base.get(o));
    modele.updateWorldMatrix(true, true);
    invModele.copy(modele.matrixWorld).invert();
    // queue enroulée sur le côté (vers -X du modèle : hors de la route) qui se balance
    for (let k = 0; k < queue.length; k++) tourner(queue[k], qd.setFromAxisAngle(haut, B.queue * (1.6 - k * 0.13) + Math.sin(t * 0.9 - k * 0.45) * 0.035));

    // cou : au repos, il regarde un peu à droite et à gauche ; en coucou, la tête va devant le kart
    let psi = Math.sin(t * 0.23) * 0.25, a = 1.0 + Math.sin(t * 0.31) * 0.05, b = -0.07;
    if (J && w > 0.001) {
      const P = J.phys;
      // la tête ~20 m devant le kart (bien en vue, pas trop haut dans l'écran), entre 24 et 36 m devant les pattes avant
      const s = Math.min(36, Math.max(24, J.d - 20));
      const j = (iAv - Math.round(s / pas) + N) % N;
      let lat = (P.lateral ?? 0) * 0.6;
      lat = Math.max(-5, Math.min(5, lat));
      const y = B.hauteurTete;
      cible.set(piste.cx[j] + piste.nx[j] * lat, y, piste.cz[j] + piste.nz[j] * lat);
      cible.applyMatrix4(invModele); // dans le repère du modèle
      const dx = cible.x - pB.x, dz = cible.z - pB.z;
      solution = resoudre(Math.hypot(dx, dz), cible.y - pB.y, solution);
      const psiC = Math.atan2(dx, dz);
      psi += (psiC - psi) * w;
      a += (solution.a - a) * w;
      b += (solution.b - b) * w;
    } else solution = { a: parametres.a, b: parametres.b };
    // les angles suivent doucement (pas d'à-coups)
    const r = Math.min(1, dt * 3);
    parametres.psi += (psi - parametres.psi) * r;
    parametres.a += (a - parametres.a) * r;
    parametres.b += (b - parametres.b) * r;

    const chaine = [...cou, tete];
    const cp = Math.cos(parametres.psi), sp = Math.sin(parametres.psi);
    for (let k = 0; k < cou.length; k++) {
      const f = parametres.a + parametres.b * k;
      dir.set(sp * Math.cos(f), Math.sin(f), cp * Math.cos(f));
      viser(cou[k], posModele(chaine[k + 1], pk), dir);
    }

    // tête : au repos le museau un peu vers le bas ; en coucou, elle regarde le kart et hoche
    const fRepos = -0.45;
    dir.set(sp * Math.cos(fRepos), Math.sin(fRepos), cp * Math.cos(fRepos));
    if (J && w > 0.001) {
      regard.set(J.phys.x, (J.phys.y ?? 0) + 1.2, J.phys.z).applyMatrix4(invModele);
      regard.sub(posModele(tete, pk)).normalize();
      dir.lerp(regard, w).normalize();
    }
    etat.nod += ((J && J.d > 30 && J.d < 80 ? w : 0) - etat.nod) * Math.min(1, dt * 3);
    const hoche = Math.sin(t * 7.5) * 0.22 * etat.nod;
    // hochement : on bascule la direction visée autour de l'axe horizontal perpendiculaire
    v.set(dir.z, 0, -dir.x).normalize();
    dir.applyAxisAngle(v, hoche);
    // axe du museau = +Y local de la tête : on vise un point sur cet axe
    pk.set(0, 1, 0).applyQuaternion(quatModele(tete, q)).add(posModele(tete, v2.clone()));
    viser(tete, pk, dir);
  }

  return { update };
}
