import * as THREE from "three";
import { textureAsphalte, textureDamier, textureChevrons } from "./textures.js";

/**
 * Construit la piste (route, bordures, barrières, ligne d'arrivée) à partir
 * de la ligne centrale du circuit, et fournit les fonctions pour savoir
 * où se trouve un kart par rapport à la piste.
 *
 * Convention : "lateral" > 0 = côté gauche de la route (sens de la course).
 */
export function construirePiste(def) {
  const e = def.echelle ?? 1;
  const [dx0, dz0] = def.decalage ?? [0, 0]; // pour placer un circuit ailleurs (circuit déplacé)
  const pts = def.points.map(([x, z]) => new THREE.Vector3(x * e + dx0, 0, z * e + dz0));
  const courbe = new THREE.CatmullRomCurve3(pts, true, "centripetal");
  const N = def.echantillons ?? 600;
  const brut = courbe.getSpacedPoints(N);
  brut.pop();
  const L = courbe.getLength();
  const pas = L / N;

  const cx = new Float32Array(N), cz = new Float32Array(N);
  const tx = new Float32Array(N), tz = new Float32Array(N);
  const nx = new Float32Array(N), nz = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    cx[i] = brut[i].x;
    cz[i] = brut[i].z;
  }
  for (let i = 0; i < N; i++) {
    const a = (i + 1) % N, b = (i - 1 + N) % N;
    const dx = cx[a] - cx[b], dz = cz[a] - cz[b];
    const l = Math.hypot(dx, dz);
    tx[i] = dx / l;
    tz[i] = dz / l;
    nx[i] = tz[i];
    nz[i] = -tx[i];
  }

  // courbure (rad/m, > 0 = virage à gauche) : sert au dévers (voir deversA)
  const courbureRoute = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + 1) % N, b = (i - 1 + N) % N;
    courbureRoute[i] = ((tx[a] - tx[b]) * nx[i] + (tz[a] - tz[b]) * nz[i]) / (2 * pas);
  }

  const demi = def.largeur / 2;
  const marge = def.marge ?? 6;
  const groupe = new THREE.Group();
  const morceaux = []; // route, bordures, barrières : sommets rangés par échantillon (voir trouer)

  // ---------- Route ----------
  {
    const pos = [], uv = [], nor = [], idx = [];
    for (let k = 0; k <= N; k++) {
      const i = k % N;
      const v = (k * pas) / 18;
      pos.push(cx[i] + nx[i] * demi, 0.02, cz[i] + nz[i] * demi);
      pos.push(cx[i] - nx[i] * demi, 0.02, cz[i] - nz[i] * demi);
      uv.push(0, v, 1, v);
      nor.push(0, 1, 0, 0, 1, 0);
    }
    for (let k = 0; k < N; k++) {
      const a = 2 * k, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    morceaux.push({ g, parEchantillon: 6, cotes: 1 });
    groupe.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: textureAsphalte(), color: def.route ?? 0xffffff })));
  }

  // ---------- Bordures rouges et blanches ----------
  {
    const pos = [], col = [], nor = [];
    const c0 = new THREE.Color(def.bordure[0]), c1 = new THREE.Color(def.bordure[1]);
    for (const cote of [1, -1]) {
      const o1 = cote * demi, o2 = cote * (demi + 1.4);
      for (let k = 0; k < N; k++) {
        const i = k, j = (k + 1) % N;
        const p = (o, n) => [cx[n] + nx[n] * o, 0.03, cz[n] + nz[n] * o];
        let quad = [p(o1, i), p(o2, i), p(o1, j), p(o2, i), p(o2, j), p(o1, j)];
        if (cote > 0) quad = [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]]; // face vers le haut des deux côtés
        const c = (k >> 1) % 2 ? c1 : c0;
        for (const q of quad) {
          pos.push(...q);
          col.push(c.r, c.g, c.b);
          nor.push(0, 1, 0);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    morceaux.push({ g, parEchantillon: 6, cotes: 2 });
    groupe.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }

  // ---------- Barrières (boudins arrondis, rebond doux) ----------
  {
    const pos = [], col = [], nor = [];
    const c0 = new THREE.Color(def.barriere[0]), c1 = new THREE.Color(def.barriere[1]);
    // profil en coupe : (décalage vers l'extérieur, hauteur), du pied intérieur au pied extérieur
    const profil = [[0, 0], [0, 0.45]];
    for (let k = 1; k <= 6; k++) {
      const a = Math.PI - (k / 6) * Math.PI; // demi-cercle sur le dessus
      profil.push([0.38 + Math.cos(a) * 0.38, 0.45 + Math.sin(a) * 0.42]);
    }
    profil.push([0.76, 0]);
    // normale de chaque point du profil (moyenne des deux segments voisins)
    const normales = profil.map((_, k) => {
      let nl = 0, ny = 0;
      for (const [u, v] of [[k - 1, k], [k, k + 1]]) {
        if (u < 0 || v >= profil.length) continue;
        const dl = profil[v][0] - profil[u][0], dy = profil[v][1] - profil[u][1];
        const l = Math.hypot(dl, dy);
        nl += dy / l;
        ny += -dl / l;
      }
      const l = Math.hypot(nl, ny);
      return [-nl / l, -ny / l];
    });
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    for (const cote of [1, -1]) {
      const base = demi + marge;
      for (let k = 0; k < N; k++) {
        const i = k, j = (k + 1) % N;
        const c = Math.floor(k / 3) % 2 ? c1 : c0;
        const pt = (n, q) => [cx[n] + nx[n] * cote * (base + profil[q][0]), profil[q][1], cz[n] + nz[n] * cote * (base + profil[q][0])];
        const nm = (n, q) => [nx[n] * cote * normales[q][0], normales[q][1], nz[n] * cote * normales[q][0]];
        for (let q = 0; q < profil.length - 1; q++) {
          const quad = [[i, q], [j, q], [i, q + 1], [j, q], [j, q + 1], [i, q + 1]];
          for (let t = 0; t < 6; t += 3) {
            let tri = quad.slice(t, t + 3);
            // on oriente le triangle pour que sa face avant regarde dans le sens de la normale
            const [A, B, C] = tri.map(([n, r]) => pt(n, r));
            v.set(B[0] - A[0], B[1] - A[1], B[2] - A[2]);
            w.set(C[0] - A[0], C[1] - A[1], C[2] - A[2]);
            v.cross(w);
            const N0 = nm(...tri[0]);
            if (v.x * N0[0] + v.y * N0[1] + v.z * N0[2] < 0) tri = [tri[0], tri[2], tri[1]];
            for (const [n, r] of tri) {
              pos.push(...pt(n, r));
              nor.push(...nm(n, r));
              col.push(c.r, c.g, c.b);
            }
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    morceaux.push({ g, parEchantillon: (profil.length - 1) * 6, cotes: 2 });
    groupe.add(new THREE.Mesh(g, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x333333 })));
  }

  // ---------- Ligne d'arrivée + portique ----------
  if (def.portique !== false) {
    const angle = Math.atan2(tx[0], tz[0]);
    const ligne = new THREE.Mesh(
      new THREE.PlaneGeometry(def.largeur, 2.6),
      new THREE.MeshLambertMaterial({ map: textureDamier(12, 2) })
    );
    ligne.rotation.set(-Math.PI / 2, angle, 0, "YXZ");
    ligne.position.set(cx[0], 0.04, cz[0]);
    groupe.add(ligne);

    const portique = new THREE.Group();
    const matPoteau = new THREE.MeshLambertMaterial({ color: 0xffffff });
    for (const s of [1, -1]) {
      const poteau = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 7, 8), matPoteau);
      poteau.position.set(s * (demi + 2), 3.5, 0);
      portique.add(poteau);
    }
    const banniere = new THREE.Mesh(
      new THREE.BoxGeometry(def.largeur + 4.7, 1.6, 0.4),
      new THREE.MeshLambertMaterial({ map: textureDamier(16, 2) })
    );
    banniere.position.y = 7;
    portique.add(banniere);
    portique.position.set(cx[0], 0, cz[0]);
    portique.rotation.y = angle;
    groupe.add(portique);
  }

  // ---------- Tremplins ----------
  // Placés automatiquement dans les lignes droites, en alternant gauche / droite / centre.
  const tremplins = [];
  {
    const courbure = (i) => Math.abs(Math.atan2(Math.sin(angleBrut((i + 15) % N) - angleBrut((i - 15 + N) % N)), Math.cos(angleBrut((i + 15) % N) - angleBrut((i - 15 + N) % N))));
    const nb = Math.max(1, Math.round(4.5 / pas)); // ~4,5 m de pente
    const cibles = def.tremplins ?? [0.12, 0.42, 0.72];
    const lateraux = [-4, 4, 0];
    const fenetre = def.tremplinsFenetre ?? 0.2; // jusqu'où on cherche autour de la position voulue (fraction du tour)
    cibles.forEach((f, n) => {
      // l'endroit le plus droit autour de la position voulue, loin de la grille et des autres tremplins
      let meilleur = -1, cMin = Infinity;
      for (let k = -Math.floor(N * fenetre); k <= N * fenetre; k++) {
        const i = (Math.round(f * N) + k + N) % N;
        if (i < 25 || i > N - 50) continue;
        if (tremplins.some((t) => Math.abs(t.debut - i) < 80)) continue;
        const c = courbure(i) + courbure((i + nb) % N) + Math.abs(k) * 0.0008;
        if (c < cMin) { cMin = c; meilleur = i; }
      }
      if (meilleur >= 0) tremplins.push({ debut: meilleur, nb, longueur: nb * pas, lateral: lateraux[n % 3], demiLargeur: 3.5, hauteur: 1.0 });
    });
  }
  for (const t of tremplins) groupe.add(meshTremplin(t));

  function angleBrut(i) {
    return Math.atan2(tx[i], tz[i]);
  }

  function meshTremplin(t) {
    const pos = [], uv = [];
    const pt = (k, o, y) => {
      const i = (t.debut + k) % N;
      return [cx[i] + nx[i] * (t.lateral + o), y, cz[i] + nz[i] * (t.lateral + o)];
    };
    const w = t.demiLargeur;
    const tri = (a, b, c, ua, ub, uc) => {
      pos.push(...a, ...b, ...c);
      uv.push(...ua, ...ub, ...uc);
    };
    for (let k = 0; k < t.nb; k++) {
      const h0 = 0.04 + (t.hauteur * k) / t.nb, h1 = 0.04 + (t.hauteur * (k + 1)) / t.nb;
      const v0 = k / t.nb, v1 = (k + 1) / t.nb;
      const a = pt(k, w, h0), b = pt(k, -w, h0), c = pt(k + 1, w, h1), d = pt(k + 1, -w, h1);
      tri(a, b, c, [0, v0], [1, v0], [0, v1]);
      tri(b, d, c, [1, v0], [1, v1], [0, v1]);
      // côtés
      for (const o of [w, -w]) {
        const p0 = pt(k, o, 0), p1 = pt(k + 1, o, 0), q0 = pt(k, o, h0), q1 = pt(k + 1, o, h1);
        tri(p0, q0, p1, [0, 0], [0, 0], [0, 0]);
        tri(q0, q1, p1, [0, 0], [0, 0], [0, 0]);
      }
    }
    // face arrière (verticale)
    const H = 0.04 + t.hauteur;
    const e = pt(t.nb, w, 0), f = pt(t.nb, -w, 0), g = pt(t.nb, w, H), h = pt(t.nb, -w, H);
    tri(e, f, g, [0, 0], [0, 0], [0, 0]);
    tri(f, h, g, [0, 0], [0, 0], [0, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: textureChevrons(), side: THREE.DoubleSide }));
  }

  /** Hauteur du sol (tremplin ou 0) à cet endroit, et pente pour incliner le kart. */
  // Surfaces "posées" sur la piste (ex. le dos du diplodocus) : grille de hauteurs
  // { debut, nb (échantillons), latMin, pasLat, nbLat, h: Float32Array(nb * nbLat) }
  const surfaces = [];
  // Zones que les adversaires évitent : { debut, fin, lateral, demi }
  const zonesIA = [];
  // Rétrécissements (entonnoir) : { debut, fin, demiMin } en échantillons
  const retrecissements = [];
  // Murs posés échantillon par échantillon (ex. les parois du ventre du T-rex) : demi-largeur max
  const largeurs = new Float32Array(N).fill(Infinity);
  /** Demi-largeur où l'on peut rouler à l'échantillon i : au plus demiMax (on garde la plus petite). */
  function limiter(i, demiMax) {
    const j = ((i % N) + N) % N;
    largeurs[j] = Math.min(largeurs[j], demiMax);
  }

  /** Demi-largeur où l'on peut rouler à cet endroit (jusqu'aux barrières ou à l'entonnoir). */
  function limiteLaterale(indice) {
    let lim = Math.min(demi + marge - 1.0, largeurs[indice] ?? Infinity);
    for (const r of retrecissements) {
      const k = (indice - r.debut + N) % N;
      const n = (r.fin - r.debut + N) % N;
      if (k > n) continue;
      const t = Math.min(1, k / (n * 0.7)); // se resserre sur 70 % de la longueur, puis reste étroit
      lim = Math.min(lim, (demi + marge - 1.0) * (1 - t) + r.demiMin * t);
    }
    return lim;
  }

  function ajouterTremplin(t) {
    t.longueur = t.nb * pas;
    tremplins.push(t);
    return meshTremplin(t);
  }

  /** Hauteur du sol à cet endroit, sa pente (pour incliner le kart) et son type. */
  function hauteurTremplin(indice, lateral, long = 0) {
    // virage relevé (voir incliner) : la hauteur dépend du décalage latéral
    if (devers) {
      const d = deversA(indice, long, lateral);
      if (d) {
        const t = hauteurTremplinPlat(indice, lateral, long);
        return { h: d.h + t.h, pente: t.type === "sol" ? Math.atan(d.along) : t.pente, type: t.type === "sol" ? "devers" : t.type, gLat: d.gLat };
      }
    }
    // relief de la route (voir abaisser) : tout ce qui est posé dessus suit sa hauteur
    if (profil) {
      const r = baseRelief(indice, long);
      if (r.h !== 0) {
        const t = hauteurTremplinPlat(indice, lateral, long);
        return { h: r.h + t.h, pente: t.type === "sol" ? r.pente : t.pente, type: t.type };
      }
    }
    return hauteurTremplinPlat(indice, lateral, long);
  }

  function hauteurTremplinPlat(indice, lateral, long) {
    for (const t of tremplins) {
      if (Math.abs(lateral - t.lateral) > t.demiLargeur) continue;
      const k = (indice - t.debut + N) % N;
      const d = k * pas + long;
      if (d >= 0 && d <= t.longueur) return { h: (t.hauteur * d) / t.longueur, pente: Math.atan(t.hauteur / t.longueur), type: "tremplin" };
    }
    for (const s of surfaces) {
      const u = ((indice - s.debut + N) % N) + long / pas; // position le long (en échantillons)
      const v = (lateral - s.latMin) / s.pasLat;
      if (u < 0 || u > s.nb - 1 || v < 0 || v > s.nbLat - 1) continue;
      const i0 = Math.floor(u), j0 = Math.floor(v);
      const i1 = Math.min(i0 + 1, s.nb - 1), j1 = Math.min(j0 + 1, s.nbLat - 1);
      const fu = u - i0, fv = v - j0;
      const H = (i, j) => s.h[i * s.nbLat + j];
      const h = (H(i0, j0) * (1 - fv) + H(i0, j1) * fv) * (1 - fu) + (H(i1, j0) * (1 - fv) + H(i1, j1) * fv) * fu;
      if (h <= 0.05) continue;
      const pente = Math.atan((H(i1, j0) - H(i0, j0)) / pas);
      return { h, pente, type: "surface" };
    }
    return { h: 0, pente: 0, type: "sol" };
  }

  // ---------- Requêtes ----------
  /** Trouve l'échantillon de piste le plus proche (recherche locale autour de "indice"). */
  function localiser(x, z, indice = -1) {
    let meilleur = 0, dMin = Infinity;
    if (indice < 0) {
      for (let i = 0; i < N; i++) {
        const d = (x - cx[i]) ** 2 + (z - cz[i]) ** 2;
        if (d < dMin) { dMin = d; meilleur = i; }
      }
    } else {
      for (let k = -40; k <= 40; k++) {
        const i = (indice + k + N) % N;
        const d = (x - cx[i]) ** 2 + (z - cz[i]) ** 2;
        if (d < dMin) { dMin = d; meilleur = i; }
      }
    }
    const i = meilleur;
    const lateral = (x - cx[i]) * nx[i] + (z - cz[i]) * nz[i];
    const long = (x - cx[i]) * tx[i] + (z - cz[i]) * tz[i]; // avance/recul par rapport à l'échantillon
    return { indice: i, lateral, long };
  }

  /** Distance approximative au centre de la piste (pour placer le décor). */
  function distanceCentre(x, z) {
    let dMin = Infinity;
    for (let i = 0; i < N; i += 2) {
      const d = (x - cx[i]) ** 2 + (z - cz[i]) ** 2;
      if (d < dMin) dMin = d;
    }
    return Math.sqrt(dMin);
  }

  const angleA = (i) => Math.atan2(tx[i], tz[i]);

  // ---------- Trous ----------
  // trouer(debut, fin) enlève la route, les bordures et les barrières des échantillons
  // debut..fin-1 (ex. le ravin du ptérodactyle : le décor dessine le vide dessous) en
  // aplatissant leurs triangles. piste.trous garde la liste (les bonbons l'évitent).
  const trous = [];
  function trouer(debut, fin) {
    effacer(debut, fin, morceaux);
    trous.push({ debut, fin });
  }
  /** Efface les triangles des morceaux choisis sur les échantillons debut..fin-1. */
  function effacer(debut, fin, choisis) {
    const n = (fin - debut + N) % N;
    for (const { g, parEchantillon, cotes } of choisis) {
      const idx = g.index?.array, pos = g.attributes.position.array;
      for (let c = 0; c < cotes; c++)
        for (let m = 0; m < n; m++) {
          const base = (c * N + ((debut + m) % N)) * parEchantillon;
          for (let v = base; v < base + parEchantillon; v += 3) {
            if (idx) idx[v + 1] = idx[v + 2] = idx[v];
            else for (const w of [v + 1, v + 2]) for (let a = 0; a < 3; a++) pos[w * 3 + a] = pos[v * 3 + a];
          }
        }
      if (idx) g.index.needsUpdate = true;
      else g.attributes.position.needsUpdate = true;
    }
  }
  /**
   * Cache la route et les bordures sur les échantillons debut..fin-1 (pas les barrières, et ce
   * n'est pas un trou : on roule toujours dessus) ; ex. le virage relevé dessine sa propre route.
   */
  function masquerRoute(debut, fin) {
    effacer(debut, fin, morceaux.slice(0, 2));
  }

  // ---------- Relief ----------
  // abaisser(debut, fin, hauteur) donne une hauteur à la route sur les échantillons debut..fin
  // (hauteur(m) pour m = 0..fin-debut, en mètres, négative = plus bas que le sol ; ex. la tranchée
  // de l'aquarium). La route, les bordures et les barrières descendent avec elle, et
  // hauteurTremplin (physique, bonbons) en tient compte. piste.profil = hauteur par échantillon
  // (null tant que la route est plate). Pentes douces (< ~20 %) : les karts restent collés à la
  // route qui descend (la physique ne s'envole qu'au-dessus de 0,35 m) et montent sans buter.
  // Pas de tremplin ni de surface sur une partie abaissée (leur envol suppose le sol à 0).
  let profil = null, yBase = null;
  function baseRelief(indice, long) {
    const u = indice + long / pas;
    const i = Math.floor(u), f = u - i;
    const a = profil[((i % N) + N) % N], b = profil[(((i + 1) % N) + N) % N];
    return { h: a + (b - a) * f, pente: Math.atan((b - a) / pas) };
  }
  function abaisser(debut, fin, hauteur) {
    profil ??= new Float32Array(N);
    const n = (fin - debut + N) % N;
    for (let m = 0; m <= n; m++) profil[(debut + m) % N] = hauteur(m);
    majSommets();
    api.profil = profil;
  }

  // ---------- Dévers (virage relevé) ----------
  // incliner(debut, fin, angle) penche la route sur les échantillons debut..fin : angle(m) en radians
  // pour m = 0..fin-debut, > 0 = le côté gauche (lateral > 0) monte, < 0 = le côté droit monte.
  // Le bord bas reste au sol, la route monte en ligne droite vers le bord haut (bordure comprise) :
  // h = tan|a| × (distance au bord bas). hauteurTremplin en tient compte (physique, bonbons) et
  // renvoie aussi gLat = dh/dlateral pour incliner le kart. piste.devers = angle par échantillon.
  let devers = null;
  const LARGE_DEVERS = 2 * demi + 1.4; // du bord bas jusqu'au bout de la bordure haute
  /** Hauteur due au dévers d'angle a, au décalage lat. */
  const hDevers = (a, lat) => (a === 0 ? 0 : Math.tan(Math.abs(a)) * Math.min(LARGE_DEVERS, Math.max(0, Math.sign(a) * lat + demi)));
  function incliner(debut, fin, angle) {
    devers ??= new Float32Array(N);
    const n = (fin - debut + N) % N;
    for (let m = 0; m <= n; m++) devers[(debut + m) % N] = angle(m);
    majSommets();
    api.devers = devers;
  }
  /** Dévers au point (indice, long, lateral) : { h, along (pente le long, en tangente), gLat } ou null. */
  function deversA(indice, long, lateral) {
    // avance le long de la route, corrigée dans les virages : à l'extérieur, un mètre compte moins
    // qu'au milieu (et plus à l'intérieur). Sans cela, la hauteur sauterait d'un échantillon au
    // suivant (~10 cm en haut du dévers) là où le dévers change.
    const ech = pas * (1 - lateral * courbureRoute[((indice % N) + N) % N]);
    const u = indice + long / ech;
    const i = Math.floor(u), f = u - i;
    const a0 = devers[((i % N) + N) % N], a1 = devers[(((i + 1) % N) + N) % N];
    if (a0 === 0 && a1 === 0) return null;
    const a = a0 + (a1 - a0) * f;
    const d = Math.sign(a) * lateral + demi;
    return {
      h: hDevers(a, lateral),
      along: (hDevers(a1, lateral) - hDevers(a0, lateral)) / ech,
      gLat: d > 0 && d < LARGE_DEVERS ? Math.sign(a) * Math.tan(Math.abs(a)) : 0,
    };
  }

  /** Recalcule la hauteur des sommets de la route, des bordures et des barrières (relief + dévers). */
  function majSommets() {
    // sommets : hauteur d'origine + relief de leur échantillon (retrouvé par l'ordre de construction)
    yBase ??= morceaux.map(({ g }) => Float32Array.from(g.attributes.position.array.filter((_, k) => k % 3 === 1)));
    const rel = (i) => (profil ? profil[i] : 0);
    const dev = (i, lat) => (devers && Math.abs(lat) < demi + 1.5 ? hDevers(devers[i], lat) : 0); // (pas les barrières)
    morceaux.forEach(({ g, parEchantillon, cotes }, n) => {
      const pos = g.attributes.position.array, y0 = yBase[n];
      if (g.index) {
        // route : 2 sommets par échantillon (k = 0..N, le dernier = le premier), bord gauche puis droit
        for (let v = 0; v < pos.length / 3; v++) {
          const i = (v >> 1) % N;
          pos[v * 3 + 1] = y0[v] + rel(i) + dev(i, v % 2 ? -demi : demi);
        }
      } else {
        // bordures, barrières : morceaux de parEchantillon sommets par segment k → k+1 ;
        // chaque sommet est sur l'échantillon k ou k+1 (on regarde s'il est devant ou derrière)
        for (let c = 0; c < cotes; c++)
          for (let k = 0; k < N; k++) {
            const base = (c * N + k) * parEchantillon;
            for (let v = base; v < base + parEchantillon; v++) {
              const lg = (pos[v * 3] - cx[k]) * tx[k] + (pos[v * 3 + 2] - cz[k]) * tz[k];
              const i = lg > pas / 2 ? (k + 1) % N : k;
              const lat = (pos[v * 3] - cx[i]) * nx[i] + (pos[v * 3 + 2] - cz[i]) * nz[i];
              pos[v * 3 + 1] = y0[v] + rel(i) + dev(i, lat);
            }
          }
      }
      g.attributes.position.needsUpdate = true;
      if (g.index && devers) g.computeVertexNormals(); // route penchée : la lumière suit la pente
      g.computeBoundingSphere();
      g.computeBoundingBox();
    });
  }

  // centre et rayon du circuit (pour le décor lointain)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, cx[i]); maxX = Math.max(maxX, cx[i]);
    minZ = Math.min(minZ, cz[i]); maxZ = Math.max(maxZ, cz[i]);
  }
  const centre = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const rayon = Math.hypot(maxX - minX, maxZ - minZ) / 2;

  const api = { groupe, N, L, pas, cx, cz, tx, tz, nx, nz, demi, marge, localiser, distanceCentre, angleA, centre, rayon, tremplins, hauteurTremplin, surfaces, zonesIA, ajouterTremplin, retrecissements, limiteLaterale, limiter, passages: [], trous, trouer, masquerRoute, courbure: courbureRoute, profil, abaisser, devers, incliner, hDevers };
  return api;
}
