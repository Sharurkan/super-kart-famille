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
  const pts = def.points.map(([x, z]) => new THREE.Vector3(x * e, 0, z * e));
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

  const demi = def.largeur / 2;
  const marge = def.marge ?? 6;
  const groupe = new THREE.Group();

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
    groupe.add(new THREE.Mesh(g, new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x333333 })));
  }

  // ---------- Ligne d'arrivée + portique ----------
  {
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
    cibles.forEach((f, n) => {
      // l'endroit le plus droit autour de la position voulue, loin de la grille et des autres tremplins
      let meilleur = -1, cMin = Infinity;
      for (let k = -Math.floor(N * 0.2); k <= N * 0.2; k++) {
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

  /** Demi-largeur où l'on peut rouler à cet endroit (jusqu'aux barrières ou à l'entonnoir). */
  function limiteLaterale(indice) {
    let lim = demi + marge - 1.0;
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

  // centre et rayon du circuit (pour le décor lointain)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    minX = Math.min(minX, cx[i]); maxX = Math.max(maxX, cx[i]);
    minZ = Math.min(minZ, cz[i]); maxZ = Math.max(maxZ, cz[i]);
  }
  const centre = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const rayon = Math.hypot(maxX - minX, maxZ - minZ) / 2;

  return { groupe, N, L, pas, cx, cz, tx, tz, nx, nz, demi, marge, localiser, distanceCentre, angleA, centre, rayon, tremplins, hauteurTremplin, surfaces, zonesIA, ajouterTremplin, retrecissements, limiteLaterale };
}
