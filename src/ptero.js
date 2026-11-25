import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { planter, placeRocher, MARGE_ROCHER } from "./vegetation.js";
import { fusion } from "./decors-circuits.js";
import { audio } from "./audio.js";
import { percerSol } from "./decor.js";
import { installerMegalodon, MEGALO } from "./megalodon.js";

// Le ravin du ptérodactyle (circuit dino) : la route s'arrête au bord d'un précipice,
// le kart tombe dans le vide... et un ptérodactyle l'attrape avec ses pattes pour le
// déposer sur la route d'en face. Tout le monde est attrapé (on ne peut pas "rater"),
// et la traversée dure le même temps pour tous (course équitable).
//
// Utilise l'accroche commune de course.js : piste.passages (entrée dans le vide) et
// k.scenario (le passage scripté déplace k.phys à la place de la physique).
// La route, les bordures et les barrières sont enlevées au-dessus du vide par piste.trouer().

export const RAVIN = {
  largeur: 42, // m de vide le long de la route
  profondeur: 62, // m jusqu'au fond
  bout: 40, // m (de chaque côté de la route) où le ravin garde toute sa largeur, puis il s'arrondit
  depose: 6, // m après le bord d'en face : où le kart est reposé
  chute: 0.65, // s de chute ("oh non !") avant d'être attrapé
  vol: 2.35, // s de vol jusqu'à l'autre bord
  accroche: 0.95, // m : hauteur des pattes au-dessus du bas du kart
  pesanteur: 24,
};
const DUREE = RAVIN.chute + RAVIN.vol;

const lisse = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const enveloppe = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function bezier(a, b, c, d, u, cible) {
  const v = 1 - u;
  return cible.set(0, 0, 0).addScaledVector(a, v * v * v).addScaledVector(b, 3 * v * v * u).addScaledVector(c, 3 * v * u * u).addScaledVector(d, u * u * u);
}
function bezierDerivee(a, b, c, d, u, cible) {
  const v = 1 - u;
  return cible.set(0, 0, 0)
    .addScaledVector(b.clone().sub(a), 3 * v * v)
    .addScaledVector(c.clone().sub(b), 6 * v * u)
    .addScaledVector(d.clone().sub(c), 3 * u * u);
}

// ---------------------------------------------------------------------------
// Le ptérodactyle : un vrai modèle animé (public/dinos/pteranodon.glb, d'après
// "Pteranodon (Animated)" de oscar.lopez.riviello, CC-BY 4.0, voir CREDITS.txt ;
// préparé par outils/blender/ptero-preparer.py). Tant qu'il n'est pas chargé (ou si
// le chargement échoue), on montre le modèle provisoire construit en code.
// creerPtero() renvoie { objet, battre(dt, mode) } avec l'origine de "objet"
// à l'endroit où les pattes tiennent le kart, la tête vers +Z.
// mode : "plane" (ailes ouvertes), "pique" (piqué), "bat" (battements).

const ENVERGURE = 8.2; // m, d'un bout d'aile à l'autre
const PATTES = 1.6; // agrandissement des pattes (le corps reste au-dessus du pilote)
const TEINTES = [0xffffff, 0xdce9ff, 0xe4ffd9, 0xffe1ee, 0xfff0c9]; // pour que les 5 ne soient pas identiques

let promesseModele = null;
let modeleCharge = null;
/** Charge le modèle une seule fois (renvoie null en cas d'échec, sans jamais planter). */
export function chargerPtero() {
  if (!promesseModele) {
    promesseModele = new GLTFLoader()
      .loadAsync(`${import.meta.env.BASE_URL}dinos/pteranodon.glb`)
      .then((gltf) => (modeleCharge = preparerModele(gltf)))
      .catch((e) => {
        console.warn("ptérodactyle : modèle 3D indisponible, on garde le provisoire", e);
        return null;
      });
  }
  return promesseModele;
}

function preparerModele(gltf) {
  const scene = gltf.scene;
  const os = {}; // os par nom court ("Lthigh.92_92" → "Lthigh")
  scene.traverse((o) => {
    if (o.isBone) os[o.name.replace(/[.\d_]+$/, "")] ??= o;
    if (o.isMesh) o.frustumCulled = false; // le squelette animé sort de sa boîte
  });
  let mesh = null;
  scene.traverse((o) => {
    if (o.isSkinnedMesh && !mesh) mesh = o;
  });
  // on ne garde que les rotations (le corps ne monte pas et ne descend pas par rapport au kart),
  // et les cuisses restent fixes : on les tourne pour que les pattes pendent sous le corps
  const cuisses = [os.Lthigh, os.Rthigh].filter(Boolean);
  for (const c of gltf.animations)
    c.tracks = c.tracks.filter((t) => t.name.endsWith(".quaternion") && !cuisses.some((b) => t.name.startsWith(b.name + ".")));
  const battement = gltf.animations.find((c) => c.name === "battement") ?? gltf.animations[0];
  const plane = gltf.animations.find((c) => c.name === "plane") ?? battement;
  if (!mesh || !battement) throw new Error("modèle incomplet");

  // pose de référence : début du vol plané
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(plane).play();
  mixer.update(0);
  scene.updateMatrixWorld(true);
  const pos = (b) => b.getWorldPosition(new THREE.Vector3());
  // pattes vers le bas et un peu vers l'arrière : le corps passe au-dessus du capot, pas sur la tête du pilote
  const versBas = new THREE.Vector3(0, -1, -0.35).normalize();
  const q = new THREE.Quaternion(), qMonde = new THREE.Quaternion(), qParent = new THREE.Quaternion();
  for (const [cuisse, cheville] of [[os.Lthigh, os.Lankle], [os.Rthigh, os.Rankle]]) {
    if (!cuisse || !cheville) continue;
    const d = pos(cheville).sub(pos(cuisse)).normalize();
    q.setFromUnitVectors(d, versBas);
    cuisse.getWorldQuaternion(qMonde);
    cuisse.parent.getWorldQuaternion(qParent);
    cuisse.quaternion.copy(qParent.invert().multiply(q.multiply(qMonde)));
    cuisse.scale.multiplyScalar(PATTES); // de grandes pattes (et de grosses griffes) pour porter un kart
    cuisse.updateMatrixWorld(true);
  }
  // sens : la tête doit regarder vers +Z
  const demiTour = os.head && os.chest ? pos(os.head).z < pos(os.chest).z : false;
  // taille (envergure) et point d'accroche (entre les deux pattes, au plus bas des doigts)
  const boite = new THREE.Box3().setFromObject(scene, true);
  const echelle = ENVERGURE / Math.max(1e-6, boite.max.x - boite.min.x);
  const pieds = new THREE.Vector3();
  let n = 0;
  for (const cote of ["L", "R"]) {
    let bas = null;
    os[cote + "ankle"]?.traverse((b) => {
      if (b.isBone && (!bas || pos(b).y < bas.y)) bas = pos(b);
    });
    if (bas) {
      pieds.add(bas);
      n++;
    }
  }
  if (n) pieds.divideScalar(n);
  else pieds.set((boite.min.x + boite.max.x) / 2, boite.min.y, (boite.min.z + boite.max.z) / 2);
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  return { scene, battement, plane, echelle, pieds, demiTour, tex: mesh.material.map ?? null };
}

/** Une copie animée du modèle chargé (squelette cloné, son propre mixer). */
function creerPteroModele(m, variante) {
  const objet = new THREE.Group();
  const pivot = new THREE.Group();
  const copie = SkeletonUtils.clone(m.scene);
  const mat = new THREE.MeshLambertMaterial({ map: m.tex, side: THREE.DoubleSide, color: TEINTES[variante % TEINTES.length] });
  copie.traverse((o) => {
    if (o.isMesh) {
      o.material = mat;
      o.frustumCulled = false;
    }
  });
  if (m.demiTour) pivot.rotation.y = Math.PI;
  pivot.scale.setScalar(m.echelle);
  copie.position.copy(m.pieds).negate();
  pivot.add(copie);
  objet.add(pivot);

  const mixer = new THREE.AnimationMixer(copie);
  const bat = mixer.clipAction(m.battement);
  const plane = mixer.clipAction(m.plane);
  bat.play();
  plane.play();
  bat.time = Math.random() * m.battement.duration;
  plane.time = Math.random() * m.plane.duration;
  let poidsBat = 0;
  bat.setEffectiveWeight(0);
  plane.setEffectiveWeight(1);
  return {
    objet,
    modele3D: true,
    battre(dt, mode = "bat") {
      poidsBat += ((mode === "bat" ? 1 : 0) - poidsBat) * Math.min(1, dt * 5);
      bat.setEffectiveWeight(poidsBat);
      plane.setEffectiveWeight(1 - poidsBat);
      bat.timeScale = 1.5; // battements énergiques : il porte un kart !
      plane.timeScale = mode === "pique" ? 0.4 : 1;
      mixer.update(dt);
    },
  };
}

/**
 * Crée un ptérodactyle. Si le vrai modèle est déjà chargé, on l'utilise tout de suite ;
 * sinon on montre le provisoire et on le remplace dès que le modèle arrive.
 */
export function creerPtero(variante = 0) {
  const objet = new THREE.Group();
  let actuel = null;
  const mettre = (p) => {
    if (actuel) objet.remove(actuel.objet);
    actuel = p;
    objet.add(p.objet);
  };
  if (modeleCharge) mettre(creerPteroModele(modeleCharge, variante));
  else {
    mettre(creerPteroProvisoire(variante));
    chargerPtero().then((m) => {
      if (m) mettre(creerPteroModele(m, variante));
    });
  }
  return {
    objet,
    battre: (dt, mode) => actuel.battre(dt, mode),
    get modele3D() {
      return !!actuel.modele3D;
    },
  };
}

// --- le modèle provisoire, construit en code (~700 triangles) ---

const PALETTES = [
  { corps: 0xf76707, aile: 0xffa94d, bord: 0xc2410c, crete: 0xe03131 },
  { corps: 0x1c7ed6, aile: 0x74c0fc, bord: 0x1864ab, crete: 0xffd43b },
  { corps: 0x2f9e44, aile: 0x8ce99a, bord: 0x2b8a3e, crete: 0xf783ac },
  { corps: 0xae3ec9, aile: 0xe599f7, bord: 0x862e9c, crete: 0xffa94d },
  { corps: 0xe8590c, aile: 0xffc078, bord: 0xa63e0a, crete: 0x4dabf7 },
];
const JAUNE = 0xffd43b, BLANC = 0xffffff, NOIR = 0x1a1a1a;

/** Cylindre entre deux points. */
function os(a, b, r0, r1, faces = 6) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r1, r0, d.length(), faces);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** Membrane (triangles double face) avec un dégradé de couleur. */
function membrane(points, triangles, couleurs) {
  const pos = [], col = [];
  for (const t of triangles)
    for (const k of t) {
      pos.push(...points[k]);
      const c = new THREE.Color(couleurs[k]);
      col.push(c.r, c.g, c.b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function creerPteroProvisoire(variante = 0) {
  const P = PALETTES[variante % PALETTES.length];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const objet = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const matAile = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

  // corps, cou, tête (long bec, grande crête), yeux, queue, pattes qui serrent le kart
  const parties = [
    { geo: new THREE.SphereGeometry(0.5, 10, 7).scale(0.85, 0.75, 1.9).translate(0, 2.3, 0), couleur: P.corps },
    { geo: new THREE.SphereGeometry(0.42, 8, 6).scale(0.8, 0.5, 1.5).translate(0, 2.05, 0.1), couleur: 0xfff4e6 }, // ventre clair
    { geo: os(V(0, 2.45, 0.7), V(0, 2.85, 1.35), 0.28, 0.2, 7), couleur: P.corps },
    { geo: new THREE.SphereGeometry(0.33, 9, 7).scale(0.9, 0.85, 1.3).translate(0, 2.95, 1.5), couleur: P.corps },
    { geo: new THREE.ConeGeometry(0.2, 1.8, 7).scale(1, 1, 0.6).rotateX(Math.PI / 2).translate(0, 2.86, 2.55), couleur: JAUNE },
    { geo: new THREE.ConeGeometry(0.26, 1.5, 4).scale(0.25, 1, 1).rotateX(-Math.PI / 2 - 0.45).translate(0, 3.35, 0.95), couleur: P.crete },
    { geo: new THREE.ConeGeometry(0.15, 1.1, 6).rotateX(-Math.PI / 2 - 0.15).translate(0, 2.3, -1.45), couleur: P.corps },
  ];
  for (const s of [1, -1]) {
    parties.push({ geo: new THREE.SphereGeometry(0.13, 8, 6).translate(s * 0.25, 3.05, 1.65), couleur: BLANC });
    parties.push({ geo: new THREE.SphereGeometry(0.07, 6, 4).translate(s * 0.33, 3.07, 1.72), couleur: NOIR });
    // pattes : du ventre jusqu'aux flancs du kart
    const hanche = V(s * 0.3, 2.0, -0.35), genou = V(s * 0.75, 1.0, -0.15), pied = V(s * 0.95, 0.12, -0.05);
    parties.push({ geo: os(hanche, genou, 0.13, 0.09), couleur: P.corps });
    parties.push({ geo: os(genou, pied, 0.08, 0.07), couleur: JAUNE });
    for (const dz of [-0.25, 0, 0.25]) // griffes repliées vers le kart
      parties.push({ geo: os(pied, V(s * 0.72, -0.12, -0.05 + dz), 0.06, 0.02, 4), couleur: JAUNE });
  }
  const corps = new THREE.Mesh(fusion(parties), mat);
  objet.add(corps);

  // ailes : épaule (bras + membrane intérieure) puis poignet (doigt + membrane extérieure)
  const ailes = [];
  for (const s of [1, -1]) {
    const epaule = new THREE.Group();
    epaule.position.set(s * 0.35, 2.45, 0.4);
    const coude = [s * 2.4, 0.12, 0.15];
    const interieur = membrane(
      [[0, 0, 0], coude, [s * 1.3, -0.08, -1.05], [0, -0.1, -1.25]],
      [[0, 1, 2], [0, 2, 3]],
      [P.bord, P.aile, P.aile, P.bord]
    );
    const bras = os(V(0, 0, 0), V(...coude), 0.11, 0.07);
    const gi = fusion([{ geo: bras, couleur: P.bord }]);
    epaule.add(new THREE.Mesh(interieur, matAile), new THREE.Mesh(gi, mat));
    const poignet = new THREE.Group();
    poignet.position.set(...coude);
    const bout = [s * 3.0, 0.05, -1.1];
    const exterieur = membrane(
      [[0, 0, 0], bout, [s * 1.3 - coude[0], -0.2, -1.2]],
      [[0, 1, 2]],
      [P.aile, P.aile, P.aile]
    );
    const doigt = fusion([
      { geo: os(V(0, 0, 0), V(...bout), 0.07, 0.03), couleur: P.bord },
      { geo: new THREE.ConeGeometry(0.06, 0.35, 4).rotateX(Math.PI / 2).translate(s * 0.05, 0.05, 0.2), couleur: JAUNE },
    ]);
    poignet.add(new THREE.Mesh(exterieur, matAile), new THREE.Mesh(doigt, mat));
    epaule.add(poignet);
    objet.add(epaule);
    ailes.push({ s, epaule, poignet });
  }

  let phase = Math.random() * 6;
  let repli = 0; // 0 ailes ouvertes, 1 repliées vers l'arrière (piqué)
  let amplitude = 0.3;
  return {
    objet,
    /** Anime les ailes. */
    battre(dt, mode = "bat") {
      const freq = mode === "bat" ? 2.6 : mode === "plane" ? 0.7 : 1.2;
      const ampVoulue = mode === "bat" ? 0.75 : mode === "plane" ? 0.12 : 0.05;
      amplitude += (ampVoulue - amplitude) * Math.min(1, dt * 6);
      repli += ((mode === "pique" ? 1 : 0) - repli) * Math.min(1, dt * 8);
      phase += dt * freq * Math.PI * 2;
      const a = Math.sin(phase) * amplitude + 0.1;
      const b = Math.sin(phase - 0.9) * amplitude * 0.6;
      for (const { s, epaule, poignet } of ailes) {
        epaule.rotation.set(0, s * repli * 0.9, s * (a + repli * 0.35), "YXZ");
        poignet.rotation.set(0, s * repli * 0.6, s * (b - repli * 0.5), "YXZ");
      }
      corps.position.y = -Math.sin(phase) * amplitude * 0.15; // le corps monte quand les ailes descendent
    },
  };
}

// ---------------------------------------------------------------------------
/** Petit cri du ptérodactyle (pour l'enfant seulement). */
function cri() {
  const ctx = audio.ctx;
  if (!ctx || !audio.busEffets) return;
  const t = ctx.currentTime;
  for (const [debut, f0, f1] of [[0, 900, 1500], [0.16, 1300, 700]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f0, t + debut);
    o.frequency.exponentialRampToValueAtTime(f1, t + debut + 0.18);
    g.gain.setValueAtTime(0.0001, t + debut);
    g.gain.exponentialRampToValueAtTime(0.18, t + debut + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + debut + 0.2);
    o.connect(g).connect(audio.busEffets);
    o.start(t + debut);
    o.stop(t + debut + 0.22);
  }
}

function textureEau() {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#4dd4e6";
  g.fillRect(0, 0, 32, 128);
  for (let k = 0; k < 40; k++) {
    g.fillStyle = k % 3 ? "rgba(255,255,255,0.55)" : "rgba(180,240,255,0.8)";
    g.fillRect(Math.random() * 32, Math.random() * 128, 1 + Math.random() * 3, 6 + Math.random() * 18);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
/**
 * Creuse le ravin à l'échantillon "debut" de la piste et installe le passage du ptérodactyle.
 * (appelé par le décor dino ; à faire avant la création des bonbons)
 */
export function installerRavin(groupe, piste, { debut }) {
  const N = piste.N, pas = piste.pas;
  const ib = debut % N;
  const nbVide = Math.round(RAVIN.largeur / pas);
  const il = (ib + nbVide) % N;
  const id = (il + Math.round(RAVIN.depose / pas)) % N;
  piste.trouer(ib, il);
  piste.ravin = { debut: ib, fin: il, depose: id };
  chargerPtero(); // le vrai modèle arrive pendant le départ de la course

  const groupeRavin = new THREE.Group();
  groupe.add(groupeRavin);
  let graine = 7;
  const rnd = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);

  // --- repère du ravin : s le long de la route depuis le bord (0 → W), l latéral ---
  const cE = new THREE.Vector3(piste.cx[ib], 0, piste.cz[ib]), cF = new THREE.Vector3(piste.cx[il], 0, piste.cz[il]);
  const nE = new THREE.Vector3(piste.nx[ib], 0, piste.nz[ib]), nF = new THREE.Vector3(piste.nx[il], 0, piste.nz[il]);
  const tE = new THREE.Vector3(piste.tx[ib], 0, piste.tz[ib]), tF = new THREE.Vector3(piste.tx[il], 0, piste.tz[il]);
  const W = cE.distanceTo(cF), R = W / 2, B = RAVIN.bout;
  /** Point du monde (y = 0) pour des coordonnées (s, l) du ravin. */
  function monde(s, l, cible = new THREE.Vector3()) {
    if (s <= 0) return cible.copy(cE).addScaledVector(tE, s).addScaledVector(nE, l);
    if (s >= W) return cible.copy(cF).addScaledVector(tF, s - W).addScaledVector(nF, l);
    const u = s / W;
    const n = nE.clone().lerp(nF, u).normalize();
    return cible.copy(cE).lerp(cF, u).addScaledVector(n, l);
  }

  // --- contour de l'ouverture (bord droit et net là où passe la route) ---
  const Lr = piste.demi + piste.marge + 1.2;
  const bruit = (l) => Math.sin(l * 0.37) * 1.6 + Math.sin(l * 0.11 + 1.3) * 1.4 + (rnd() - 0.5) * 1.2;
  const contour = []; // [s, l]
  const rampe = (l) => lisse((Math.abs(l) - Lr) / 6);
  for (let l = -B; l < B; l += 2.5) contour.push([-Math.abs(bruit(l)) * rampe(l), l]);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI, r = 1 + (rnd() - 0.5) * 0.12;
    contour.push([R - R * Math.cos(a) * r, B + R * Math.sin(a) * r]);
  }
  for (let l = B; l > -B; l -= 2.5) contour.push([W + Math.abs(bruit(l)) * rampe(l), l]);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI, r = 1 + (rnd() - 0.5) * 0.12;
    contour.push([R + R * Math.cos(a) * r, -B - R * Math.sin(a) * r]);
  }
  // le bord net : les points proches de la route sont exactement sur la ligne de coupe
  for (const p of contour) if (Math.abs(p[1]) <= Lr) p[0] = p[0] < R ? 0 : W;
  const contourMonde = contour.map(([s, l]) => monde(s, l));

  // --- parois : anneaux de plus en plus resserrés vers le fond ---
  const H = RAVIN.profondeur;
  const niveaux = [0, 1.2, 4, 9, 16, 25, 36, 48, H];
  const retrait = (d) => (d <= 1.2 ? -0.6 * (d / 1.2) : 0.2 * d); // petit surplomb en haut, puis en V
  const nb = contour.length;
  const grille = niveaux.map((d, j) =>
    contour.map(([s, l]) => {
      const cl = Math.max(-B, Math.min(B, l));
      let ds = R - s, dl = cl - l;
      const n = Math.hypot(ds, dl) || 1;
      ds /= n;
      dl /= n;
      const r = retrait(d) + (j > 0 ? (rnd() - 0.5) * 2.2 : 0);
      const p = monde(s + ds * r, l + dl * r + (j > 0 ? (rnd() - 0.5) * 1.2 : 0));
      p.y = -d;
      return p;
    })
  );
  const STRATES = [0x8a5a2b, 0xc8743a, 0xa65a2e, 0xd9925a, 0x8c4a2a, 0xb86b3c, 0x6e3b24, 0x4a2a1c, 0x2a1a14];
  {
    const pos = [], col = [];
    const c = new THREE.Color();
    const sommet = (j, k) => {
      const p = grille[j][k % nb];
      pos.push(p.x, p.y, p.z);
      c.set(STRATES[j]).multiplyScalar((0.8 + rnd() * 0.35) * (1 - 0.55 * (niveaux[j] / H)));
      col.push(c.r, c.g, c.b);
    };
    for (let j = 0; j < niveaux.length - 1; j++)
      for (let k = 0; k < nb; k++) {
        sommet(j, k); sommet(j + 1, k); sommet(j, k + 1);
        sommet(j, k + 1); sommet(j + 1, k); sommet(j + 1, k + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const parois = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
    parois.frustumCulled = false;
    parois.onBeforeRender = () => nettoyer();
    groupeRavin.add(parois);
  }

  // --- fond sombre, rivière turquoise, cascade et brume ---
  const centre = monde(R, 0);
  const angleRavin = Math.atan2(nE.x + nF.x, nE.z + nF.z); // le ravin court en travers de la route
  const longueur = 2 * (B + R) + 30;
  const fond = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, longueur), new THREE.MeshLambertMaterial({ color: 0x2b2620 }));
  const pivot = new THREE.Group();
  pivot.position.set(centre.x, -H, centre.z);
  pivot.rotation.y = angleRavin;
  fond.rotation.set(-Math.PI / 2, 0, 0);
  pivot.add(fond);
  const texEau = textureEau();
  texEau.repeat.set(1, 12);
  const riviere = new THREE.Mesh(new THREE.PlaneGeometry(26, longueur), new THREE.MeshBasicMaterial({ map: texEau, color: 0xbff6ff }));
  riviere.rotation.x = -Math.PI / 2;
  riviere.position.y = 0.3;
  pivot.add(riviere);
  for (const [y, o] of [[16, 0.08], [30, 0.11], [44, 0.14]]) {
    const brume = new THREE.Mesh(new THREE.PlaneGeometry(W + 40, longueur), new THREE.MeshBasicMaterial({ color: 0xd8e2ea, transparent: true, opacity: o, depthWrite: false, fog: false }));
    brume.rotation.x = -Math.PI / 2;
    brume.position.y = H - y;
    pivot.add(brume);
  }
  groupeRavin.add(pivot);
  // le mégalodon qui jaillit de la rivière quand le joueur traverse (megalodon.js)
  const megalo = installerMegalodon(groupeRavin, { eauY: -H + 0.3 });
  audio.precharger?.(`${import.meta.env.BASE_URL}sons/trex-clac.ogg`);

  // cascade : de l'arrondi du côté "+l", le long de la paroi, jusqu'à la rivière
  let contourRuisseau = null; // (le ruisseau : la végétation s'en écarte aussi)
  const texCascade = textureEau();
  texCascade.repeat.set(2, 3);
  {
    const iBout = contour.findIndex(([, l]) => l > B + R * 0.9);
    const pos = [], uv = [], idx = [];
    for (let j = 1; j < niveaux.length; j++) {
      for (const [m, u] of [[-1, 0], [1, 1]]) {
        const p = grille[j][(iBout + m + nb) % nb].clone();
        const q = grille[j][iBout];
        p.lerp(q, 0.3);
        const versCentre = new THREE.Vector3(centre.x - p.x, 0, centre.z - p.z).normalize();
        p.addScaledVector(versCentre, 1.3);
        pos.push(p.x, p.y, p.z);
        uv.push(u, niveaux[j] / 12);
      }
      if (j > 1) {
        const a = (j - 2) * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    groupeRavin.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: texCascade, color: 0xe6fbff, side: THREE.DoubleSide, transparent: true, opacity: 0.92 })));
    // le ruisseau qui arrive de la forêt
    const haut = contourMonde[iBout], dehors = new THREE.Vector3(haut.x - centre.x, 0, haut.z - centre.z).normalize();
    const ruisseau = new THREE.Mesh(new THREE.PlaneGeometry(4, 40), new THREE.MeshBasicMaterial({ map: texEau, color: 0xd0f7ff }));
    ruisseau.rotation.set(-Math.PI / 2, Math.atan2(dehors.x, dehors.z), 0, "YXZ");
    ruisseau.position.copy(haut).addScaledVector(dehors, 19.5);
    ruisseau.position.y = 0.04;
    groupeRavin.add(ruisseau);
    contourRuisseau = [haut.clone().addScaledVector(dehors, -1), haut.clone().addScaledVector(dehors, 40)];
  }

  // --- trou dans le sol (le grand plan d'herbe de decor.js) ---
  // (percerSol garde les autres trous, ex. la tranchée de l'aquarium, quel que soit l'ordre)
  percerSol(groupe, contourMonde);

  // --- rochers (pack Quaternius) : sur le bord, au bout des barrières, accrochés aux parois ---
  const ROCHERS = ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"];
  const rochers = ROCHERS.map(() => []);
  const ajouter = (p, s, y = -0.3) => rochers[Math.floor(rnd() * 3)].push({ x: p.x, z: p.z, y, s, r: rnd() * 6.3 });
  contour.forEach(([s, l], k) => {
    if (Math.abs(l) < Lr + 1 || k % 2) return;
    const p = contourMonde[k], dehors = new THREE.Vector3(p.x - centre.x, 0, p.z - centre.z).normalize();
    ajouter(p.clone().addScaledVector(dehors, 1.2 + rnd() * 1.5), 0.8 + rnd() * 1.0);
  });
  // au bout des barrières, mais hors de portée des karts (leur face intérieure derrière la
  // limite où l'on roule : ils n'ont pas de collision)
  for (const [s, i] of [[-1.2, (ib - 1 + N) % N], [W + 1.2, (il + 1) % N]]) for (const c of [1, -1]) {
    const n = Math.floor(rnd() * 3), e = 1.25;
    const l = piste.limiteLaterale(i) + MARGE_ROCHER + placeRocher(ROCHERS[n]) * e;
    rochers[n].push({ ...monde(s, c * l), y: -0.2, s: e, r: rnd() * 6.3 });
  }
  const iCascade = contour.findIndex(([, l]) => l > B + R * 0.9);
  for (let n = 0; n < 22; n++) {
    const k = Math.floor(rnd() * nb), j = 2 + Math.floor(rnd() * 5);
    if (Math.abs(k - iCascade) < 4) continue; // pas devant la cascade
    // à moitié enfoncés dans la paroi (sinon ils flottent dans le vide)
    const p = grille[j][k].clone(), dehors = new THREE.Vector3(p.x - centre.x, 0, p.z - centre.z).normalize();
    p.addScaledVector(dehors, 2.2);
    ajouter(p, 1.1 + rnd() * 1.1, p.y - 1.5);
  }
  ROCHERS.forEach((nom, n) => planter(groupeRavin, nom, rochers[n]));

  // --- la végétation déjà plantée au-dessus du vide disparaît (elle arrive en différé) ---
  const dansLeTrou = (x, z, marge) => {
    let dedans = false;
    for (let a = 0, b = nb - 1; a < nb; b = a++) {
      const A = contourMonde[a], Bp = contourMonde[b];
      if ((A.z > z) !== (Bp.z > z) && x < ((Bp.x - A.x) * (z - A.z)) / (Bp.z - A.z) + A.x) dedans = !dedans;
      // distance au segment
      const dx = Bp.x - A.x, dz = Bp.z - A.z;
      const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(A.x + dx * t - x, A.z + dz * t - z) < marge) return true;
    }
    if (dedans) return true;
    // le ruisseau
    const [A, Bp] = contourRuisseau;
    const dx = Bp.x - A.x, dz = Bp.z - A.z;
    const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(A.x + dx * t - x, A.z + dz * t - z) < 2.5 + marge * 0.5;
  };
  const vus = new WeakSet([groupeRavin]);
  let nbVus = -1;
  const m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function nettoyer() {
    if (groupe.children.length === nbVus) return;
    nbVus = groupe.children.length;
    for (const o of groupe.children) {
      if (vus.has(o)) continue;
      vus.add(o);
      if (o.isInstancedMesh) {
        let change = false;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m4);
          if (dansLeTrou(m4.elements[12], m4.elements[14], 1.5)) {
            o.setMatrixAt(i, zero);
            change = true;
          }
        }
        if (change) {
          o.instanceMatrix.needsUpdate = true;
          o.computeBoundingSphere?.();
        }
      } else if (!o.isMesh && (o.position.x || o.position.z) && dansLeTrou(o.position.x, o.position.z, 4)) {
        o.visible = false; // un dinosaure posé au-dessus du vide
      }
    }
  }
  nettoyer();

  // --- les ptérodactyles (un par kart, créés à la demande) ---
  const reserve = [];
  function prendrePtero() {
    let p = reserve.find((r) => r.libre);
    if (!p) {
      p = creerPtero(reserve.length);
      p.objet.visible = false;
      groupeRavin.add(p.objet);
      reserve.push(p);
    }
    p.libre = false;
    p.depart = null;
    p.objet.visible = true;
    return p;
  }
  /** Oriente le ptérodactyle dans le sens de sa vitesse. */
  function orienter(p, vitesse, dt) {
    const h = Math.hypot(vitesse.x, vitesse.z);
    if (h > 0.5) {
      const cap = Math.atan2(vitesse.x, vitesse.z);
      p.objet.rotation.y += enveloppe(cap - p.objet.rotation.y) * Math.min(1, dt * 10);
    }
    const tangage = Math.atan2(-vitesse.y, Math.max(h, 1)) * 0.7;
    p.objet.rotation.x += (tangage - p.objet.rotation.x) * Math.min(1, dt * 6);
  }

  // horloge commune (envol des ptérodactyles qui repartent, eau qui coule)
  let tPrecedent = null;
  const tmp = new THREE.Vector3(), tmpV = new THREE.Vector3();
  function horloge(course) {
    const t = course.t;
    if (tPrecedent === t) return;
    const dt = tPrecedent === null ? 0 : Math.min(0.1, Math.max(0, t - tPrecedent));
    tPrecedent = t;
    texEau.offset.y -= dt * 0.6;
    texCascade.offset.y += dt * 1.4;
    megalo.etape(dt);
    for (const p of reserve) {
      if (!p.depart) continue;
      const d = p.depart;
      d.t += dt;
      const u = Math.min(1, d.t / d.duree);
      bezier(d.a, d.b, d.c, d.d, u, tmp);
      p.objet.position.copy(tmp);
      orienter(p, bezierDerivee(d.a, d.b, d.c, d.d, u, tmpV), dt);
      p.battre(dt, u < 0.3 ? "bat" : "plane"); // libéré du kart, il plane vers le ciel
      if (u >= 1) {
        p.depart = null;
        p.libre = true;
        p.objet.visible = false;
      }
    }
  }

  /** Le kart est-il au-dessus du vide ? */
  function dansLeVide(ph) {
    if ((ph.indice - ib + 6 + N) % N > nbVide + 12) return false;
    const sE = (ph.x - cE.x) * tE.x + (ph.z - cE.z) * tE.z;
    const sF = (ph.x - cF.x) * tF.x + (ph.z - cF.z) * tF.z;
    return sE >= 0 && sF < 0;
  }

  /** Garde indice / tour cohérents (même règle que la physique). */
  function suivre(ph) {
    const ancien = ph.indice;
    const loc = piste.localiser(ph.x, ph.z, ph.indice);
    ph.indice = loc.indice;
    ph.lateral = loc.lateral;
    if (ancien >= 0) {
      if (ancien > N * 0.8 && ph.indice < N * 0.2) ph.tour++;
      else if (ancien < N * 0.2 && ph.indice > N * 0.8) ph.tour--;
    }
  }

  /** Coordonnées (s, l) du ravin pour un point du monde (repère du bord). */
  const versRavin = (x, z) => [(x - cE.x) * tE.x + (z - cE.z) * tE.z, (x - cE.x) * nE.x + (z - cE.z) * nE.z];

  function scenario(k) {
    const ph = k.phys;
    const ptero = prendrePtero();
    const T1 = RAVIN.chute, T2 = RAVIN.vol, g = RAVIN.pesanteur;
    const haut = new THREE.Vector3(0, 1, 0);
    const vEntree = Math.abs(ph.vitesse);
    const vSortie = Math.max(14, Math.min(22, vEntree));
    const a0 = ph.angle;
    const v0 = Math.max(8, vEntree) * (ph.vitesse < 0 ? -1 : 1);
    const depart = new THREE.Vector3(ph.x, ph.y, ph.z);
    const vy0 = ph.enLair ? ph.vy : 0;
    // où le kart sera attrapé : dans le ravin, entre les parois
    let [sG, lG] = versRavin(ph.x + Math.sin(a0) * v0 * T1, ph.z + Math.cos(a0) * v0 * T1);
    sG = Math.max(2, Math.min(W - 4, sG));
    lG = Math.max(-13, Math.min(13, lG));
    const G = monde(sG, lG);
    G.y = ph.y + vy0 * T1 - 0.5 * g * T1 * T1;
    // dépose : sur la route d'en face, pas trop au bord
    const latD = Math.max(-5.5, Math.min(5.5, lG));
    const D = new THREE.Vector3(piste.cx[id] + piste.nx[id] * latD, 1.0, piste.cz[id] + piste.nz[id] * latD);
    const avant = new THREE.Vector3(piste.tx[ib], 0, piste.tz[ib]), avantD = new THREE.Vector3(piste.tx[id], 0, piste.tz[id]);
    const cote = new THREE.Vector3(-avant.z, 0, avant.x).multiplyScalar(lG >= 0 ? 1 : -1);
    // trajet des pattes (= haut du kart) : le vol porté...
    const P0 = G.clone().addScaledVector(haut, RAVIN.accroche);
    const P3 = D.clone().addScaledVector(haut, RAVIN.accroche);
    const C1 = P0.clone().addScaledVector(avant, 12).addScaledVector(haut, 7);
    const C2 = P3.clone().addScaledVector(avantD, -(vSortie * T2) / 3).addScaledVector(haut, 5);
    // ... et l'arrivée en piqué, de haut derrière, raccordée en douceur au vol porté
    const S = P0.clone().addScaledVector(avant, -20).addScaledVector(haut, 17).addScaledVector(cote, 7);
    const Cs1 = S.clone().addScaledVector(avant, 7).addScaledVector(haut, -3);
    const Cs2 = P0.clone().sub(C1.clone().sub(P0).multiplyScalar(T1 / T2));
    ptero.objet.position.copy(S);
    ptero.objet.rotation.set(0.4, Math.atan2(avant.x, avant.z), 0, "YXZ");

    let t = 0, attrape = false;
    const tmpP = new THREE.Vector3(), tmpD = new THREE.Vector3();
    k.modele.ombre.visible = false;
    ph.enLair = true;
    ph.ySol = -H;
    ph.poussee.x = ph.poussee.z = 0;
    if (k.joueur) cri();

    // le mégalodon (joueur seulement) : il jaillit de la rivière (large de 26 m, au milieu du ravin)
    // devant le kart, un peu sur le côté, et claque quand le kart arrive à sa hauteur
    let requin = null;
    if (k.joueur) {
      const uS = 0.32; // (fraction du vol porté)
      const K = bezier(P0, C1, C2, P3, uS, new THREE.Vector3());
      const [sK, lK] = versRavin(K.x, K.z);
      const sigma = lK > 6 ? -1 : 1; // du côté où il y a le plus de place (jamais contre la paroi)
      const sR = Math.max(R - 11, Math.min(R + 11, sK + MEGALO.devant)); // (au-dessus de la rivière)
      const sommet = monde(sR, lK + sigma * MEGALO.cote);
      sommet.y = K.y - RAVIN.accroche - MEGALO.dessous;
      requin = { tS: T1 + uS * T2, sommet, lat: nE.clone().multiplyScalar(sigma), lance: false };
    }

    return {
      etape(dt) {
        t += dt;
        if (t < T1) {
          // le kart tombe dans le vide, le ptérodactyle pique vers lui
          const u = t / T1;
          ph.x = depart.x + (G.x - depart.x) * u;
          ph.z = depart.z + (G.z - depart.z) * u;
          ph.y = depart.y + vy0 * t - 0.5 * g * t * t;
          ph.vy = vy0 - g * t;
          bezier(S, Cs1, Cs2, P0, u, tmpP);
          ptero.objet.position.copy(tmpP);
          orienter(ptero, bezierDerivee(S, Cs1, Cs2, P0, u, tmpD), dt);
          ptero.battre(dt, u < 0.75 ? "pique" : "plane");
        } else {
          if (!attrape) {
            attrape = true;
            if (k.joueur) cri();
          }
          // attrapé ! on traverse le ravin
          const u = Math.min(1, (t - T1) / T2);
          bezier(P0, C1, C2, P3, u, tmpP);
          bezierDerivee(P0, C1, C2, P3, u, tmpD).multiplyScalar(1 / T2);
          ptero.objet.position.copy(tmpP);
          orienter(ptero, tmpD, dt);
          ptero.battre(dt, "bat");
          ph.x = tmpP.x;
          ph.z = tmpP.z;
          ph.y = tmpP.y - RAVIN.accroche;
          ph.vy = tmpD.y;
          ph.angle = a0 + enveloppe(Math.atan2(avantD.x, avantD.z) - a0) * lisse(u * 1.5);
        }
        ph.vitesse = Math.hypot(ph.x - (ph.xAvant ?? ph.x), ph.z - (ph.zAvant ?? ph.z)) / Math.max(dt, 1e-4);
        if (!(ph.vitesse < 40)) ph.vitesse = vSortie;
        ph.xAvant = ph.x;
        ph.zAvant = ph.z;
        suivre(ph);
        if (requin && !requin.lance && t >= requin.tS - MEGALO.montee) {
          requin.lance = true;
          megalo.lancer({ sommet: requin.sommet, lat: requin.lat, dans: requin.tS - t });
        }
        horloge(coursePourHorloge);
        if (t < DUREE) return false;

        // on lâche le kart juste au-dessus de la route : la physique reprend
        const loc = piste.localiser(D.x, D.z, ph.indice);
        ph.x = D.x;
        ph.z = D.z;
        suivre(ph);
        ph.lateral = loc.lateral;
        ph.y = 1.0;
        ph.vy = -3;
        ph.enLair = true;
        ph.ySol = 0;
        ph.solAvant = "sol";
        ph.dansHerbe = false;
        ph.angle = Math.atan2(avantD.x, avantD.z);
        ph.vitesse = vSortie;
        ph.direction = 0;
        ph.pente = 0;
        ph.poussee.x = ph.poussee.z = 0;
        ph.tempsCoince = ph.tempsContresens = 0;
        ph.xAvant = ph.x;
        ph.zAvant = ph.z;
        k.modele.ombre.visible = true;
        k.modele.corps.rotation.x = 0;
        // le ptérodactyle repart vers le ciel
        const fin = P3.clone().addScaledVector(avantD, 45).addScaledVector(haut, 32).addScaledVector(cote, 22);
        ptero.depart = {
          t: 0, duree: 2.6, a: P3.clone(), b: P3.clone().sub(C2).add(P3),
          c: P3.clone().addScaledVector(avantD, 28).addScaledVector(haut, 14).addScaledVector(cote, 6), d: fin,
        };
        return true;
      },
      visuel(k) {
        const m = k.modele;
        if (t < T1) m.corps.rotation.x = 0.35 * (t / T1); // le nez plonge
        else m.corps.rotation.x = Math.sin((t - T1) * 4) * 0.08; // il se balance sous le ptérodactyle
        m.corps.rotation.z = Math.sin((t - T1) * 3) * 0.05;
      },
      camera(cam, dt) {
        // caméra normale, un peu reculée et relevée pour voir le ptérodactyle (sans à-coup au début ni à la fin)
        cam.update(dt, ph.x, ph.z, ph.angle, Math.min(1, ph.vitesse / 24), ph.y);
        const w = lisse(t / 0.45) * lisse((DUREE - t) / 0.9);
        if (w <= 0) return true;
        const dx = Math.sin(cam.angle), dz = Math.cos(cam.angle);
        const c = cam.camera;
        const releve = Math.max(2.5, 3 + (depart.y - cam.y) * 0.75);
        c.position.x -= dx * 5 * w;
        c.position.z -= dz * 5 * w;
        c.position.y += releve * w;
        c.lookAt(ph.x + dx * 3, 1.1 + cam.y + 1.8 * w, ph.z + dz * 3);
        return true;
      },
    };
  }

  let coursePourHorloge = { t: 0 };
  piste.passages.push({
    verifier(k, course) {
      coursePourHorloge = course;
      horloge(course);
      return dansLeVide(k.phys) ? scenario(k) : null;
    },
  });
  // (pour les essais)
  piste.ravin.dansLeVide = dansLeVide;
  piste.ravin.pteros = reserve;
  piste.ravin.megalo = megalo;
  return piste.ravin;
}
