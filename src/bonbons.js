import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Bonbons à ramasser : des rangées qui dessinent des lignes faciles à suivre (ligne droite
// sur les lignes droites, arc à l'intérieur des virages, quelques lignes sur le dos du
// diplodocus) et quelques-uns en l'air après les tremplins. Ils réapparaissent après un moment.

const COULEURS = [0xff5c7a, 0xffc93c, 0x5ad67d, 0x4cb3ff, 0xff8fd0, 0xa98bff, 0xff9548];
const REAPPARITION = 8; // secondes
const RAYON_PRISE = 1.7;
const ECHELLE = 1.6; // taille d'affichage
const HAUTEUR = 1.1; // centre du bonbon au-dessus de la route (ou du dos du diplodocus)
const ESPACE = 3.5; // mètres entre deux bonbons d'une rangée
const PAR_RANGEE = 5;
const ENTRE_RANGEES = 50; // mètres entre deux rangées
const DEMI_BONBON = 0.75 * ECHELLE; // demi-longueur (papillotes comprises) : il ne touche pas les rochers

// ---------------------------------------------------------------------------
// LA FORME DU BONBON : tout est ici.
// 1) formeBonbon() : le bonbon dessiné en code (ovale + papillotes), affiché tout de suite.
// 2) dès que public/bonbons/bonbons.glb est chargé (friandises du "Food Kit" de Kenney, CC0,
//    préparé par outils/blender/bonbons_kenney.py), on passe aux vraies friandises : une rangée
//    de sucettes, une de chocolats, une de beignets, une de cupcakes...
// La couleur de chaque bonbon est appliquée par instance (setColorAt) ; sur les friandises,
// seulement sur les parties "teinte" (sucre, papier, glaçage) : bâton, chocolat et pâte gardent
// leur couleur.
let geometrieBonbon = null;
export function formeBonbon() {
  if (!geometrieBonbon) {
    // corps : un ovale lisse
    const corps = new THREE.SphereGeometry(0.42, 11, 8).scale(1.3, 1, 1);
    const pieces = [corps];
    // papillotes : un petit cône évasé et plissé, tordu comme un vrai papier de bonbon
    for (const cote of [1, -1]) {
      const profil = [[0.13, 0], [0.07, 0.12], [0.2, 0.3], [0.33, 0.44]].map(([r, y]) => new THREE.Vector2(r, y));
      const g = new THREE.LatheGeometry(profil, 8);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
        const a = Math.atan2(z, x), t = y / 0.44;
        const pli = 1 + 0.22 * t * Math.cos(a * 4); // plis
        const r = Math.hypot(x, z) * pli, b = a + t * 0.9; // torsion
        p.setXYZ(k, Math.cos(b) * r, y, Math.sin(b) * r);
      }
      g.computeVertexNormals();
      g.rotateZ(-cote * Math.PI / 2).translate(cote * 0.5, 0, 0);
      pieces.push(g);
    }
    // couleur des sommets : papillotes un peu plus claires que le corps (multipliée par la couleur du bonbon)
    for (const [n, g] of pieces.entries()) {
      const c = n === 0 ? 1 : 0.82;
      g.deleteAttribute("uv");
      g.setAttribute("color", new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(c), 3));
    }
    geometrieBonbon = mergeGeometries(pieces.map((g) => (g.index ? g.toNonIndexed() : g)));
  }
  // papier brillant (reflet net) ; le matériau est neuf à chaque course (course.js le libère)
  const materiau = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x777777, side: THREE.DoubleSide });
  return { geometrie: geometrieBonbon, materiau };
}

// Les friandises de bonbons.glb : plus grande dimension à l'écran (mètres, pas plus que
// l'ancien bonbon : 2 × DEMI_BONBON) et inclinaison vers la caméra. Les rangées les prennent à tour de rôle.
const FRIANDISES = [
  { nom: "sucette", taille: 2.3, penche: 0.1 },
  { nom: "chocolat", taille: 1.8, penche: 0.35 },
  { nom: "beignet", taille: 1.8, penche: 0.15 },
  { nom: "cupcake", taille: 1.9, penche: 0.2 },
];

/** Géométrie position + normale + couleur (rgb) + "teinte" (1 = prend la couleur du bonbon). */
function preparer(mesh, teinte) {
  const src = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  const n = src.attributes.position.count, col = src.attributes.color, rgb = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    rgb[k * 3] = col ? col.getX(k) : 1;
    rgb[k * 3 + 1] = col ? col.getY(k) : 1;
    rgb[k * 3 + 2] = col ? col.getZ(k) : 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", src.attributes.position);
  g.setAttribute("normal", src.attributes.normal);
  g.setAttribute("color", new THREE.BufferAttribute(rgb, 3));
  g.setAttribute("teinte", new THREE.BufferAttribute(new Float32Array(n).fill(teinte), 1));
  if (src.index) g.setIndex(src.index);
  return g.index ? g.toNonIndexed() : g;
}

let chargement = null; // promesse partagée : le fichier n'est chargé qu'une fois
let friandises = null; // { materiau, modeles } une fois prêt (gardé d'une course à l'autre)
/** Charge bonbons.glb : { materiau, modeles: [{ nom, taille, penche, geometrie }] }, ou null si raté. */
function chargerFriandises() {
  chargement ??= new GLTFLoader()
    .loadAsync(import.meta.env.BASE_URL + "bonbons/bonbons.glb")
    .then((gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const modeles = [];
      for (const f of FRIANDISES) {
        const parties = [["teinte", 1], ["fixe", 0]]
          .map(([p, t]) => [gltf.scene.getObjectByName(f.nom + "_" + p), t])
          .filter(([o]) => o?.isMesh)
          .map(([o, t]) => preparer(o, t));
        if (!parties.length) continue;
        const geometrie = mergeGeometries(parties);
        geometrie.computeBoundingBox();
        const b = geometrie.boundingBox;
        modeles.push({ ...f, geometrie, demiHauteur: ((b.max.y - b.min.y) / 2) * f.taille });
      }
      // papier brillant ; seules les parties "teinte" prennent la couleur de l'instance
      const materiau = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x666666 });
      materiau.userData.partage = true;
      materiau.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace("#include <color_pars_vertex>", "#include <color_pars_vertex>\nattribute float teinte;")
          .replace("#include <color_vertex>", THREE.ShaderChunk.color_vertex
            .replace("vColor.xyz *= instanceColor.xyz;", "vColor.xyz *= mix( vec3( 1.0 ), instanceColor.xyz, teinte );"));
      };
      materiau.customProgramCacheKey = () => "bonbon-teinte";
      friandises = modeles.length ? { materiau, modeles } : null;
      return friandises;
    })
    .catch((e) => {
      console.warn("bonbons.glb non chargé : on garde les bonbons dessinés en code", e);
      return null;
    });
  return chargement;
}
chargerFriandises(); // dès le démarrage du jeu, pour être prêt avant la première course

// ---------------------------------------------------------------------------
/**
 * Où poser les bonbons : liste de { i (échantillon), lat (décalage latéral) } sur la route,
 * et de { x, y, z } en l'air. Évite la grille de départ, le looping, le ravin, le tremplin et
 * la tête du T-rex, et reste entre les rochers des entonnoirs.
 */
function placerBonbons(P) {
  const N = P.N, pas = P.pas;
  const m = (metres) => Math.round(metres / pas);
  const dans = (i, debut, fin) => ((i - debut + N) % N) <= ((fin - debut + N) % N);
  // zones interdites (échantillons)
  const interdits = [[N - m(32), m(14)]]; // grille de départ et ligne d'arrivée
  for (const t of P.trous ?? []) interdits.push([t.debut - m(12), t.fin + m(8)]);
  if (P.ravin) interdits.push([P.ravin.debut - m(12), P.ravin.depose + m(6)]);
  if (P.looping) interdits.push([P.looping.prise - m(6), P.looping.rendu + m(6)]);
  for (const t of P.tremplins) interdits.push([t.debut - m(4), t.debut + t.nb + m(6)]);
  if (P.teteTrex) interdits.push([P.teteTrex.indice - m(30), P.teteTrex.recrache + m(10)]);
  const D = P.diplodocus;
  if (D) interdits.push([D.indice - m(4), D.fin + m(6)]); // lignes spéciales, plus bas
  const libre = (i) => !interdits.some(([a, b]) => dans(i, (a + N) % N, (b + N) % N));

  // côté intérieur du virage (+1 / -1) et courbure (rad/m) autour de i
  const virage = (i) => {
    const a = (i - m(6) + N) % N, b = (i + m(6)) % N;
    const dtx = P.tx[b] - P.tx[a], dtz = P.tz[b] - P.tz[a];
    const k = Math.hypot(dtx, dtz) / (m(12) * pas);
    return { k, interieur: Math.sign(dtx * P.nx[i] + dtz * P.nz[i]) || 1 };
  };
  /** Reste sur la partie où l'on roule, sans toucher les rochers ni les plots. */
  const borner = (i, lat) => {
    const lim = Math.max(0, Math.min(P.demi - 1.2, P.limiteLaterale(i) - DEMI_BONBON - 0.4));
    return Math.max(-lim, Math.min(lim, lat));
  };

  const sol = [];
  const lignesDroites = [
    (u) => 0, // ligne au milieu
    (u) => -3.5 + 7 * u, // diagonale douce d'un bord à l'autre
    (u) => 3.5, // ligne à droite
    (u) => Math.sin(u * Math.PI * 2) * 3, // petite vague
    (u) => -3.5, // ligne à gauche
  ];
  const nb = m(ESPACE), long = (PAR_RANGEE - 1) * nb;
  let n = 0;
  for (let debut = m(16); debut < N - m(32); ) {
    // la rangée entière doit être libre
    let ok = true;
    for (let k = 0; k <= long; k++) if (!libre((debut + k) % N)) { ok = false; break; }
    if (!ok) { debut += m(4); continue; }
    const milieu = (debut + Math.round(long / 2)) % N;
    const v = virage(milieu);
    for (let k = 0; k < PAR_RANGEE; k++) {
      const i = (debut + k * nb) % N, u = k / (PAR_RANGEE - 1);
      // virage : un arc à l'intérieur (ou au milieu, une fois sur deux) ; ligne droite : un motif
      const lat = v.k > 1 / 70 ? v.interieur * (n % 2 ? 1.5 : 3.8) : lignesDroites[n % lignesDroites.length](u);
      sol.push({ i, lat: borner(i, lat) });
    }
    n++;
    debut += long + m(ENTRE_RANGEES);
  }

  // dos du diplodocus : trois petites lignes au milieu de la voie (cou, dos en vague, queue)
  if (D) {
    const nbDos = (D.fin - D.indice + N) % N;
    const ligne = (u0, u1, nombre, motif) => {
      for (let k = 0; k < nombre; k++) {
        const u = u0 + ((u1 - u0) * k) / (nombre - 1);
        const i = (D.indice + Math.round(nbDos * u)) % N;
        sol.push({ i, lat: borner(i, motif(k / (nombre - 1))) });
      }
    };
    ligne(0.1, 0.24, 5, () => 0);
    ligne(0.4, 0.58, 7, (u) => Math.sin(u * Math.PI * 2) * 1.8);
    ligne(0.72, 0.88, 5, () => 0);
  }

  // bonus en l'air, juste après chaque tremplin (on les attrape en sautant)
  const air = [];
  for (const t of P.tremplins) {
    for (const [d, y] of [[3, 2.3], [6, 2.7]]) {
      const i = (t.debut + t.nb + m(d)) % N;
      if (P.trous?.some((tr) => dans(i, tr.debut, tr.fin))) continue;
      air.push({ x: P.cx[i] + P.nx[i] * t.lateral, y, z: P.cz[i] + P.nz[i] * t.lateral });
    }
  }
  return { sol, air };
}

export class Bonbons {
  constructor(scene, piste) {
    this.piste = piste;
    const P = piste;
    const { sol, air } = placerBonbons(P);
    this.liste = [
      ...sol.map(({ i, lat }) => ({ x: P.cx[i] + P.nx[i] * lat, y: HAUTEUR, z: P.cz[i] + P.nz[i] * lat, i, lat, dy: HAUTEUR, attente: 0 })),
      ...air.map((p) => ({ ...p, attente: 0 })),
    ];
    const { geometrie, materiau } = formeBonbon();
    this.mesh = new THREE.InstancedMesh(geometrie, materiau, Math.max(1, this.liste.length));
    this.mesh.count = this.liste.length;
    const c = new THREE.Color();
    this.liste.forEach((b, i) => this.mesh.setColorAt(i, c.set(COULEURS[i % COULEURS.length])));
    scene.add(this.mesh);
    this.o = new THREE.Object3D();
    this.t = 0;
    this.nbSurfaces = -1;
    // les friandises Kenney remplacent le bonbon dessiné en code dès qu'elles sont chargées
    this.scene = scene;
    this.friandises = null; // [{ mesh, modele }]
    if (friandises) this.passerAuxFriandises(friandises);
    else chargerFriandises().then((r) => r && !this.friandises && this.passerAuxFriandises(r));
  }

  /** Remplace le bonbon dessiné en code par les friandises Kenney (une InstancedMesh par modèle, une rangée chacune). */
  passerAuxFriandises({ materiau, modeles }) {
    const nb = modeles.map(() => 0);
    this.liste.forEach((b, i) => {
      b.modele = Math.floor(i / PAR_RANGEE) % modeles.length;
      b.place = nb[b.modele]++;
    });
    this.friandises = modeles.map((m, k) => {
      const mesh = new THREE.InstancedMesh(m.geometrie, materiau, Math.max(1, nb[k]));
      mesh.count = nb[k];
      mesh.frustumCulled = false; // les bonbons bougent : pas de sphère englobante figée
      return { mesh, modele: m };
    });
    const c = new THREE.Color();
    this.liste.forEach((b, i) => this.friandises[b.modele].mesh.setColorAt(b.place, c.set(COULEURS[i % COULEURS.length])));
    this.mesh.visible = false; // l'ancien bonbon reste dans la scène (course.js libère son matériau), caché
    this.majMatrices();
    for (const f of this.friandises) this.scene.add(f.mesh);
  }

  /** Bonbons posés sur la route : à la hauteur du sol (ex. le dos du diplodocus, chargé après coup). */
  suivreLeSol() {
    const P = this.piste;
    this.nbSurfaces = P.surfaces.length;
    for (const b of this.liste) if (b.i !== undefined) b.y = b.dy + P.hauteurTremplin(b.i, b.lat).h;
  }

  /** Anime les bonbons et renvoie combien le kart (phys) vient d'en ramasser. */
  update(dt, phys) {
    this.t += dt;
    if (this.piste.surfaces.length !== this.nbSurfaces) this.suivreLeSol();
    let pris = 0;
    for (const b of this.liste) {
      if (b.attente > 0) {
        b.attente -= dt;
      } else if (phys) {
        const dx = b.x - phys.x, dz = b.z - phys.z, dy = b.y - (phys.y + 0.9);
        if (dx * dx + dz * dz < RAYON_PRISE * RAYON_PRISE && Math.abs(dy) < 1.4) {
          b.attente = REAPPARITION;
          pris++;
        }
      }
    }
    this.majMatrices();
    return pris;
  }

  /** Place chaque bonbon : petit balancement et rotation lente (légèrement décalés le long de la ligne). */
  majMatrices() {
    const o = this.o;
    this.liste.forEach((b, i) => {
      const f = this.friandises?.[b.modele];
      // une grande friandise posée sur la route est un peu levée pour ne pas y toucher
      const leve = f && b.dy !== undefined ? Math.max(0, f.modele.demiHauteur + 0.2 - b.dy) : 0;
      o.position.set(b.x, b.y + leve + Math.sin(this.t * 2.4 + i * 0.7) * 0.12, b.z);
      o.rotation.set(f ? f.modele.penche : 0.25, this.t * 1.8 + i * 0.5, 0);
      // caché pendant qu'il attend de réapparaître
      o.scale.setScalar(b.attente > 0 ? 0.0001 : f ? f.modele.taille : ECHELLE);
      o.updateMatrix();
      if (f) f.mesh.setMatrixAt(b.place, o.matrix);
      else this.mesh.setMatrixAt(i, o.matrix);
    });
    if (this.friandises) for (const f of this.friandises) f.mesh.instanceMatrix.needsUpdate = true;
    else this.mesh.instanceMatrix.needsUpdate = true;
  }
}
