import * as THREE from "three";
import { CIRCUITS } from "./circuits.js";
import { textureAsphalte } from "./textures.js";
import { fusion, matCouleurs } from "./decors-circuits.js";
import { instances } from "./decor.js";
import { audio } from "./audio.js";

// Looping vertical (comme sur un circuit de petites voitures) puis vrille, dans la ligne droite
// du départ. La route est resserrée par un entonnoir de plots, puis chaque kart (enfant et
// adversaires) est pris "sur des rails" : le looping, un petit bout de route, la vrille (la route
// fait un tour complet sur elle-même, le kart passe la tête en bas), sans jamais être lâché entre
// les deux. Il repart un peu plus vite à la fin.
//
// Entrée et sortie d'un looping se superposeraient : comme un vrai looping, le ruban se décale
// sur le côté pendant le tour (deux voies à ±VOIE du milieu de la route). On peut en mettre
// plusieurs (NB) : elles alternent gauche → droite, droite → gauche, espacées d'un peu plus que
// leur diamètre. La vrille tourne autour d'un axe à AXE mètres au-dessus de la voie de sortie,
// en penchant vers le milieu de la route.
//
// Repère local à la base de chaque boucle : s le long de la route, l en travers (> 0 = gauche),
// y vers le haut. Le ruban suit s = R sin θ, y = R (1 - cos θ), θ de 0 à 2π.
// Entre les boucles et dans la vrille, le chemin suit la vraie route (elle tourne un peu ici).

const R = 8; // rayon (16 m de diamètre)
const NB = 1; // nombre de boucles
const ESPACE = 19.5; // mètres entre les bases de deux boucles (> 2R : elles ne se touchent pas)
const BASE1 = 58; // échantillon de la base du looping (~67 m après la ligne)
const AVANT_VRILLE = 12; // mètres de route entre la base du (dernier) looping et la vrille
const LONG_VRILLE = 48; // longueur de la vrille (le long de la route)
const AXE = 3.5; // hauteur de l'axe de la vrille (la route y passe à 2 × AXE, tête en bas)
const DEMI = 3.2; // demi-largeur du ruban
const BANDE = 0.7; // largeur des bandes de bordure
const VOIE = 3.6; // décalage des deux voies (entrée de la 1re boucle à gauche, sortie à droite...)
const ELAN = 14; // mètres avant la 1re base où le kart prend les rails
const SORTIE = 10; // mètres après la vrille où on lui rend la main
const DECALAGE_MAX = 2; // écart du kart au milieu du ruban (deux karts côte à côte restent côte à côte)
const V_MIN = 16; // jamais trop lent la tête en bas
const V_MIN_SUIVEUR = 7; // un kart qui en suit un autre sur les rails ralentit, mais pas plus que ça
const ECART_SUIVI = 8.5; // distance gardée derrière un kart sur la même voie (> DIST_CAM : pas de kart entre la caméra et l'enfant)
const BONUS = 3; // petit coup de vitesse à la sortie
const DEMI_ENTONNOIR = 3.6;
const DIST_CAM = 7.2, HAUT_CAM = 3.1; // comme CameraPoursuite (pas de saut de caméra à la sortie)
const DEUX_PI = Math.PI * 2;

const lisse = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** Voie d'entrée de la boucle n (+VOIE à gauche, -VOIE à droite) ; elle sort sur l'autre. */
const voieEntree = (n) => (n % 2 ? -VOIE : VOIE);
/** Décalage latéral du ruban de la boucle n à l'angle θ. */
const latBoucle = (n, th) => voieEntree(n) * (1 - 2 * lisse(th / DEUX_PI));

// longueur parcourue sur une boucle en fonction de θ (le décalage latéral allonge un peu le chemin ;
// la même pour toutes les boucles, qui ne diffèrent que par le sens du décalage)
const K = 720;
const LONGUEURS = new Float32Array(K + 1);
for (let k = 1, prec = [0, VOIE, 0]; k <= K; k++) {
  const th = (k / K) * DEUX_PI;
  const p = [R * Math.sin(th), latBoucle(0, th), R * (1 - Math.cos(th))];
  LONGUEURS[k] = LONGUEURS[k - 1] + Math.hypot(p[0] - prec[0], p[1] - prec[1], p[2] - prec[2]);
  prec = p;
}
const LB = LONGUEURS[K]; // longueur d'une boucle
function thetaDe(g) {
  let a = 0, b = K;
  while (b - a > 1) {
    const m = (a + b) >> 1;
    if (LONGUEURS[m] <= g) a = m;
    else b = m;
  }
  const f = (g - LONGUEURS[a]) / Math.max(1e-6, LONGUEURS[b] - LONGUEURS[a]);
  return ((a + f) / K) * DEUX_PI;
}

/** Construit le(s) looping(s) et la vrille (décor + passage scripté) ; à appeler depuis decorDino. */
export function looping(piste, groupe) {
  const N = piste.N, pas = piste.pas;
  const ecart = Math.round(ESPACE / pas);
  const bases = Array.from({ length: NB }, (_, n) => (BASE1 + n * ecart) % N);
  const iPrise = (bases[0] - Math.round(ELAN / pas) + N) % N; // premier échantillon où l'on prend les rails
  const iVrille = bases[NB - 1] + Math.round(AVANT_VRILLE / pas); // début de la vrille
  const nVrille = Math.round(LONG_VRILLE / pas);
  const LV = nVrille * pas;
  const iRendu = (iVrille + nVrille + Math.round(SORTIE / pas)) % N;
  const voieVrille = -voieEntree(NB - 1); // voie de sortie du dernier looping
  const sensVrille = -Math.sign(voieVrille); // la route penche vers le milieu de la route

  // repère local de chaque boucle (origine au milieu de la route, à la base)
  const boucles = bases.map((i) => ({
    i,
    O: new THREE.Vector3(piste.cx[i], 0, piste.cz[i]),
    T: new THREE.Vector3(piste.tx[i], 0, piste.tz[i]),
    Nl: new THREE.Vector3(piste.nx[i], 0, piste.nz[i]),
  }));
  // abscisse (le long du chemin, g = 0 à la base de la 1re boucle) du début de chaque boucle
  const G = [0];
  for (let n = 1; n < NB; n++) G.push(G[n - 1] + LB + ((bases[n] - bases[n - 1] + N) % N) * pas);
  const GV = G[NB - 1] + LB + (iVrille - bases[NB - 1]) * pas; // début de la vrille sur le chemin
  const fin = GV + LV + SORTIE; // on rend la main ici

  // entonnoir : la route se resserre jusqu'à la prise des rails (pas sur la grille de départ)
  const debutEntonnoir = Math.max(25, iPrise - Math.round(40 / pas));
  piste.retrecissements.push({ debut: debutEntonnoir, fin: iPrise + 2, demiMin: DEMI_ENTONNOIR });

  /** Point de la route à l'échantillon (fractionnaire) iF, décalé de l en travers et y en hauteur. */
  function route(iF, l, y, cible) {
    const i0 = Math.floor(iF), f = iF - i0;
    const a = ((i0 % N) + N) % N, b = (a + 1) % N;
    const nx = piste.nx[a] + (piste.nx[b] - piste.nx[a]) * f, nz = piste.nz[a] + (piste.nz[b] - piste.nz[a]) * f;
    return cible.set(piste.cx[a] + (piste.cx[b] - piste.cx[a]) * f + nx * l, y, piste.cz[a] + (piste.cz[b] - piste.cz[a]) * f + nz * l);
  }
  /** Point dans le repère de la boucle n. */
  function dansBoucle(n, s, l, y, cible) {
    const B = boucles[n];
    return cible.set(B.O.x + B.T.x * s + B.Nl.x * l, y, B.O.z + B.T.z * s + B.Nl.z * l);
  }

  const vN = new THREE.Vector3(), vX = new THREE.Vector3();
  /** Normale (gauche) de la route à l'échantillon fractionnaire iF. */
  function normale(iF, cible) {
    const i0 = Math.floor(iF), f = iF - i0;
    const a = ((i0 % N) + N) % N, b = (a + 1) % N;
    return cible.set(piste.nx[a] + (piste.nx[b] - piste.nx[a]) * f, 0, piste.nz[a] + (piste.nz[b] - piste.nz[a]) * f).normalize();
  }
  /** Angle de roulis de la vrille à la distance gv depuis son début (0 → 2π, en douceur). */
  const rouleVrille = (gv) => DEUX_PI * lisse(gv / LV);
  /**
   * Hauteur de l'axe pour un roulis ph : quand la route commence (ou finit) de pencher, son bord
   * bas passerait sous le sol ; on soulève alors un peu toute la vrille (raccord sans à-coup).
   */
  const axeVrille = (ph) => {
    const f = Math.max(0, (DEMI + 0.4) * Math.abs(Math.sin(ph)) - AXE * (1 - Math.cos(ph)));
    return AXE + (f * f) / (f + 0.15);
  };

  /**
   * Point du chemin à la distance g, décalé de dec en travers ; ch = { g0, l0 } pour l'arrivée
   * en douceur sur les rails (null pour le ruban du décor). Remplit out : P, U (haut du kart),
   * plus iF (échantillon de route le plus proche), n (boucle, NB = vrille, -1 sur la route),
   * th (angle dans la boucle ou la vrille), l.
   */
  function point(g, dec, ch, out) {
    if (g >= GV) {
      const gv = Math.min(g - GV, LV);
      out.iF = iVrille + (g - GV) / pas;
      // vrille : le haut de la route tourne autour de l'axe (au-dessus de la voie de sortie)
      const ph = rouleVrille(gv), c = Math.cos(ph), s = Math.sin(ph);
      normale(out.iF, vN);
      route(out.iF, voieVrille, axeVrille(ph), out.P); // l'axe
      out.U.set(-sensVrille * s * vN.x, c, -sensVrille * s * vN.z);
      vX.set(c * vN.x, sensVrille * s, c * vN.z); // le travers de la route, penché avec elle
      out.P.addScaledVector(out.U, -AXE).addScaledVector(vX, dec);
      out.n = g - GV < LV ? NB : -1;
      out.th = ph;
      out.l = voieVrille + sensVrille * AXE * s + dec * c;
      return out;
    }
    if (g < 0) {
      // approche : on glisse doucement de là où l'on était vers la voie d'entrée
      const t = ch && ch.g0 < 0 ? lisse((g - ch.g0) / -ch.g0) : 1;
      const l = ch ? ch.l0 + (voieEntree(0) + dec - ch.l0) * t : voieEntree(0) + dec;
      out.iF = bases[0] + g / pas;
      route(out.iF, l, 0, out.P);
      out.U.set(0, 1, 0);
      out.n = -1;
      out.th = 0;
      out.l = l;
      return out;
    }
    let n = NB - 1;
    while (n > 0 && g < G[n]) n--;
    const gl = g - G[n];
    if (gl <= LB) {
      const th = thetaDe(gl), B = boucles[n];
      const l = latBoucle(n, th) + dec;
      dansBoucle(n, R * Math.sin(th), l, R * (1 - Math.cos(th)), out.P);
      out.U.set(-B.T.x * Math.sin(th), Math.cos(th), -B.T.z * Math.sin(th));
      out.iF = bases[n];
      out.n = n;
      out.th = th;
      out.l = l;
      return out;
    }
    // route entre deux boucles (ou après la dernière), sur la voie de sortie
    const l = -voieEntree(n) + dec;
    out.iF = bases[n] + (gl - LB) / pas;
    route(out.iF, l, 0, out.P);
    out.U.set(0, 1, 0);
    out.n = -1;
    out.th = DEUX_PI;
    out.l = l;
    return out;
  }
  const nouveauPoint = () => ({ P: new THREE.Vector3(), U: new THREE.Vector3(), F: new THREE.Vector3(), X: new THREE.Vector3(), iF: 0, n: -1, th: 0, l: 0 });
  const pa = nouveauPoint(), pb = nouveauPoint();
  /** Position et repère complet (avant F, haut U, gauche X) dans le monde. */
  function repere(g, dec, ch, out) {
    point(g, dec, ch, out);
    point(g - 0.05, dec, ch, pa);
    point(g + 0.05, dec, ch, pb);
    out.F.subVectors(pb.P, pa.P).normalize();
    out.X.crossVectors(out.U, out.F).normalize();
    out.U.crossVectors(out.F, out.X);
    return out;
  }

  // ---------- passage scripté ----------
  const m4 = new THREE.Matrix4();
  const camRep = nouveauPoint(), viseRep = nouveauPoint();
  const vLoc = new THREE.Vector3(), vMonde = new THREE.Vector3(), vPos = new THREE.Vector3(), vVise = new THREE.Vector3(), vHaut = new THREE.Vector3();
  const qCam = new THREE.Quaternion();
  const fausseCamera = { position: new THREE.Vector3() };
  const couleursEtincelles = [0xffd43b, 0xff6b6b, 0x4dabf7, 0x69db7c, 0xf783ac, 0xffffff];
  const surRails = new Set(); // karts en train de faire la série : { g, dec, v }

  piste.passages.push({
    verifier(k, course) {
      const ph = k.phys;
      if (ph.piste !== piste || k.loopingTour === ph.tour) return null;
      const d = (ph.indice - iPrise + N) % N;
      if (d > ((iRendu - iPrise + N) % N) - 2) return null;
      k.loopingTour = ph.tour;
      return scenario(k, course);
    },
  });

  function scenario(k, course) {
    const ph = k.phys;
    // où en est le kart sur le chemin ? (normalement juste avant la 1re boucle)
    const B0 = boucles[0];
    const dx = ph.x - B0.O.x, dz = ph.z - B0.O.z;
    let g0 = Math.min(-1, dx * B0.T.x + dz * B0.T.z);
    const l0 = dx * B0.Nl.x + dz * B0.Nl.z;
    const dec = THREE.MathUtils.clamp(l0 * 0.55, -DECALAGE_MAX, DECALAGE_MAX);
    const avance = (ph.indice - bases[0] + N) % N;
    if (avance < N / 2) {
      // (cas rare : remis sur la piste au milieu de la série) on repart à la sortie de la boucle passée
      let n = 0;
      while (n < NB - 1 && (bases[n + 1] - bases[0] + N) % N <= avance) n++;
      g0 = G[n] + LB;
    }
    const ch = { g0, l0 };
    const vBase = Math.max(V_MIN, ph.vitesse);
    const moi = { g: g0, dec, v: vBase, joueur: !!k.joueur };
    surRails.add(moi);
    const indice0 = ph.indice;
    const rep = nouveauPoint();
    let boucle = -1; // dernière boucle commencée (pour le "fiouuu")
    let cam = null; // { decalage, q0, t } pour le fondu d'entrée de la caméra

    // le pilote 2D reste debout par rapport au kart (même la tête en bas)
    const orienterOrig = k.pilote.orienter;
    const mesh = k.pilote.mesh;
    k.pilote.orienter = (camera) => {
      vLoc.copy(camera.position);
      mesh.parent.worldToLocal(vLoc);
      const a = Math.atan2(vLoc.x - mesh.position.x, vLoc.z - mesh.position.z);
      mesh.getWorldPosition(vMonde);
      fausseCamera.position.set(vMonde.x + Math.sin(a), vMonde.y, vMonde.z + Math.cos(a));
      orienterOrig(fausseCamera, 0, 0);
    };

    const placer = () => {
      repere(moi.g, dec, ch, rep);
      ph.x = rep.P.x;
      ph.z = rep.P.z;
      ph.y = ph.ySol = rep.P.y; // ySol = y : l'ombre reste collée au ruban
      ph.vy = 0;
      ph.enLair = false;
      ph.pente = 0;
      ph.direction = 0;
      ph.dansHerbe = false;
      ph.angle = piste.angleA(((Math.round(rep.iF) % N) + N) % N);
      ph.lateral = rep.l;
      // indice qui avance régulièrement de la prise des rails à la sortie (classement, mini-carte)
      const t = THREE.MathUtils.clamp((moi.g - g0) / (fin - g0), 0, 1);
      ph.indice = (indice0 + Math.round(t * ((iRendu - indice0 + N) % N))) % N;
    };
    placer();

    return {
      etape(dt) {
        const hauteur = rep.P.y / (2 * R);
        let v = vBase * (1 - 0.12 * hauteur); // un peu moins vite en haut
        // pas de kart qui traverse celui de devant sur la même voie : on reste derrière lui
        for (const o of surRails) {
          // (derrière l'enfant, on reste derrière même sur le côté : pas de kart entre lui et la caméra)
          if (o === moi || (Math.abs(o.dec - dec) > 1.7 && !o.joueur)) continue;
          const e = o.g - moi.g;
          if (e > 0 && e < ECART_SUIVI) v = Math.min(v, Math.max(V_MIN_SUIVEUR, o.v - (ECART_SUIVI - e) * 2));
        }
        moi.v = ph.vitesse = v;
        moi.g += v * dt;
        if (moi.g < fin) {
          placer();
          if (rep.n > boucle) {
            boucle = rep.n;
            if (k.joueur) whoosh();
          }
          if (k.joueur && rep.n >= 0 && Math.random() < 0.7) {
            const c = couleursEtincelles[Math.floor(Math.random() * couleursEtincelles.length)];
            course.particules.emettre(rep.P.x + rep.U.x * 0.6, rep.P.y + rep.U.y * 0.6, rep.P.z + rep.U.z * 0.6, c, 0.6, 0.45);
          }
          return false;
        }
        // fin : on rend le kart à la physique, sur la route, un peu plus vite
        moi.g = fin;
        placer();
        surRails.delete(moi);
        const loc = piste.localiser(ph.x, ph.z, ph.indice);
        ph.indice = loc.indice;
        ph.lateral = loc.lateral;
        ph.y = ph.ySol = 0;
        ph.solAvant = "sol";
        ph.vitesse = vBase + BONUS;
        ph.boost = Math.max(ph.boost, 1.2);
        ph.poussee.x = ph.poussee.z = 0;
        ph.tempsCoince = ph.tempsContresens = 0;
        ph.xAvant = ph.x;
        ph.zAvant = ph.z;
        k.pilote.orienter = orienterOrig;
        k.modele.groupe.quaternion.identity();
        k.modele.groupe.rotation.set(0, ph.angle, 0);
        k.modele.groupe.position.set(ph.x, ph.y, ph.z);
        if (k.joueur) {
          course.cam.angle = ph.angle;
          course.cam.y = 0;
          course.cam.camera.up.set(0, 1, 0);
        }
        return true;
      },

      visuel(kart) {
        const Gr = kart.modele.groupe;
        Gr.position.copy(rep.P); // (les chocs entre karts ne le décalent pas des rails)
        m4.makeBasis(rep.X, rep.U, rep.F);
        Gr.quaternion.setFromRotationMatrix(m4);
      },

      /** Caméra de poursuite qui fait les boucles avec le kart (elle roule sur le même chemin, derrière lui). */
      camera(cp, dt) {
        const camera = cp.camera;
        repere(moi.g - DIST_CAM, dec, ch, camRep);
        repere(moi.g + 3, dec, ch, viseRep);
        vPos.copy(camRep.P).addScaledVector(camRep.U, HAUT_CAM);
        vVise.copy(viseRep.P).addScaledVector(viseRep.U, 1.1);
        vHaut.copy(camRep.U).add(rep.U).normalize();
        m4.lookAt(vPos, vVise, vHaut);
        qCam.setFromRotationMatrix(m4);
        if (!cam) cam = { decalage: camera.position.clone().sub(vPos), q0: camera.quaternion.clone(), t: 0 };
        cam.t += dt;
        const e = lisse(cam.t / 0.45);
        camera.position.copy(vPos).addScaledVector(cam.decalage, 1 - e);
        camera.quaternion.slerpQuaternions(cam.q0, qCam, e);
        camera.up.copy(vHaut);
        return true;
      },
    };
  }

  // ---------- décor ----------
  const decor = new THREE.Group();
  decor.name = "looping";
  groupe.add(decor);
  construireRuban(decor, point, G, GV, LV, fin);
  construireStructures(decor, dansBoucle);
  plotsEntonnoir(decor, piste, debutEntonnoir, iPrise);

  // arceaux rayés autour de la vrille (comme si la route tournait dans un tube) : la partie du
  // cercle au-dessus du sol, posée sur deux socles ; une jambe de force jusqu'au dessous du
  // ruban quand il est en l'air, et une étoile en haut. Rien ne passe sous le sol.
  {
    const RA = Math.hypot(AXE, DEMI) + 0.9; // rayon des arceaux (le ruban tourne dedans sans les toucher)
    const TUBE = 0.3, NB_RAYURES = 8;
    const couleurs = [0x51cf66, 0xffffff];
    const socle = new THREE.CylinderGeometry(0.5, 0.65, 0.7, 10).translate(0, 0.35, 0);
    const X = new THREE.Vector3(), un = new THREE.Vector3(1, 1, 1);
    const jambe = new THREE.BoxGeometry(0.45, 1, 0.45).translate(0, 0.5, 0);
    const forme = new THREE.Shape();
    for (let n = 0; n < 10; n++) {
      const a = (n / 10) * DEUX_PI, r = n % 2 ? 0.7 : 1.6;
      if (n) forme.lineTo(Math.sin(a) * r, Math.cos(a) * r);
      else forme.moveTo(Math.sin(a) * r, Math.cos(a) * r);
    }
    const etoile = new THREE.ExtrudeGeometry(forme, { depth: 0.4, bevelEnabled: false }).translate(0, 0, -0.2);
    const parties = [], A = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), qr = new THREE.Quaternion();
    const Z = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(0, 1, 0);
    const EP = 0.35;
    for (const f of [0.1, 0.36, 0.64, 0.9]) {
      const gv = f * LV, iF = iVrille + gv / pas;
      route(iF, voieVrille, axeVrille(rouleVrille(gv)), A);
      normale(iF, vN);
      const angle = Math.atan2(-vN.z, vN.x); // cap de la route (la normale est à gauche du cap)
      q.setFromAxisAngle(Y, angle); // z local → le long de la route, l'arceau dans le plan local xy
      // angle (autour de l'axe, depuis le x local) où le bas du tube touche le sol
      const th0 = Math.asin(THREE.MathUtils.clamp((A.y - TUBE) / RA, -1, 1));
      const ouverture = Math.PI + 2 * th0;
      const arc = new THREE.TorusGeometry(RA, TUBE, 6, 4, ouverture / NB_RAYURES);
      for (let k = 0; k < NB_RAYURES; k++) {
        m.compose(A, q.clone().multiply(qr.setFromAxisAngle(Z, -th0 + (k * ouverture) / NB_RAYURES)), un);
        parties.push({ geo: arc.clone().applyMatrix4(m), couleur: couleurs[k % 2] });
      }
      arc.dispose();
      // socles aux deux pieds
      X.set(1, 0, 0).applyQuaternion(q);
      for (const sg of [1, -1]) {
        m.compose(A.clone().addScaledVector(X, sg * RA * Math.cos(th0)).setY(0), q, un);
        parties.push({ geo: socle.clone().applyMatrix4(m), couleur: 0x7048e8 });
      }
      // jambe de force : du dessous du ruban jusqu'à l'arceau, dans la direction du "bas" de la
      // route, seulement si ce point de l'arceau est en l'air (sinon les socles suffisent)
      const ph = rouleVrille(gv), c = Math.cos(ph), s = Math.sin(ph);
      const bas = new THREE.Vector3(sensVrille * s * vN.x, -c, sensVrille * s * vN.z); // = -U
      if (A.y + bas.y * RA > TUBE + 0.3) {
        const pied = A.clone().addScaledVector(bas, AXE + EP);
        m.compose(pied, new THREE.Quaternion().setFromUnitVectors(Y, bas), new THREE.Vector3(1, RA - AXE - EP, 1));
        parties.push({ geo: jambe.clone().applyMatrix4(m), couleur: 0xffd43b });
      }
      // étoile au sommet de l'anneau, tournée vers les karts qui arrivent
      m.compose(A.clone().add(new THREE.Vector3(0, RA + 1.5, 0)), q, new THREE.Vector3(1, 1, 1));
      parties.push({ geo: etoile.clone().applyMatrix4(m), couleur: 0xffd43b });
    }
    decor.add(new THREE.Mesh(fusion(parties), matCouleurs()));
    for (const g of [socle, jambe, etoile]) g.dispose();
  }

  piste.looping = { indice: bases[0], bases, vrille: iVrille, finVrille: iVrille + nVrille, prise: iPrise, rendu: iRendu, rayon: R, longueur: fin, debutEntonnoir };
}

/**
 * Le ruban de route de toute la série (un seul maillage bitume + un seul maillage de couleurs) :
 * bitume au milieu, bandes orange et crème, dessous et rebords colorés.
 */
function construireRuban(groupe, point, G, GV, LV, fin) {
  const def = CIRCUITS.dino;
  const cB0 = new THREE.Color(def.bordure[0]), cB1 = new THREE.Color(def.bordure[1]);
  const cMur0 = new THREE.Color(0xe8322f), cMur1 = new THREE.Color(0xffd43b);
  const cDessous = new THREE.Color(0x4dabf7);
  const EP = 0.35; // épaisseur du ruban

  // sections le long du chemin (milieu du ruban) : P, X (en travers), U (haut du ruban), rebords
  const sections = [];
  const ajouter = (g) => {
    const p = { P: new THREE.Vector3(), U: new THREE.Vector3(), iF: 0, n: -1, th: 0, l: 0 };
    point(g, 0, null, p);
    const a = { P: new THREE.Vector3(), U: new THREE.Vector3() }, b = { P: new THREE.Vector3(), U: new THREE.Vector3() };
    point(g - 0.05, 0, null, a);
    point(g + 0.05, 0, null, b);
    const F = b.P.sub(a.P).normalize();
    const X = new THREE.Vector3().crossVectors(p.U, F).normalize();
    const mur = p.n >= 0 ? 0.75 * lisse(Math.min(p.th, DEUX_PI - p.th) / 0.5) : 0;
    p.P.y += 0.05;
    sections.push({ P: p.P, U: p.U, X, mur, air: p.P.y > 0.35 });
  };
  const pasRoute = 2, nBoucle = 80;
  /** Sections régulières de a (compris) à b (non compris), au plus tous les pasMax mètres. */
  const troncon = (a, b, pasMax) => {
    const nb = Math.max(1, Math.ceil((b - a) / pasMax - 1e-6));
    for (let k = 0; k < nb; k++) ajouter(a + ((b - a) * k) / nb);
  };
  troncon(-ELAN, 0, pasRoute);
  for (let n = 0; n < NB; n++) {
    troncon(G[n], G[n] + LB, LB / nBoucle); // la boucle : sections serrées
    troncon(G[n] + LB, n + 1 < NB ? G[n + 1] : GV, pasRoute); // route jusqu'à la suivante (ou la vrille)
  }
  troncon(GV, GV + LV, LV / 72); // la vrille
  troncon(GV + LV, fin, pasRoute);
  ajouter(fin);

  const pt = (sec, a, b) => [
    sec.P.x + sec.X.x * a + sec.U.x * b,
    sec.P.y + sec.X.y * a + sec.U.y * b,
    sec.P.z + sec.X.z * a + sec.U.z * b,
  ];

  // bitume (texture comme la route du circuit)
  const pos = [], uv = [];
  let v = 0;
  for (let k = 0; k < sections.length - 1; k++) {
    const A = sections[k], B = sections[k + 1];
    const a0 = pt(A, DEMI - BANDE, 0), a1 = pt(A, -DEMI + BANDE, 0), b0 = pt(B, DEMI - BANDE, 0), b1 = pt(B, -DEMI + BANDE, 0);
    const dv = Math.hypot(b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]) / 18;
    pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
    uv.push(0, v, 0, v + dv, 1, v, 1, v, 0, v + dv, 1, v + dv);
    v += dv;
  }
  const gRoute = new THREE.BufferGeometry();
  gRoute.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  gRoute.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  gRoute.computeVertexNormals();
  groupe.add(new THREE.Mesh(gRoute, new THREE.MeshLambertMaterial({ map: textureAsphalte(), color: def.route, side: THREE.DoubleSide })));

  // bandes, dessous, tranches et rebords (couleurs par sommet)
  const P2 = [], C2 = [];
  const quad = (p00, p10, p01, p11, c) => {
    P2.push(...p00, ...p10, ...p01, ...p01, ...p10, ...p11);
    for (let n = 0; n < 6; n++) C2.push(c.r, c.g, c.b);
  };
  for (let k = 0; k < sections.length - 1; k++) {
    const A = sections[k], B = sections[k + 1];
    const cb = (k >> 1) % 2 ? cB1 : cB0;
    const cm = Math.floor(k / 3) % 2 ? cMur1 : cMur0;
    const enLAir = A.air || B.air;
    for (const sg of [1, -1]) {
      const o1 = sg * (DEMI - BANDE), o2 = sg * DEMI;
      quad(pt(A, o1, 0), pt(B, o1, 0), pt(A, o2, 0), pt(B, o2, 0), cb);
      if (enLAir || A.mur > 0) quad(pt(A, o2, 0), pt(B, o2, 0), pt(A, o2, -EP), pt(B, o2, -EP), cDessous); // tranche
      if (A.mur > 0 || B.mur > 0) quad(pt(A, o2, 0), pt(B, o2, 0), pt(A, o2, A.mur), pt(B, o2, B.mur), cm); // rebord
    }
    if (enLAir) quad(pt(A, DEMI, -EP), pt(B, DEMI, -EP), pt(A, -DEMI, -EP), pt(B, -DEMI, -EP), cDessous);
  }
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute("position", new THREE.Float32BufferAttribute(P2, 3));
  g2.setAttribute("color", new THREE.Float32BufferAttribute(C2, 3));
  g2.computeVertexNormals();
  groupe.add(new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
}

/**
 * Portiques qui tiennent les boucles (deux tours rayées, une poutre, une étoile) et un grand
 * numéro 1, 2, 3 sur chaque poutre pour compter les loopings. Une même géométrie de base
 * est recopiée pour chaque boucle, tout est fusionné : un maillage de couleurs + un de numéros.
 */
function construireStructures(groupe, dansBoucle) {
  const lat = VOIE + DEMI + 1.4; // tours de part et d'autre des deux voies
  const haut = 2 * R + 0.9;
  const couleursTours = [0x9775fa, 0x4dabf7, 0x51cf66, 0xf783ac]; // une couleur par boucle (NB au plus 4)

  // géométries de base (repère local : x en travers, y en haut, z le long de la route)
  const troncon = new THREE.CylinderGeometry(0.45, 0.5, haut / 6, 8, 1, true);
  const socle = new THREE.CylinderGeometry(1.0, 1.2, 0.5, 8);
  const boule = new THREE.SphereGeometry(0.75, 8, 6);
  const jambe = new THREE.CylinderGeometry(0.22, 0.28, 9, 6, 1, true);
  const poutre = new THREE.BoxGeometry(2 * lat + 1, 0.8, 0.8);
  const attache = new THREE.BoxGeometry(2.2, haut - 2 * R - 0.35, 0.5);
  const forme = new THREE.Shape();
  for (let n = 0; n < 10; n++) {
    const a = (n / 10) * DEUX_PI, r = n % 2 ? 0.9 : 2.0;
    if (n) forme.lineTo(Math.sin(a) * r, Math.cos(a) * r);
    else forme.moveTo(Math.sin(a) * r, Math.cos(a) * r);
  }
  const etoile = new THREE.ExtrudeGeometry(forme, { depth: 0.5, bevelEnabled: false }).translate(0, 0, -0.25);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1);
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();

  const parties = [];
  const panneaux = [];
  for (let n = 0; n < NB; n++) {
    // repère de la boucle n : angle de la route et position dans le monde
    dansBoucle(n, 0, 0, 0, p0);
    dansBoucle(n, 1, 0, 0, p1);
    const angle = Math.atan2(p1.x - p0.x, p1.z - p0.z);
    const poser = (geo, x, y, z, rx = 0, couleur) => {
      const p = dansBoucle(n, z, x, y, new THREE.Vector3());
      e.set(rx, angle, 0, "YXZ");
      m.compose(p, q.setFromEuler(e), sc);
      parties.push({ geo: geo.clone().applyMatrix4(m), couleur });
    };
    for (const l of [lat, -lat]) {
      for (let t = 0; t < 6; t++) poser(troncon, l, (haut / 6) * (t + 0.5), 0, 0, t % 2 ? 0xffffff : couleursTours[n]);
      poser(socle, l, 0.25, 0, 0, 0x7048e8);
      poser(boule, l, haut + 0.3, 0, 0, 0xffd43b);
      for (const s of [-1, 1]) poser(jambe, l, 4.2, s * 1.85, -s * 0.42, couleursTours[n]); // jambes de force en A
      poser(etoile, l, haut + 2.6, 0, 0, 0xffd43b); // étoile en haut de chaque tour
    }
    poser(poutre, 0, haut, 0, 0, 0xffd43b);
    poser(attache, 0, (haut + 2 * R + 0.35) / 2 - 0.2, 0, 0, 0xffd43b); // le haut de la boucle y est accroché
    // grand numéro rond posé sur la poutre, tourné vers les karts qui arrivent
    const p = dansBoucle(n, -0.5, 0, haut + 0.4, new THREE.Vector3());
    panneaux.push({ p, angle, n });
  }
  groupe.add(new THREE.Mesh(fusion(parties), matCouleurs()));
  for (const g of [troncon, socle, boule, jambe, poutre, attache, etoile]) g.dispose();
  if (NB < 2) return; // un seul looping : pas besoin de numéro

  // numéros : une seule texture (1 2 3 côte à côte), un seul maillage
  const toile = document.createElement("canvas");
  toile.width = 128 * NB;
  toile.height = 128;
  const c = toile.getContext("2d");
  c.font = "bold 104px sans-serif";
  c.textAlign = "center";
  c.textBaseline = "middle";
  for (let n = 0; n < NB; n++) {
    c.fillStyle = couleursTours[n] === 0xffffff ? "#9775fa" : "#" + couleursTours[n].toString(16).padStart(6, "0");
    c.beginPath();
    c.arc(64 + n * 128, 64, 60, 0, DEUX_PI);
    c.fill();
    c.lineWidth = 8;
    c.strokeStyle = "#ffffff";
    c.stroke();
    c.fillStyle = "#ffffff";
    c.fillText(String(n + 1), 64 + n * 128, 70);
  }
  const tex = new THREE.CanvasTexture(toile);
  tex.colorSpace = THREE.SRGBColorSpace;
  const T = 3.4; // taille du numéro (m)
  const pos = [], uv = [];
  for (const { p, angle, n } of panneaux) {
    // carré vertical face aux karts qui arrivent, le bas posé sur la poutre
    const cx = -Math.cos(angle), sx = Math.sin(angle); // direction "droite" vue depuis l'arrivée
    const pts = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [p.x + cx * a * (T / 2), p.y + T / 2 + b * (T / 2), p.z + sx * a * (T / 2)]);
    pos.push(...pts[0], ...pts[1], ...pts[2], ...pts[2], ...pts[1], ...pts[3]);
    const u0 = n / NB, u1 = (n + 1) / NB;
    uv.push(u0, 0, u1, 0, u0, 1, u0, 1, u1, 0, u1, 1);
  }
  const gNum = new THREE.BufferGeometry();
  gNum.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  gNum.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  groupe.add(new THREE.Mesh(gNum, new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.1, side: THREE.DoubleSide })));
}

/** Plots ronds orange et crème le long de l'entonnoir (les murs physiques viennent de limiteLaterale). */
function plotsEntonnoir(groupe, piste, debut, prise) {
  const N = piste.N;
  const plots = [];
  for (let j = debut; j <= prise; j += 2) {
    const lim = piste.limiteLaterale(j % N) + 0.9;
    if (lim > piste.demi + piste.marge - 0.5) continue;
    for (const s of [1, -1]) {
      const i = j % N;
      plots.push({ x: piste.cx[i] + piste.nx[i] * s * lim, z: piste.cz[i] + piste.nz[i] * s * lim, s: 1, couleur: (j >> 1) % 2 ? 0xfff3bf : 0xff922b });
    }
  }
  const geo = fusion([
    { geo: new THREE.CylinderGeometry(0.45, 0.55, 0.9, 8).translate(0, 0.45, 0), couleur: 0xffffff },
    { geo: new THREE.SphereGeometry(0.45, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.9, 0), couleur: 0xffffff },
  ]);
  groupe.add(instances(geo, matCouleurs(), plots));
}

/** "Fiouuu" : un souffle qui monte puis redescend pendant chaque looping (son de l'enfant seulement). */
function whoosh() {
  const ctx = audio.ctx;
  if (!ctx || !audio.bruit || !audio.busEffets) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = audio.bruit;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.4;
  f.frequency.setValueAtTime(300, t);
  f.frequency.exponentialRampToValueAtTime(1800, t + 1.0);
  f.frequency.exponentialRampToValueAtTime(350, t + 2.2);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.6);
  g.gain.exponentialRampToValueAtTime(0.001, t + 2.3);
  s.connect(f).connect(g).connect(audio.busEffets);
  s.start(t);
  s.stop(t + 2.4);
}
