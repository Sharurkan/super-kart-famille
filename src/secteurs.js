import * as THREE from "three";

// Découpage des grandes InstancedMesh fixes (plantes, rochers, forêt d'imposteurs) en tronçons
// selon une grille au sol. Une InstancedMesh couvrant tout le circuit est toujours envoyée en
// entier à la carte graphique ; découpée, three.js écarte tout seul les tronçons hors champ, et
// portee() masque ceux qui sont entièrement noyés dans le brouillard (derrière scene.fog.far).
// Les tronçons sont ajoutés directement au groupe (ptero.js parcourt groupe.children pour vider
// le ravin). Uniquement pour des instances qui ne bougent plus.

const TAILLE = 140; // côté d'une case de la grille (m)
const MIN_PAR_TRONCON = 30; // en dessous, on regroupe sur une grille plus large (moins d'appels de dessin)

/** Ajoute im au groupe, découpée en tronçons si elle s'étend sur plusieurs cases. */
export function ajouterDecoupe(groupe, im) {
  const n = im.count, m4 = new THREE.Matrix4();
  const xz = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    im.getMatrixAt(i, m4);
    xz[i * 2] = m4.elements[12];
    xz[i * 2 + 1] = m4.elements[14];
  }
  // taille de case : plus large si les instances sont peu nombreuses
  let taille = TAILLE;
  let cases = grouper(xz, taille);
  while (cases.size > 1 && n / cases.size < MIN_PAR_TRONCON && taille < TAILLE * 8) cases = grouper(xz, (taille *= 2));
  if (cases.size <= 1) {
    im.computeBoundingSphere();
    im.frustumCulled = true;
    im.userData.secteur = true;
    groupe.add(im);
    return [im];
  }
  const geo = im.geometry, couleur = new THREE.Color(), troncons = [];
  for (const indices of cases.values()) {
    const g = new THREE.BufferGeometry();
    g.setIndex(geo.index);
    for (const [nom, a] of Object.entries(geo.attributes)) {
      if (!a.isInstancedBufferAttribute) g.setAttribute(nom, a);
      else {
        const t = new Float32Array(indices.length * a.itemSize);
        indices.forEach((i, k) => {
          for (let c = 0; c < a.itemSize; c++) t[k * a.itemSize + c] = a.array[i * a.itemSize + c];
        });
        g.setAttribute(nom, new THREE.InstancedBufferAttribute(t, a.itemSize));
      }
    }
    for (const gr of geo.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    g.boundingSphere = geo.boundingSphere ?? (geo.computeBoundingSphere(), geo.boundingSphere);
    g.boundingBox = geo.boundingBox;
    const t = new THREE.InstancedMesh(g, im.material, indices.length);
    t.name = im.name;
    t.userData = { ...im.userData, secteur: true };
    indices.forEach((i, k) => {
      im.getMatrixAt(i, m4);
      t.setMatrixAt(k, m4);
      if (im.instanceColor) {
        im.getColorAt(i, couleur);
        t.setColorAt(k, couleur);
      }
    });
    t.computeBoundingSphere();
    groupe.add(t);
    troncons.push(t);
  }
  return troncons;
}

function grouper(xz, taille) {
  const cases = new Map();
  for (let i = 0; i < xz.length / 2; i++) {
    const cle = Math.floor(xz[i * 2] / taille) + "," + Math.floor(xz[i * 2 + 1] / taille);
    let l = cases.get(cle);
    if (!l) cases.set(cle, (l = []));
    l.push(i);
  }
  return cases;
}

/**
 * Portée de vue : masque les tronçons entièrement derrière le brouillard (invisibles de toute
 * façon : ils auraient la couleur de l'horizon). À appeler à chaque image avant le rendu.
 */
export function creerPortee(scene) {
  let liste = [], image = 0;
  const centre = new THREE.Vector3();
  return function portee(camera) {
    if (image++ % 30 === 0) {
      // (des plantes arrivent après coup : chargement asynchrone des modèles)
      liste = [];
      scene.traverse((o) => {
        if (o.userData.secteur && [].concat(o.material).every((m) => m.fog !== false)) liste.push(o);
      });
    }
    const loin = scene.fog?.far ?? Infinity;
    for (const o of liste) {
      const s = o.boundingSphere;
      if (!s) continue;
      centre.copy(s.center).applyMatrix4(o.matrixWorld);
      const r = s.radius * o.matrixWorld.getMaxScaleOnAxis();
      o.visible = centre.distanceTo(camera.position) - r < loin;
    }
  };
}
