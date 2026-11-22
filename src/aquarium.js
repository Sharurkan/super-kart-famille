import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import { planter } from "./vegetation.js";
import { audio } from "./audio.js";

// Aquarium géant du circuit Dinosaures : la route passe dans un tunnel de verre au fond
// d'un énorme bassin (sable, algues, rochers, bulles, bancs de poissons) où nage un mosasaure.
// Tout est décor autour de la route normale : la physique ne change pas.
//
// Le tunnel suit le virage de la route : chaque pièce est construite dans le repère de la
// piste (s = échantillon, l = latéral, y = hauteur), voir point().
//
// Accroches :
//  - piste.zonesDecor : { nom, debut, fin, demi } = emprise au sol (échantillons debut..fin,
//    demi-largeur latérale en mètres). La forêt n'y plante rien.
//  - l'objet renvoyé a update(dt) (appelé avec les mixers du décor, temps du jeu) ;
//    la caméra et la scène sont retrouvées au premier rendu (onBeforeRender).
//  - dans le tunnel, l'ambiance (brouillard, lumières) devient bleue, sans toucher course.js.

export const AQUARIUM = {
  debut: 0.729, // fraction du tour (virages du bas, après la tête de T-rex)
  fin: 0.787, // ~75 m de tunnel
  demiTunnel: 16.5, // demi-largeur du tunnel (les barrières sont à 14,8 m)
  hautTunnel: 8.5, // hauteur du sommet de la voûte
  demi: 28, // demi-largeur du bassin
  haut: 19, // hauteur des vitres ; l'eau s'arrête un peu en dessous
};

/** Ambiance sous l'eau (mêmes clés que AMBIANCE_INTERIEUR de interieur.js). */
const AMBIANCE_EAU = {
  brouillard: [0x1d7fae, 5, 80],
  ciel: [0xa6ecff, 0x1a5a7a, 2.0],
  soleil: 0.7,
};

const COULEURS_POISSONS = [0xffd43b, 0xff922b, 0x9ad8f0];

export function installerAquarium(groupe, piste) {
  const { N, pas, cx, cz, nx, nz } = piste;
  const A = AQUARIUM;
  const i0 = Math.round(N * A.debut), i1 = Math.round(N * A.fin);
  const W = A.demi, H = A.haut, a = A.demiTunnel, h = A.hautTunnel;
  const EAU = H - 0.6; // surface de l'eau
  const rnd = aleatoire(7);
  (piste.zonesDecor ??= []).push({ nom: "aquarium", debut: i0 - 2, fin: i1 + 2, demi: W + 1.5 });

  const aq = new THREE.Group();
  aq.name = "aquarium";
  groupe.add(aq);

  // --- repère de la piste ---
  /** Point du monde à l'échantillon s (fractionnaire), latéral l, hauteur y. */
  function point(s, l, y, v = new THREE.Vector3()) {
    const i = Math.min(N - 2, Math.max(0, Math.floor(s))), f = s - i;
    const px = cx[i] + (cx[i + 1] - cx[i]) * f, pz = cz[i] + (cz[i + 1] - cz[i]) * f;
    let ex = nx[i] + (nx[i + 1] - nx[i]) * f, ez = nz[i] + (nz[i + 1] - nz[i]) * f;
    const n = Math.hypot(ex, ez);
    ex /= n; ez /= n;
    return v.set(px + ex * l, y, pz + ez * l);
  }
  /** Repère (latéral, haut, avant) à l'échantillon i : pour poser une pièce dessinée en (l, y, 0). */
  function repere(s) {
    const i = Math.round(s);
    const n = new THREE.Vector3(nx[i], 0, nz[i]), t = new THREE.Vector3(piste.tx[i], 0, piste.tz[i]);
    return new THREE.Matrix4().makeBasis(n, new THREE.Vector3(0, 1, 0), t).setPosition(point(s, 0, 0));
  }
  /** Coordonnées piste d'un point du monde (indice proche pour aller vite). */
  function local(p, indice) {
    const r = piste.localiser(p.x, p.z, indice);
    return { s: r.indice + r.long / pas, l: r.lateral, indice: r.indice };
  }
  /** Hauteur de la voûte du tunnel au latéral l (0 en dehors). */
  const voute = (l) => (Math.abs(l) < a ? h * Math.sqrt(1 - (l / a) ** 2) : 0);

  /** Grille le long du tunnel : fn(s, b, v) place le sommet (b de 0 à 1 en travers). */
  function grille(nb, fn, uvEchelle = 8) {
    const ns = Math.ceil((i1 - i0) / 2);
    const pos = [], uv = [], idx = [], v = new THREE.Vector3();
    for (let k = 0; k <= ns; k++) {
      const s = i0 + ((i1 - i0) * k) / ns;
      for (let j = 0; j <= nb; j++) {
        fn(s, j / nb, v);
        pos.push(v.x, v.y, v.z);
        uv.push(v.x / uvEchelle, v.z / uvEchelle);
      }
    }
    for (let k = 0; k < ns; k++)
      for (let j = 0; j < nb; j++) {
        const p = k * (nb + 1) + j, q = p + nb + 1;
        idx.push(p, q, p + 1, p + 1, q, q + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  const caustique = textureCaustique();
  const caustique2 = caustique.clone();
  caustique2.repeat.set(0.7, 0.7);
  const metal = new THREE.MeshLambertMaterial({ color: 0x2f4650 });
  const beton = new THREE.MeshLambertMaterial({ color: 0x9aa3a6, side: THREE.DoubleSide });

  // --- tunnel de verre ---
  const tunnel = new THREE.Mesh(grille(14, (s, b, v) => point(s, a * Math.cos(Math.PI * b), h * Math.sin(Math.PI * b), v)), verre(0x9fe3ff, 0.12, 0.6));
  tunnel.renderOrder = 4;
  aq.add(tunnel);
  // arceaux tous les ~5 m et bordures en béton au pied de la voûte
  const arceau = (rayon) => {
    const pts = [];
    for (let k = 0; k <= 18; k++) pts.push(new THREE.Vector3(a * Math.cos((Math.PI * k) / 18), h * Math.sin((Math.PI * k) / 18), 0));
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 12, rayon, 4, false);
  };
  const arceaux = [];
  const nbArceaux = Math.round(((i1 - i0) * pas) / 5.5);
  for (let k = 1; k < nbArceaux; k++) arceaux.push(arceau(0.16).applyMatrix4(repere(i0 + ((i1 - i0) * k) / nbArceaux)));
  aq.add(new THREE.Mesh(mergeGeometries(arceaux), metal));
  for (const c of [-1, 1]) aq.add(new THREE.Mesh(grille(1, (s, b, v) => point(s, c * (a + 0.25), b * 0.7, v)), beton));

  // --- bassin : vitres latérales, socle, poteaux, rebord ---
  for (const c of [-1, 1]) {
    const vitre = new THREE.Mesh(grille(1, (s, b, v) => point(s, c * W, 1.2 + b * (H - 1.2), v)), verre(0x177fbd, 0.58, 0.9));
    vitre.renderOrder = 2;
    aq.add(vitre);
    aq.add(new THREE.Mesh(grille(1, (s, b, v) => point(s, c * W, b * 1.2, v)), beton));
    aq.add(new THREE.Mesh(grille(1, (s, b, v) => point(s, c * (W + 0.05), H - 0.7 + b * 0.9, v)), new THREE.MeshLambertMaterial({ color: 0x2f4650, side: THREE.DoubleSide })));
  }
  const poteaux = [];
  const nbPoteaux = Math.round(((i1 - i0) * pas) / 9);
  for (let k = 0; k <= nbPoteaux; k++)
    for (const c of [-1, 1]) poteaux.push(new THREE.BoxGeometry(0.7, H, 0.7).translate(c * W, H / 2, 0).applyMatrix4(repere(i0 + ((i1 - i0) * k) / nbPoteaux)));

  // --- les deux bouts : vitre percée par le tunnel, gros portique d'entrée ---
  const forme = new THREE.Shape();
  forme.moveTo(-W, 0);
  forme.lineTo(-a - 0.3, 0);
  for (let k = 0; k <= 20; k++) forme.lineTo(-(a + 0.3) * Math.cos((Math.PI * k) / 20), (h + 0.3) * Math.sin((Math.PI * k) / 20));
  forme.lineTo(W, 0);
  forme.lineTo(W, H);
  forme.lineTo(-W, H);
  const bouts = [], portiques = [];
  for (const s of [i0, i1]) {
    const m = repere(s);
    bouts.push(new THREE.ShapeGeometry(forme).applyMatrix4(m));
    // portique : arche épaisse + cadre autour de la vitre
    const pts = [];
    for (let k = 0; k <= 20; k++) pts.push(new THREE.Vector3((a + 0.5) * Math.cos((Math.PI * k) / 20), (h + 0.5) * Math.sin((Math.PI * k) / 20), 0));
    portiques.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.6, 6, false).applyMatrix4(m));
    poteaux.push(new THREE.BoxGeometry(2 * W + 0.7, 0.9, 0.7).translate(0, H - 0.25, 0).applyMatrix4(m));
    for (const c of [-1, 1]) poteaux.push(new THREE.BoxGeometry(W - a, 1.2, 0.8).translate((c * (W + a)) / 2, 0.6, 0).applyMatrix4(m)); // socle de chaque côté du tunnel
  }
  aq.add(new THREE.Mesh(mergeGeometries(poteaux), metal));
  aq.add(new THREE.Mesh(mergeGeometries(portiques), new THREE.MeshLambertMaterial({ color: 0xffb627 })));
  const finVitres = new THREE.Mesh(mergeGeometries(bouts), verre(0x177fbd, 0.6, 0.9));
  finVitres.renderOrder = 6;
  aq.add(finVitres);

  // --- fond de sable (reflets d'eau qui bougent) et surface de l'eau ---
  const sable = new THREE.MeshLambertMaterial({ color: 0xd8c690, emissive: 0x8fe3ff, emissiveMap: caustique, emissiveIntensity: 0.7, side: THREE.DoubleSide });
  for (const c of [-1, 1]) {
    const fond = new THREE.Mesh(grille(2, (s, b, v) => point(s, c * (a + 0.4 + b * (W - a - 0.4)), 0.07, v)), sable);
    aq.add(fond);
  }
  const surface = new THREE.Mesh(
    grille(4, (s, b, v) => point(s, -W + 2 * W * b, EAU, v)),
    new THREE.MeshLambertMaterial({ color: 0x6fd6f5, emissive: 0x9eeaff, emissiveMap: caustique2, emissiveIntensity: 1.0, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false }),
  );
  surface.renderOrder = 5;
  aq.add(surface);
  // reflets d'eau sur la route dans le tunnel (les bonbons restent dessus)
  const reflets = new THREE.Mesh(
    grille(2, (s, b, v) => point(s, -a + 2 * a * b, 0.06, v), 18),
    new THREE.MeshBasicMaterial({ color: 0x55c8ff, map: caustique2, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  reflets.renderOrder = 1;
  aq.add(reflets);

  // --- rayons de lumière depuis la surface ---
  const rayons = [];
  for (let k = 0; k < 9; k++) {
    const s = i0 + 4 + rnd() * (i1 - i0 - 8);
    const dessus = k % 3 === 0; // certains tombent sur la voûte
    const l = dessus ? (rnd() - 0.5) * a : (rnd() < 0.5 ? -1 : 1) * (a + 3 + rnd() * (W - a - 6));
    const y0 = voute(l) + 0.3, haut = EAU - y0, larg = 2.5 + rnd() * 3;
    const m = repere(s);
    for (const r of [0, Math.PI / 2])
      rayons.push(new THREE.PlaneGeometry(larg, haut).translate(0, haut / 2, 0).rotateY(r + rnd()).rotateZ((rnd() - 0.5) * 0.35).translate(l, y0, 0).applyMatrix4(m));
  }
  const matRayons = new THREE.MeshBasicMaterial({ color: 0xc6f5ff, map: textureRayon(), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const rayonsMesh = new THREE.Mesh(mergeGeometries(rayons), matRayons);
  rayonsMesh.renderOrder = 3;
  aq.add(rayonsMesh);

  // --- algues (ondulent dans le courant) ---
  const temps = { value: 0 };
  const algue = mergeGeometries([new THREE.PlaneGeometry(0.8, 1, 1, 5).translate(0, 0.5, 0), new THREE.PlaneGeometry(0.8, 1, 1, 5).translate(0, 0.5, 0).rotateY(Math.PI / 2)]);
  algue.deleteAttribute("uv");
  const matAlgue = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  matAlgue.onBeforeCompile = (sh) => {
    sh.uniforms.temps = temps;
    sh.vertexShader = "uniform float temps;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      float phA = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.23;
      float hA = position.y * position.y;
      transformed.x += sin(temps * 1.3 + phA + position.y * 2.5) * 0.45 * hA;
      transformed.z += cos(temps * 1.1 + phA) * 0.3 * hA;`);
  };
  const algues = [];
  const verts = [0x2b8a3e, 0x5c940d, 0x2f9e44, 0x66a80f, 0x087f5b];
  while (algues.length < 48) {
    const s = i0 + 2 + rnd() * (i1 - i0 - 4), c = rnd() < 0.5 ? -1 : 1, l = c * (a + 1.5 + rnd() * (W - a - 3));
    const p = point(s, l, 0);
    algues.push({ x: p.x, z: p.z, s: 0.8 + rnd() * 0.8, sy: 3 + rnd() * 8, r: rnd() * 6, couleur: verts[Math.floor(rnd() * verts.length)] });
  }
  aq.add(instances(algue, matAlgue, algues));
  // rochers : vrais rochers scannés de la forêt (sans la garde : on est dans le bassin)
  const rochers = (nom, n, e) => {
    const liste = [];
    for (let k = 0; k < n; k++) {
      const s = i0 + 3 + rnd() * (i1 - i0 - 6), c = rnd() < 0.5 ? -1 : 1, l = c * (a + 3 + rnd() * (W - a - 6));
      const p = point(s, l, 0);
      liste.push({ x: p.x, y: -0.1, z: p.z, s: e * (0.7 + rnd() * 0.6), r: rnd() * 6.3 });
    }
    planter(aq, nom, liste);
  };
  rochers("Gros_Rocher", 2, 1.1);
  rochers("Rocher_07", 3, 1.4);
  rochers("Rocher_Mousse_B", 3, 1.5);

  // --- bulles : colonnes qui montent du fond et du pied de la voûte ---
  const NB_COL = 14, PAR_COL = 9;
  const colonnes = [];
  for (let k = 0; k < NB_COL; k++) {
    const s = i0 + 3 + rnd() * (i1 - i0 - 6), c = k % 2 ? -1 : 1;
    const l = k < 6 ? c * (a + 0.8) : c * (a + 3 + rnd() * (W - a - 6));
    colonnes.push({ s, l, v: 1.4 + rnd() * 0.8, ph: rnd() * 10 });
  }
  const geoBulles = new THREE.BufferGeometry();
  geoBulles.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(NB_COL * PAR_COL * 3), 3));
  const bulles = new THREE.Points(geoBulles, new THREE.PointsMaterial({ map: textureBulle(), size: 0.55, transparent: true, depthWrite: false, color: 0xe8fbff }));
  bulles.frustumCulled = false;
  bulles.renderOrder = 3;
  aq.add(bulles);

  // --- bancs de poissons ---
  const poisson = fusionCouleurs([
    { geo: new THREE.SphereGeometry(0.5, 6, 3).scale(0.32, 0.62, 1.1), couleur: 0xffffff },
    { geo: queue(), couleur: 0xffffff },
  ]);
  const bancs = COULEURS_POISSONS.map((couleur, b) => {
    const n = 22;
    const im = new THREE.InstancedMesh(poisson, new THREE.MeshLambertMaterial({ color: couleur, side: THREE.DoubleSide }), n);
    im.frustumCulled = false;
    aq.add(im);
    const membres = [];
    for (let k = 0; k < n; k++) membres.push({ x: (rnd() - 0.5) * 7, y: (rnd() - 0.5) * 3, z: (rnd() - 0.5) * 6, e: 0.7 + rnd() * 0.5, ph: rnd() * 6 });
    return { im, membres, ph: b * 2.1, cote: b === 2 ? 0 : b === 0 ? 1 : -1, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1) };
  });

  // --- le mosasaure ---
  const moso = creerMosasaure();
  aq.add(moso.objet);
  const M = { pos: point((i0 + i1) / 2, -18, 7), dir: new THREE.Vector3(piste.tx[i0], 0, piste.tz[i0]), v: 7, phi: 0, etat: "patrouille", indice: Math.round((i0 + i1) / 2) };
  const marge = 6 / pas; // ne pas s'approcher des vitres du bout à moins de 6 m

  // --- caméra, scène et ambiance ---
  let scene = null, camera = null, ciel = null, soleil = null, dehors = null;
  tunnel.onBeforeRender = (r, sc, cam) => {
    if (scene === sc) return;
    scene = sc;
    camera = cam;
    sc.traverse((o) => {
      if (o.isHemisphereLight && !ciel) ciel = o;
      if (o.isDirectionalLight && !soleil) soleil = o;
    });
  };
  tunnel.frustumCulled = false; // pour que l'accroche soit appelée même hors champ
  const cA = new THREE.Color(), cB = new THREE.Color(), fondEau = new THREE.Color(AMBIANCE_EAU.brouillard[0]);
  // le dôme du ciel (premier enfant du décor, voir construireDecor) : caché sous l'eau
  const dome = groupe.children.find((o) => o.isMesh && o.material?.side === THREE.BackSide && o.geometry?.parameters?.radius >= 500);
  function ambiance(f) {
    if (!scene?.fog || !ciel || !soleil) return;
    if (f <= 0) {
      if (dehors) {
        scene.fog.color.setHex(dehors.brouillard[0]);
        [scene.fog.near, scene.fog.far] = [dehors.brouillard[1], dehors.brouillard[2]];
        ciel.color.setHex(dehors.ciel[0]);
        ciel.groundColor.setHex(dehors.ciel[1]);
        ciel.intensity = dehors.ciel[2];
        soleil.intensity = dehors.soleil;
        scene.background = dehors.fond;
        if (dome) dome.visible = dehors.dome;
        dehors = null;
      }
      return;
    }
    dehors ??= {
      brouillard: [scene.fog.color.getHex(), scene.fog.near, scene.fog.far],
      ciel: [ciel.color.getHex(), ciel.groundColor.getHex(), ciel.intensity],
      soleil: soleil.intensity,
      fond: scene.background,
      dome: dome?.visible ?? true,
    };
    // le ciel (sans brouillard) se verrait à travers l'eau : fond bleu à la place
    scene.background = f > 0.5 ? fondEau : dehors.fond;
    if (dome) dome.visible = f > 0.5 ? false : dehors.dome;
    const E = AMBIANCE_EAU, D = dehors, mel = (x, y) => x + (y - x) * f;
    scene.fog.color.copy(cA.setHex(D.brouillard[0]).lerp(cB.setHex(E.brouillard[0]), f));
    scene.fog.near = mel(D.brouillard[1], E.brouillard[1]);
    scene.fog.far = mel(D.brouillard[2], E.brouillard[2]);
    ciel.color.copy(cA.setHex(D.ciel[0]).lerp(cB.setHex(E.ciel[0]), f));
    ciel.groundColor.copy(cA.setHex(D.ciel[1]).lerp(cB.setHex(E.ciel[1]), f));
    ciel.intensity = mel(D.ciel[2], E.ciel[2]);
    soleil.intensity = mel(D.soleil, E.soleil);
  }

  // petits "bloup" de bulles quand on est dans le tunnel
  let prochainBloup = 0;
  function bloup() {
    const ctx = audio.ctx;
    if (!ctx || ctx.state !== "running" || !audio.busEffets) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    const f0 = 260 + Math.random() * 260;
    o.type = "sine";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.6, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g).connect(audio.busEffets);
    o.start(t);
    o.stop(t + 0.14);
  }

  const v3 = new THREE.Vector3(), cible = new THREE.Vector3(), o = new THREE.Object3D();
  let t = 0, sCamAvant = null, vCam = 20;

  // Le moment "waouh" : quand le kart arrive, le mosasaure attend sur le côté du bassin
  // puis traverse au-dessus de la voûte, juste devant le kart (vu de profil par la caméra).
  const sX = i0 + 48 / pas; // là où il passe au-dessus de la route
  const ATTENTE = { s: sX + 2 / pas, l: -20, y: h + 2.2 };
  const V_TRAVERSE = 14, AVANCE = 21; // m/s ; il croise la route ~21 m devant la caméra
  function nagerMosasaure(dt, sCam, vCam) {
    // où est le mosasaure dans le bassin ?
    const L = local(M.pos, M.indice);
    M.indice = L.indice;
    const approche = sCam !== null && sCam > i0 - 160 / pas && sCam < sX - AVANCE / pas;
    if (sCam === null || sCam > i1) M.fait = false;
    if (M.etat === "traverse") {
      if (L.l > 17 || sCam === null) { M.etat = "patrouille"; M.fait = true; }
    } else if (approche && !M.fait) {
      // temps avant que la caméra soit à AVANCE m du point de passage / temps pour y nager
      const tKart = ((sX - AVANCE / pas - sCam) * pas) / Math.max(6, vCam);
      const tMoso = (Math.abs(L.l) + 2) / V_TRAVERSE + 0.8; // + le temps de tourner et d'accélérer
      if (tKart <= tMoso) {
        if (L.l < -6) M.etat = "traverse";
        else { M.etat = "patrouille"; M.fait = true; } // pas à sa place à temps : tant pis pour ce tour
      } else M.etat = "attente";
    } else if (M.etat === "attente") M.etat = "patrouille";
    let vDes = 7, virage = 1.7;
    if (M.etat === "attente") {
      // il tourne doucement en rond près de son point de départ, sur le côté du tunnel
      point(ATTENTE.s + (Math.cos(t * 0.6) * 5) / pas, ATTENTE.l + Math.sin(t * 0.6) * 3, ATTENTE.y, cible);
      vDes = M.pos.distanceTo(cible) > 9 ? 14 : 4;
      virage = 2.2;
    } else if (M.etat === "traverse") {
      // il fonce de l'autre côté en frôlant la voûte, gueule ouverte
      point(sX - 3 / pas, 26, h + 1.9, cible);
      vDes = V_TRAVERSE;
      virage = 3.5;
    } else {
      // patrouille en "8" au-dessus et autour du tunnel
      M.phi += dt * (Math.PI * 2) / 26;
      const ph = M.phi + 0.35;
      const u = 0.5 + 0.4 * Math.sin(ph), l = 20 * Math.sin(2 * ph);
      point(i0 + marge + u * (i1 - i0 - 2 * marge), l, Math.max(voute(l) + 3.2, 5.5), cible);
    }
    // direction : on tourne doucement vers la cible
    v3.subVectors(cible, M.pos).normalize();
    M.dir.lerp(v3, Math.min(1, dt * virage));
    M.dir.y = THREE.MathUtils.clamp(M.dir.y, -0.45, 0.45);
    M.dir.normalize();
    M.v += (vDes - M.v) * Math.min(1, dt * (M.etat === "traverse" ? 4 : 1.5));
    M.pos.addScaledVector(M.dir, M.v * dt);
    // reste dans l'eau : entre les vitres, au-dessus de la voûte, sous la surface
    const P = local(M.pos, M.indice);
    const s = THREE.MathUtils.clamp(P.s, i0 + marge * 0.6, i1 - marge * 0.6);
    const l = THREE.MathUtils.clamp(P.l, -W + 4, W - 4);
    const y = THREE.MathUtils.clamp(M.pos.y, Math.max(voute(l) + 2, 2.5), EAU - 2.5);
    if (s !== P.s || l !== P.l || y !== M.pos.y) point(s, l, y, M.pos);
    moso.objet.position.copy(M.pos);
    moso.objet.lookAt(v3.copy(M.pos).add(M.dir));
    moso.ouverture = M.etat === "traverse" ? 0.55 : 0.12;
    moso.nager(dt, M.v);
  }

  function update(dt) {
    t += dt;
    temps.value = t;
    caustique.offset.set(t * 0.03, t * 0.017);
    caustique2.offset.set(-t * 0.021, t * 0.026);
    matRayons.opacity = 0.18 + 0.06 * Math.sin(t * 0.8);

    // la caméra : dans le tunnel ? à quelle distance ?
    let sCam = null, f = 0;
    if (camera) {
      const p = camera.position;
      const C = local(p, -1);
      if (C.s > i0 - 170 / pas && C.s < i1 + 10 / pas && Math.abs(C.l) < W + 20) sCam = C.s;
      if (Math.abs(C.l) < a && p.y < voute(C.l) + 0.5)
        f = THREE.MathUtils.clamp(((C.s - i0) * pas) / 6, 0, 1) * THREE.MathUtils.clamp(((i1 - C.s) * pas) / 6, 0, 1);
    }
    // vitesse de la caméra le long de la route (pour régler le passage du mosasaure)
    if (sCam !== null && sCamAvant !== null && dt > 0) vCam += (THREE.MathUtils.clamp(((sCam - sCamAvant) * pas) / dt, 0, 40) - vCam) * Math.min(1, dt * 4);
    sCamAvant = sCam;
    ambiance(f);
    if (f > 0.5 && t > prochainBloup) {
      bloup();
      prochainBloup = t + 0.15 + Math.random() * 0.45;
    }

    nagerMosasaure(dt, sCam, vCam);

    // bulles
    const pb = geoBulles.attributes.position;
    let n = 0;
    for (const c of colonnes)
      for (let k = 0; k < PAR_COL; k++) {
        const y0 = 0.3;
        const y = y0 + (((t * c.v + c.ph + (k * (EAU - y0)) / PAR_COL) % (EAU - y0)) + (EAU - y0)) % (EAU - y0);
        point(c.s, c.l + Math.sin(t * 3 + k * 1.7) * 0.25, y, v3);
        pb.setXYZ(n++, v3.x + Math.cos(t * 2.3 + k) * 0.2, v3.y, v3.z);
      }
    pb.needsUpdate = true;

    // poissons
    for (const b of bancs) {
      const ph = t * 0.16 + b.ph;
      const u = 0.5 + 0.38 * Math.sin(ph);
      const l = b.cote ? b.cote * (a + 5.5 + 2.5 * Math.sin(ph * 2.3)) : 6 * Math.sin(ph * 1.7);
      const y = b.cote ? 4 + 2.5 * Math.sin(ph * 1.3) : h + 5.5 + 1.5 * Math.sin(ph * 2);
      point(i0 + marge + u * (i1 - i0 - 2 * marge), l, y, cible);
      if (cible.distanceToSquared(b.pos) > 1e-6) b.dir.subVectors(cible, b.pos).normalize();
      b.pos.copy(cible);
      const yaw = Math.atan2(b.dir.x, b.dir.z);
      b.membres.forEach((m, k) => {
        o.position.set(m.x, m.y + Math.sin(t * 1.5 + m.ph) * 0.3, m.z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(b.pos);
        o.rotation.set(0, yaw + Math.sin(t * 6 + m.ph) * 0.15, 0);
        o.scale.setScalar(m.e);
        o.updateMatrix();
        b.im.setMatrixAt(k, o.matrix);
      });
      b.im.instanceMatrix.needsUpdate = true;
    }
  }

  return { update, objet: aq, mosasaure: moso };
}

// ---------------------------------------------------------------------------
// Mosasaure : creerMosasaure() renvoie { objet, ouverture, nager(dt, vitesse) } avec la tête
// vers +z (~19 m de long, échelle comprise) : l'aquarium ne fait que le déplacer et l'orienter.
//
// Vrai modèle : public/aquarium/mosasaure.glb, d'après « Mosasaurus » d'Alexey Zaika
// (https://sketchfab.com/3d-models/mosasaurus-684754a2ad8c46aca0634326b53d1f04, CC-BY 4.0),
// préparé par outils/blender/preparer_mosasaure.sh (≈5 600 triangles, un cycle de nage « Nager »
// qui boucle, mâchoire = os Bone.026). En attendant le chargement (ou s'il échoue), c'est le
// mosasaure en formes simples ci-dessous qui nage.
const LONGUEUR_MOSASAURE = 19; // m
let modeleMosasaure = null; // promesse partagée : le GLB n'est chargé qu'une fois

export function creerMosasaure() {
  const provisoire = creerMosasaureFormes();
  const objet = new THREE.Group();
  objet.name = "mosasaure";
  objet.add(provisoire.objet);

  let mixer = null, machoire = null, reposMachoire = null, pisteMachoire = false, ouv = 0.12;
  const qOuv = new THREE.Quaternion(), AXE_MACHOIRE = new THREE.Vector3(1, 0, 0);

  modeleMosasaure ??= new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "aquarium/mosasaure.glb");
  modeleMosasaure
    .then((gltf) => {
      const scene = skeletonClone(gltf.scene);
      const clip = gltf.animations.find((c) => c.name === "Nager") ?? gltf.animations[0];
      mixer = new THREE.AnimationMixer(scene);
      if (clip) mixer.clipAction(clip).play();
      mixer.update(0);
      scene.traverse((o) => {
        if (/^Bone\.?026/.test(o.name)) machoire = o;
        if (!o.isMesh) return;
        const ancien = o.material;
        // sans brouillard (bien visible de loin dans l'eau bleue) ; un peu de lumière propre
        // pour que la peau reste lisible sous l'eau, où le soleil est faible
        o.material = new THREE.MeshLambertMaterial({ map: ancien.map, emissive: 0xffffff, emissiveMap: ancien.map, emissiveIntensity: 0.12, side: THREE.DoubleSide, fog: false });
        ancien.dispose();
        o.frustumCulled = false; // la nage sort de la boîte de la pose de repos
      });
      if (machoire) {
        reposMachoire = machoire.quaternion.clone();
        pisteMachoire = clip?.tracks.some((t) => t.name === machoire.name + ".quaternion") ?? false;
      }
      // orientation et taille mesurées sur la pose de nage : de la queue vers la tête = +z
      const pivot = new THREE.Group();
      pivot.add(scene);
      pivot.updateMatrixWorld(true);
      scene.traverse((o) => o.isSkinnedMesh && o.skeleton.update());
      const boite = new THREE.Box3().setFromObject(scene, true);
      const taille = boite.getSize(new THREE.Vector3());
      const centre = boite.getCenter(new THREE.Vector3());
      const tete = machoire ? machoire.getWorldPosition(new THREE.Vector3()) : centre.clone().add(new THREE.Vector3(0, 0, 1));
      const axe = new THREE.Vector3();
      axe.setComponent([taille.x, taille.y, taille.z].indexOf(Math.max(taille.x, taille.y, taille.z)), 1);
      if (axe.dot(tete.clone().sub(centre)) < 0) axe.negate();
      scene.position.sub(centre);
      pivot.quaternion.setFromUnitVectors(axe, new THREE.Vector3(0, 0, 1));
      pivot.scale.setScalar(LONGUEUR_MOSASAURE / Math.max(taille.x, taille.y, taille.z));
      objet.remove(provisoire.objet);
      objet.add(pivot);
    })
    .catch((e) => console.warn("Mosasaure GLB indisponible, on garde le provisoire :", e));

  const moso = {
    objet,
    ouverture: 0.12,
    /** Avance le cycle de nage (fréquence de la queue selon la vitesse en m/s). */
    nager(dt, vitesse = 7) {
      if (!mixer) {
        provisoire.ouverture = moso.ouverture;
        provisoire.nager(dt, vitesse);
        return;
      }
      // cycle de 1,33 s : ~2 s à 7 m/s, ~1,3 s à 14 m/s (comme le provisoire)
      mixer.update(dt * (1.6 + vitesse * 0.22) / 4.71);
      ouv += (moso.ouverture - ouv) * Math.min(1, dt * 3);
      if (machoire) {
        if (!pisteMachoire) machoire.quaternion.copy(reposMachoire);
        machoire.quaternion.multiply(qOuv.setFromAxisAngle(AXE_MACHOIRE, ouv * 0.8));
      }
    },
  };
  return moso;
}

/** Mosasaure provisoire en formes simples (repli tant que le GLB n'est pas chargé). */
function creerMosasaureFormes() {
  const temps = { value: 0 }, ouverture = { value: 0.12 };
  const DOS = new THREE.Color(0x2e4659), VENTRE = new THREE.Color(0xe6dfcc), BOUCHE = new THREE.Color(0xc2565e);
  const parties = [];

  /** Corps "lofté" : ellipses (z, rx, ry, yc) ; couleur sombre dessus, pâle dessous. */
  function loft(sections, opts = {}) {
    const R = 14, pos = [], col = [], rame = [], mach = [], idx = [];
    const c = new THREE.Color();
    sections.forEach(([z, rx, ry, yc], k) => {
      for (let j = 0; j < R; j++) {
        const th = (j / R) * Math.PI * 2, sx = Math.cos(th), sy = Math.sin(th);
        pos.push(rx * sx, yc + ry * sy, z);
        // contre-ombrage avec quelques taches
        const m = THREE.MathUtils.smoothstep(sy, -0.45, 0.15);
        c.copy(VENTRE).lerp(DOS, m);
        if (m > 0.5) c.multiplyScalar(0.88 + 0.12 * Math.sin(z * 4.1 + th * 7) * Math.sin(z * 2.3));
        if (opts.bouche && z > opts.bouche && opts.bouche_cote * sy > 0.35) c.copy(BOUCHE);
        col.push(c.r, c.g, c.b);
        rame.push(0);
        mach.push(opts.machoire ? 1 : 0);
      }
      if (k < sections.length - 1)
        for (let j = 0; j < R; j++) {
          const p = k * R + j, q = k * R + ((j + 1) % R);
          idx.push(p, q, p + R, q, q + R, p + R);
        }
    });
    // bouts fermés
    for (const [k, sens] of [[0, -1], [sections.length - 1, 1]]) {
      const [z, , , yc] = sections[k], centre = pos.length / 3;
      pos.push(0, yc, z + sens * 0.02);
      c.copy(DOS);
      col.push(c.r, c.g, c.b);
      rame.push(0);
      mach.push(opts.machoire ? 1 : 0);
      for (let j = 0; j < R; j++) {
        const p = k * R + j, q = k * R + ((j + 1) % R);
        idx.push(...(sens > 0 ? [p, q, centre] : [q, p, centre]));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("rame", new THREE.Float32BufferAttribute(rame, 1));
    g.setAttribute("machoire", new THREE.Float32BufferAttribute(mach, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    parties.push(g.toNonIndexed());
  }
  /** Pièce simple d'une couleur ; rame(x, y, z) = amplitude du battement. */
  function piece(geo, couleur, rame = () => 0, machoire = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute("uv");
    const n = g.attributes.position.count, p = g.attributes.position;
    const c = new THREE.Color(couleur), col = [], r = [], m = [];
    for (let i = 0; i < n; i++) {
      col.push(c.r, c.g, c.b);
      r.push(rame(p.getX(i), p.getY(i), p.getZ(i)));
      m.push(machoire);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("rame", new THREE.Float32BufferAttribute(r, 1));
    g.setAttribute("machoire", new THREE.Float32BufferAttribute(m, 1));
    parties.push(g);
  }

  // corps et crâne (de la queue au bout du museau)
  loft([
    [-7.0, 0.04, 0.08, 0.2], [-6.2, 0.12, 0.22, 0.14], [-5.2, 0.22, 0.38, 0.08], [-4.0, 0.36, 0.55, 0.03],
    [-2.6, 0.58, 0.78, 0], [-1.0, 0.82, 0.98, 0], [0.6, 0.95, 1.05, 0], [2.0, 0.9, 0.95, 0.02],
    [3.2, 0.7, 0.72, 0.06], [4.0, 0.6, 0.55, 0.12], [5.0, 0.48, 0.4, 0.12], [5.9, 0.34, 0.3, 0.08],
    [6.6, 0.2, 0.2, 0.04], [7.1, 0.06, 0.08, 0],
  ], { bouche: 4.3, bouche_cote: -1 });
  // mâchoire inférieure (tourne autour de son articulation)
  loft([[3.7, 0.5, 0.3, -0.42], [4.6, 0.42, 0.2, -0.42], [5.6, 0.3, 0.15, -0.36], [6.5, 0.15, 0.1, -0.28], [7.0, 0.05, 0.04, -0.24]], { machoire: true, bouche: 4.0, bouche_cote: 1 });
  // dents
  const dent = new THREE.ConeGeometry(0.055, 0.2, 4);
  for (let z = 4.5; z < 6.9; z += 0.2) {
    const rx = THREE.MathUtils.lerp(0.42, 0.1, (z - 4.5) / 2.4);
    for (const c of [-1, 1]) {
      piece(dent.clone().rotateX(Math.PI).translate(c * rx * 0.8, -0.18 - (z - 4.5) * 0.02, z), 0xfffbe8);
      if (z < 6.6) piece(dent.clone().translate(c * rx * 0.75, -0.2 - (6.6 - z) * 0.03, z + 0.08), 0xfffbe8, undefined, 1);
    }
  }
  // yeux
  for (const c of [-1, 1]) {
    piece(new THREE.SphereGeometry(0.14, 8, 6).translate(c * 0.41, 0.27, 4.95), 0xffd43b);
    piece(new THREE.SphereGeometry(0.085, 6, 5).translate(c * 0.5, 0.29, 5.0), 0x111111);
  }
  // nageoires (palettes) : avant et arrière
  const palette = (lx, lz, x, y, z, c, ang) => new THREE.SphereGeometry(1, 9, 5).scale(lx, 0.1, lz).translate(c * lx * 0.9, 0, -lz * 0.3).rotateY(c * ang).rotateZ(c * -0.25).translate(c * x, y, z);
  for (const c of [-1, 1]) {
    piece(palette(1.3, 0.5, 0.75, -0.6, 2.0, c, 0.55), 0x3b5568, (x) => Math.max(0, Math.abs(x) - 0.8));
    piece(palette(0.95, 0.38, 0.55, -0.45, -2.2, c, 0.6), 0x3b5568, (x) => Math.max(0, Math.abs(x) - 0.6));
  }
  // nageoire de queue en croissant (lobe du bas plus grand, comme les vrais mosasaures)
  const f = new THREE.Shape();
  f.moveTo(-5.7, 0.2);
  f.quadraticCurveTo(-6.8, 0.8, -7.7, 1.5);
  f.quadraticCurveTo(-7.3, 0.6, -7.1, 0.15);
  f.quadraticCurveTo(-7.5, -0.9, -7.8, -2.0);
  f.quadraticCurveTo(-6.6, -1.0, -5.8, -0.15);
  piece(new THREE.ShapeGeometry(f, 4).rotateY(-Math.PI / 2), 0x2b4152);

  const geo = mergeGeometries(parties);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }); // sans brouillard : bien visible de loin dans l'eau bleue
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.temps = temps;
    sh.uniforms.ouverture = ouverture;
    sh.vertexShader = "uniform float temps;\nuniform float ouverture;\nattribute float rame;\nattribute float machoire;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      // la mâchoire s'ouvre autour de son articulation (z = 3.7, y = -0.3)
      if (machoire > 0.5) {
        vec2 d = vec2(transformed.z - 3.7, transformed.y + 0.3);
        float ca = cos(ouverture), sa = sin(ouverture);
        transformed.z = 3.7 + d.x * ca + d.y * sa;
        transformed.y = -0.3 - d.x * sa + d.y * ca;
      }
      // ondulation : presque rien à la tête, beaucoup à la queue
      float zt = clamp((2.5 - position.z) / 10.0, 0.0, 1.0);
      transformed.x += (0.07 + 1.1 * zt * zt) * sin(position.z * 0.5 + temps);
      // battement des nageoires
      transformed.y += rame * 0.4 * sin(temps * 0.8 + position.z * 0.2);`);
  };
  const objet = new THREE.Mesh(geo, mat);
  objet.name = "mosasaure";
  objet.frustumCulled = false; // l'ondulation sort un peu de la boîte
  objet.scale.setScalar(1.3); // ~18 m : un vrai géant des mers

  let phase = 0;
  const moso = {
    objet,
    ouverture: 0.12,
    /** Avance le cycle de nage (fréquence de la queue selon la vitesse en m/s). */
    nager(dt, vitesse = 7) {
      phase += dt * (1.6 + vitesse * 0.22);
      temps.value = phase;
      ouverture.value += (moso.ouverture - ouverture.value) * Math.min(1, dt * 3);
    },
  };
  return moso;
}

// ---------------------------------------------------------------------------
/** Verre : très transparent de face, plus visible de biais (bord des vitres lisible). */
function verre(couleur, base, bord) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { couleur: { value: new THREE.Color(couleur) }, base: { value: base }, bord: { value: bord } }]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <fog_pars_fragment>
      uniform vec3 couleur;
      uniform float base;
      uniform float bord;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float f3 = f * f * f;
        gl_FragColor = vec4(couleur + vec3(0.35) * f3 * f, base + (bord - base) * f3);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/** Reflets d'eau (cellules lumineuses), répétables. */
function textureCaustique() {
  const S = 256, rnd = aleatoire(3), pts = [];
  for (let k = 0; k < 18; k++) pts.push([rnd() * S, rnd() * S]);
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d"), img = g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9;
      for (const [px, py] of pts) {
        let dx = Math.abs(x - px), dy = Math.abs(y - py);
        dx = Math.min(dx, S - dx);
        dy = Math.min(dy, S - dy);
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      const e = Math.sqrt(d2) - Math.sqrt(d1);
      const v = Math.round(255 * Math.exp(-e / 4.5) ** 1.5);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dégradé vertical pour les rayons de lumière (clair en haut, invisible en bas et sur les côtés). */
function textureRayon() {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 128;
  const g = c.getContext("2d");
  for (let x = 0; x < 32; x++) {
    const bord = Math.sin((x / 31) * Math.PI);
    const d = g.createLinearGradient(0, 0, 0, 128);
    d.addColorStop(0, `rgba(255,255,255,${bord})`);
    d.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = d;
    g.fillRect(x, 0, 1, 128);
  }
  return new THREE.CanvasTexture(c);
}

function textureBulle() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d");
  const d = g.createRadialGradient(16, 16, 4, 16, 16, 15);
  d.addColorStop(0, "rgba(255,255,255,0.15)");
  d.addColorStop(0.75, "rgba(255,255,255,0.5)");
  d.addColorStop(0.9, "rgba(255,255,255,0.95)");
  d.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = d;
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.beginPath();
  g.arc(11, 11, 3, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(c);
}

/** Queue de poisson : un triangle plat derrière le corps. */
function queue() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.45, 0, 0.35, -0.85, 0, -0.35, -0.85], 3));
  g.computeVertexNormals();
  return g;
}

function fusionCouleurs(parties) {
  return mergeGeometries(parties.map(({ geo }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute("uv");
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  }));
}

function instances(geo, mat, liste) {
  const m = new THREE.InstancedMesh(geo, mat, liste.length);
  const o = new THREE.Object3D(), c = new THREE.Color();
  liste.forEach((p, i) => {
    o.position.set(p.x, p.y ?? 0, p.z);
    o.rotation.set(0, p.r ?? 0, 0);
    o.scale.set(p.s, p.sy ?? p.s, p.s);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
    if (p.couleur !== undefined) m.setColorAt(i, c.set(p.couleur));
  });
  return m;
}

function aleatoire(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
