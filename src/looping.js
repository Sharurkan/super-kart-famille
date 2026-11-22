import * as THREE from "three";
import { CIRCUITS } from "./circuits.js";
import { textureAsphalte } from "./textures.js";
import { fusion, matCouleurs } from "./decors-circuits.js";
import { instances } from "./decor.js";
import { audio } from "./audio.js";

// Looping vertical (comme sur un circuit de petites voitures) dans la ligne droite du départ.
// La route est resserrée par un entonnoir de plots, puis chaque kart (enfant et adversaires)
// est pris "sur des rails" : il monte, passe la tête en bas, redescend et repart un peu plus vite.
// Entrée et sortie se superposeraient : comme un vrai looping, le ruban se décale sur le côté
// pendant le tour (entrée au milieu de la route, sortie sur le côté droit).
//
// Repère local à la base du looping : s le long de la route, l en travers (> 0 = gauche),
// y vers le haut. Le ruban suit s = R sin θ, y = R (1 - cos θ), θ de 0 à 2π.

const R = 8; // rayon (16 m de diamètre)
const DEMI = 3.2; // demi-largeur du ruban
const BANDE = 0.7; // largeur des bandes de bordure
const L_ENTREE = 0; // décalage du ruban à l'entrée
const L_SORTIE = -7.2; // ... et à la sortie (assez pour que les deux voies ne se touchent pas)
const ELAN = 10; // mètres avant la base où le kart prend les rails
const SORTIE = 12; // mètres après la base où on lui rend la main
const DECALAGE_MAX = 2; // écart du kart au milieu du ruban (deux karts côte à côte restent côte à côte)
const SERRE_SORTIE = 0.4; // à la sortie, l'écart est réduit (le kart reste sur la route)
const V_MIN = 16; // jamais trop lent la tête en bas
const BONUS = 3; // petit coup de vitesse à la sortie
const FRACTION_BASE = 0.059; // position de la base sur le tour (~76 m après la ligne)
const DEMI_ENTONNOIR = 3.6;
const DIST_CAM = 7.2, HAUT_CAM = 3.1; // comme CameraPoursuite (pas de saut de caméra à la sortie)

const lisse = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const latRuban = (th) => L_ENTREE + (L_SORTIE - L_ENTREE) * lisse(th / (Math.PI * 2));

/** Construit le looping (décor + passage scripté) ; à appeler depuis decorDino. */
export function looping(piste, groupe) {
  const N = piste.N, pas = piste.pas;
  const iB = Math.round(N * FRACTION_BASE);
  const iPrise = iB - Math.round(ELAN / pas) + 1; // premier échantillon où l'on prend les rails
  const iRendu = (iB + Math.round(SORTIE / pas)) % N;
  const O = new THREE.Vector3(piste.cx[iB], 0, piste.cz[iB]);
  const T = new THREE.Vector3(piste.tx[iB], 0, piste.tz[iB]);
  const Nl = new THREE.Vector3(piste.nx[iB], 0, piste.nz[iB]);
  const angleBase = Math.atan2(T.x, T.z);
  const monde = (s, l, y, cible = new THREE.Vector3()) =>
    cible.set(O.x + T.x * s + Nl.x * l, y, O.z + T.z * s + Nl.z * l);

  // entonnoir : la route se resserre jusqu'à la prise des rails (pas sur la grille de départ)
  const debutEntonnoir = Math.max(25, iPrise - Math.round(40 / pas));
  piste.retrecissements.push({ debut: debutEntonnoir, fin: iPrise + 2, demiMin: DEMI_ENTONNOIR });

  // table θ -> longueur parcourue sur le looping (le décalage latéral allonge un peu le chemin)
  const K = 720;
  const longueurs = new Float32Array(K + 1);
  {
    let prec = null;
    for (let k = 0; k <= K; k++) {
      const th = (k / K) * Math.PI * 2;
      const p = [R * Math.sin(th), latRuban(th), R * (1 - Math.cos(th))];
      longueurs[k] = prec ? longueurs[k - 1] + Math.hypot(p[0] - prec[0], p[1] - prec[1], p[2] - prec[2]) : 0;
      prec = p;
    }
  }
  const LB = longueurs[K];
  const thetaDe = (g) => {
    let a = 0, b = K;
    while (b - a > 1) {
      const m = (a + b) >> 1;
      if (longueurs[m] <= g) a = m;
      else b = m;
    }
    const f = (g - longueurs[a]) / Math.max(1e-6, longueurs[b] - longueurs[a]);
    return ((a + f) / K) * Math.PI * 2;
  };

  /**
   * Point du chemin d'un kart à la distance g (g = 0 au pied du looping, LB en haut... de retour en bas),
   * en repère local : { s, l, y, us, uy } (us, uy : direction "vers le haut du kart").
   */
  function local(g, ch) {
    if (g < 0) {
      const t = ch.s0 < 0 ? lisse((g - ch.s0) / -ch.s0) : 1;
      return { s: g, l: ch.l0 + (L_ENTREE + ch.dec - ch.l0) * t, y: 0, us: 0, uy: 1, th: 0 };
    }
    if (g <= LB) {
      const th = thetaDe(g);
      // l'écart au milieu se resserre pendant le tour : à la sortie on reste sur le bitume
      const dec = ch.dec * (1 - (1 - SERRE_SORTIE) * lisse(th / (Math.PI * 2)));
      return { s: R * Math.sin(th), l: latRuban(th) + dec, y: R * (1 - Math.cos(th)), us: -Math.sin(th), uy: Math.cos(th), th };
    }
    return { s: g - LB, l: L_SORTIE + ch.dec * SERRE_SORTIE, y: 0, us: 0, uy: 1, th: Math.PI * 2 };
  }
  const va = new THREE.Vector3(), vb = new THREE.Vector3();
  /** Position et repère (avant F, haut U, gauche X) dans le monde. */
  function repere(g, ch, out) {
    const p = local(g, ch);
    monde(p.s, p.l, p.y, out.P);
    const a = local(g - 0.05, ch), b = local(g + 0.05, ch);
    monde(b.s, b.l, b.y, vb).sub(monde(a.s, a.l, a.y, va));
    out.F.copy(vb).normalize();
    out.U.set(T.x * p.us, p.uy, T.z * p.us);
    out.X.crossVectors(out.U, out.F).normalize();
    out.U.crossVectors(out.F, out.X);
    out.l = p.l;
    out.th = p.th;
    return out;
  }
  const nouveauRepere = () => ({ P: new THREE.Vector3(), F: new THREE.Vector3(), U: new THREE.Vector3(), X: new THREE.Vector3(), l: 0, th: 0 });

  // ---------- passage scripté ----------
  const fin = LB + SORTIE;
  const m4 = new THREE.Matrix4();
  const camRep = nouveauRepere(), viseRep = nouveauRepere();
  const vLoc = new THREE.Vector3(), vMonde = new THREE.Vector3();
  const fausseCamera = { position: new THREE.Vector3() };
  const couleursEtincelles = [0xffd43b, 0xff6b6b, 0x4dabf7, 0x69db7c, 0xf783ac, 0xffffff];

  piste.passages.push({
    verifier(k, course) {
      const ph = k.phys;
      if (ph.piste !== piste || k.loopingTour === ph.tour) return null;
      const d = (ph.indice - iPrise + N) % N;
      if (d > iRendu - iPrise - 2) return null;
      k.loopingTour = ph.tour;
      return scenario(k, course);
    },
  });

  function scenario(k, course) {
    const ph = k.phys;
    const dx = ph.x - O.x, dz = ph.z - O.z;
    const s0 = Math.min(-1, dx * T.x + dz * T.z);
    const l0 = dx * Nl.x + dz * Nl.z;
    const ch = { s0, l0, dec: THREE.MathUtils.clamp(l0 * 0.55, -DECALAGE_MAX, DECALAGE_MAX) };
    const vBase = Math.max(V_MIN, ph.vitesse);
    const indice0 = ph.indice;
    const rep = nouveauRepere();
    let g = s0;
    let dansBoucle = false;
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
      repere(g, ch, rep);
      ph.x = rep.P.x;
      ph.z = rep.P.z;
      ph.y = ph.ySol = rep.P.y; // ySol = y : l'ombre reste collée au ruban
      ph.vy = 0;
      ph.enLair = false;
      ph.pente = 0;
      ph.direction = 0;
      ph.dansHerbe = false;
      ph.angle = angleBase;
      ph.lateral = rep.l;
      // indice qui avance régulièrement de la prise des rails à la sortie (classement, mini-carte)
      const t = THREE.MathUtils.clamp((g - s0) / (fin - s0), 0, 1);
      ph.indice = (indice0 + Math.round(t * ((iRendu - indice0 + N) % N))) % N;
    };
    placer();

    return {
      etape(dt) {
        const hauteur = rep.P.y / (2 * R);
        const v = vBase * (1 - 0.12 * hauteur); // un peu moins vite en haut
        ph.vitesse = v;
        g += v * dt;
        if (!dansBoucle && g >= 0) {
          dansBoucle = true;
          if (k.joueur) whoosh();
        }
        if (g < fin) {
          placer();
          if (k.joueur && g > 0 && g < LB && Math.random() < 0.7) {
            const c = couleursEtincelles[Math.floor(Math.random() * couleursEtincelles.length)];
            course.particules.emettre(rep.P.x + rep.U.x * 0.6, rep.P.y + rep.U.y * 0.6, rep.P.z + rep.U.z * 0.6, c, 0.6, 0.45);
          }
          return false;
        }
        // fin : on rend le kart à la physique, sur la route, un peu plus vite
        placer();
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
        const G = kart.modele.groupe;
        G.position.copy(rep.P); // (les chocs entre karts ne le décalent pas des rails)
        m4.makeBasis(rep.X, rep.U, rep.F);
        G.quaternion.setFromRotationMatrix(m4);
      },

      /** Caméra de poursuite qui fait le tour avec le kart (elle roule sur le même chemin, derrière lui). */
      camera(cp, dt) {
        const camera = cp.camera;
        repere(g - DIST_CAM, ch, camRep);
        repere(g + 3, ch, viseRep);
        const pos = camRep.P.clone().addScaledVector(camRep.U, HAUT_CAM);
        const vise = viseRep.P.clone().addScaledVector(viseRep.U, 1.1);
        const haut = camRep.U.clone().add(rep.U).normalize();
        m4.lookAt(pos, vise, haut);
        const q = new THREE.Quaternion().setFromRotationMatrix(m4);
        if (!cam) cam = { decalage: camera.position.clone().sub(pos), q0: camera.quaternion.clone(), t: 0 };
        cam.t += dt;
        const e = lisse(cam.t / 0.45);
        camera.position.copy(pos).addScaledVector(cam.decalage, 1 - e);
        camera.quaternion.slerpQuaternions(cam.q0, q, e);
        camera.up.copy(haut);
        return true;
      },
    };
  }

  // ---------- décor ----------
  const decor = new THREE.Group();
  decor.name = "looping";
  groupe.add(decor);
  construireRuban(decor, monde);
  construireStructure(decor, monde);
  plotsEntonnoir(decor, piste, debutEntonnoir, iPrise, iB);

  piste.looping = { indice: iB, prise: iPrise, rendu: iRendu, rayon: R, longueur: LB, debutEntonnoir };
}

/** Le ruban de route : bitume au milieu, bandes orange et crème, dessous et rebords colorés. */
function construireRuban(groupe, monde) {
  const def = CIRCUITS.dino;
  const cB0 = new THREE.Color(def.bordure[0]), cB1 = new THREE.Color(def.bordure[1]);
  const cMur0 = new THREE.Color(0xe8322f), cMur1 = new THREE.Color(0xffd43b);
  const cDessous = new THREE.Color(0x4dabf7);
  const EP = 0.35; // épaisseur du ruban

  // sections : (s, l, y, us, uy, hauteur des rebords)
  const sections = [];
  const nIn = 10, nLoop = 80, nOut = 12;
  for (let k = 0; k < nIn; k++) {
    const s = -ELAN + (ELAN * k) / nIn;
    sections.push({ s, l: L_ENTREE, y: 0.05, us: 0, uy: 1, mur: 0 });
  }
  for (let k = 0; k <= nLoop; k++) {
    const th = (k / nLoop) * Math.PI * 2;
    const mur = 0.75 * lisse(Math.min(th, Math.PI * 2 - th) / 0.5);
    sections.push({ s: R * Math.sin(th), l: latRuban(th), y: R * (1 - Math.cos(th)) + 0.05, us: -Math.sin(th), uy: Math.cos(th), mur });
  }
  for (let k = 1; k <= nOut; k++) sections.push({ s: (SORTIE * k) / nOut, l: L_SORTIE, y: 0.05, us: 0, uy: 1, mur: 0 });

  // point du ruban à un décalage a (en travers) et b (vers le haut du ruban)
  const T = new THREE.Vector3();
  const pt = (sec, a, b) => {
    const p = monde(sec.s, sec.l + a, sec.y);
    // direction "haut" du ruban en monde : us le long de la route, uy vertical
    monde(sec.us, 0, 0, T).sub(monde(0, 0, 0));
    return [p.x + T.x * b, p.y + sec.uy * b, p.z + T.z * b];
  };

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
    for (const sg of [1, -1]) {
      const o1 = sg * (DEMI - BANDE), o2 = sg * DEMI;
      quad(pt(A, o1, 0), pt(B, o1, 0), pt(A, o2, 0), pt(B, o2, 0), cb);
      const enLAir = A.y > 0.3 || B.y > 0.3;
      if (enLAir || A.mur > 0) {
        // tranche
        quad(pt(A, o2, 0), pt(B, o2, 0), pt(A, o2, -EP), pt(B, o2, -EP), cDessous);
      }
      if (A.mur > 0 || B.mur > 0) {
        // rebord (garde-corps) côté intérieur
        quad(pt(A, o2, 0), pt(B, o2, 0), pt(A, o2, A.mur), pt(B, o2, B.mur), cm);
      }
    }
    if (A.y > 0.3 || B.y > 0.3) quad(pt(A, DEMI, -EP), pt(B, DEMI, -EP), pt(A, -DEMI, -EP), pt(B, -DEMI, -EP), cDessous);
  }
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute("position", new THREE.Float32BufferAttribute(P2, 3));
  g2.setAttribute("color", new THREE.Float32BufferAttribute(C2, 3));
  g2.computeVertexNormals();
  groupe.add(new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
}

/** Portique qui tient le looping : deux tours rayées, une poutre en haut, une étoile. */
function construireStructure(groupe, monde) {
  const gauche = L_ENTREE + DEMI + 1.3, droite = L_SORTIE - DEMI - 1.3;
  const haut = 2 * R + 0.9;
  const parties = [];
  const angle = Math.atan2(monde(1, 0, 0).x - monde(0, 0, 0).x, monde(1, 0, 0).z - monde(0, 0, 0).z);
  const placer = (geo, s, l, y) => {
    const p = monde(s, l, y);
    return geo.rotateY(angle).translate(p.x, p.y, p.z);
  };
  const couleurs = [0x9775fa, 0xffffff];
  for (const l of [gauche, droite]) {
    // tour en tronçons de couleur
    const nb = 6;
    for (let n = 0; n < nb; n++) {
      const h = haut / nb;
      parties.push({ geo: placer(new THREE.CylinderGeometry(0.45, 0.5, h, 8, 1, true), 0, l, h * (n + 0.5)), couleur: couleurs[n % 2] });
    }
    // socle et boule en haut
    parties.push({ geo: placer(new THREE.CylinderGeometry(1.0, 1.2, 0.5, 8), 0, l, 0.25), couleur: 0x7048e8 });
    parties.push({ geo: placer(new THREE.SphereGeometry(0.75, 8, 6), 0, l, haut + 0.3), couleur: 0xffd43b });
    // jambes de force (en A, dans le sens de la route)
    for (const s of [-1, 1]) {
      const g = new THREE.CylinderGeometry(0.22, 0.28, 9, 6, 1, true);
      g.rotateX(-s * 0.42);
      parties.push({ geo: placer(g, s * 1.85, l, 4.2), couleur: 0x9775fa });
    }
  }
  // poutre au-dessus du looping (il y est "accroché")
  const largeur = gauche - droite;
  parties.push({ geo: placer(new THREE.BoxGeometry(largeur + 1, 0.8, 0.8), 0, (gauche + droite) / 2, haut), couleur: 0xffd43b });
  // attache entre la poutre et le haut du ruban
  parties.push({ geo: placer(new THREE.BoxGeometry(0.5, haut - 2 * R - 0.35, 2.2).rotateY(Math.PI / 2), 0, latRuban(Math.PI), (haut + 2 * R + 0.35) / 2 - 0.2), couleur: 0xffd43b });
  // étoile au sommet
  const etoile = new THREE.Shape();
  for (let n = 0; n < 10; n++) {
    const a = (n / 10) * Math.PI * 2, r = n % 2 ? 0.9 : 2.0;
    if (n) etoile.lineTo(Math.sin(a) * r, Math.cos(a) * r);
    else etoile.moveTo(Math.sin(a) * r, Math.cos(a) * r);
  }
  const gEt = new THREE.ExtrudeGeometry(etoile, { depth: 0.5, bevelEnabled: false }).translate(0, 0, -0.25);
  parties.push({ geo: placer(gEt, 0, (gauche + droite) / 2, haut + 2.4), couleur: 0xffd43b });
  groupe.add(new THREE.Mesh(fusion(parties), matCouleurs()));
}

/** Plots ronds orange et crème le long de l'entonnoir (les murs physiques viennent de limiteLaterale). */
function plotsEntonnoir(groupe, piste, debut, prise, base) {
  const N = piste.N;
  const plots = [];
  for (let j = debut; j <= base; j += 2) {
    const lim = piste.limiteLaterale(Math.min(j, prise)) + 0.9;
    if (lim > piste.demi + piste.marge - 0.5) continue;
    for (const s of [1, -1]) {
      if (s < 0 && j > prise) continue; // à droite, la sortie du looping passe là
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

/** "Fiouuu" : un souffle qui monte puis redescend pendant le looping (son de l'enfant seulement). */
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
