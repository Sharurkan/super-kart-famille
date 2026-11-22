import * as THREE from "three";
import { textureAsphalte, textureDamier } from "./textures.js";

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

  // ---------- Barrières (murs bas, rebond doux) ----------
  {
    const pos = [], col = [];
    const c0 = new THREE.Color(def.barriere[0]), c1 = new THREE.Color(def.barriere[1]);
    const h = 0.9, ep = 0.7;
    for (const cote of [1, -1]) {
      const oi = cote * (demi + marge), oe = cote * (demi + marge + ep);
      for (let k = 0; k < N; k++) {
        const i = k, j = (k + 1) % N;
        const p = (o, n, y) => [cx[n] + nx[n] * o, y, cz[n] + nz[n] * o];
        const c = Math.floor(k / 3) % 2 ? c1 : c0;
        const faces = [
          // face intérieure
          [p(oi, i, 0), p(oi, i, h), p(oi, j, 0)], [p(oi, i, h), p(oi, j, h), p(oi, j, 0)],
          // dessus
          [p(oi, i, h), p(oe, i, h), p(oi, j, h)], [p(oe, i, h), p(oe, j, h), p(oi, j, h)],
          // face extérieure
          [p(oe, i, 0), p(oe, j, 0), p(oe, i, h)], [p(oe, i, h), p(oe, j, 0), p(oe, j, h)],
        ];
        for (const t of faces) {
          const tri = cote > 0 ? t : [t[0], t[2], t[1]];
          for (const q of tri) {
            pos.push(...q);
            col.push(c.r, c.g, c.b);
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    groupe.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
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
    return { indice: i, lateral };
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

  return { groupe, N, L, pas, cx, cz, tx, tz, nx, nz, demi, marge, localiser, distanceCentre, angleA, centre, rayon };
}
