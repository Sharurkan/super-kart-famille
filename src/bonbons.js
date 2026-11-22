import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

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
// LA FORME DU BONBON : tout est ici. Pour un modèle GLB plus tard, il suffit que cette
// fonction renvoie { geometrie, materiau } (une seule géométrie, longueur ~1,5 le long de x,
// centrée sur 0) : la couleur de chaque bonbon est appliquée par instance (setColorAt).
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
    const o = this.o;
    this.liste.forEach((b, i) => {
      if (b.attente > 0) {
        b.attente -= dt;
      } else if (phys) {
        const dx = b.x - phys.x, dz = b.z - phys.z, dy = b.y - (phys.y + 0.9);
        if (dx * dx + dz * dz < RAYON_PRISE * RAYON_PRISE && Math.abs(dy) < 1.4) {
          b.attente = REAPPARITION;
          pris++;
        }
      }
      const s = b.attente > 0 ? 0.0001 : ECHELLE; // caché pendant qu'il attend de réapparaître
      // petit balancement et rotation lente (tous ensemble, légèrement décalés le long de la ligne)
      o.position.set(b.x, b.y + Math.sin(this.t * 2.4 + i * 0.7) * 0.12, b.z);
      o.rotation.set(0.25, this.t * 1.8 + i * 0.5, 0);
      o.scale.setScalar(s);
      o.updateMatrix();
      this.mesh.setMatrixAt(i, o.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    return pris;
  }
}
