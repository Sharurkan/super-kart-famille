import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { audio } from "./audio.js";
import { LAVE } from "./lave.js";

// Le geyser de lave du ravin (circuit dino, quand le monde est en lave : 3e tour) : il remplace le
// mégalodon. Une colonne de lave jaillit du lac de lave juste sous le kart qui tombe, monte jusqu'à
// lui au moment où le ptérodactyle l'attrape (sauvé de justesse !), projette des gerbes de lave
// tout autour, puis retombe.
// La gerbe : « Fire tornado » d'OPREXT (Sketchfab, CC-BY 4.0, voir CREDITS.txt ; textures WebP 512),
// public/dinos/geyser-lave.glb : trois nappes de flammes en spirale, fines en bas et évasées en haut,
// qu'on fait tournoyer (chacune à sa vitesse) et grandir avec le jet. En attendant le modèle (ou s'il
// manque), une colonne simple avec la lave du monde en lave (public/lave/lave.jpg, ambientCG, CC0).

export const GEYSER = {
  montee: 0.55, // s : de la surface jusqu'au sommet (sous le kart)
  tenue: 0.35, // s au sommet
  descente: 0.9, // s pour retomber
  rayon: 2.4, // m : rayon de la colonne en haut (plus large en bas)
  largeur: 6.5, // × le modèle en largeur (2,1 m) : gerbe de ~14 m de large en haut
};
const MODELE = { centreX: 0.42, bas: -1.23, hauteur: 3.15 }; // (mesuré sur geyser-lave.glb)

let promesse = null;
function chargerGerbe() {
  promesse ??= new GLTFLoader()
    .loadAsync(`${import.meta.env.BASE_URL}dinos/geyser-lave.glb`)
    .catch((e) => {
      console.warn("geyser : modèle indisponible, colonne simple", e);
      return null;
    });
  return promesse;
}

/** Une texture de lave à soi (même image que le monde en lave, réglages propres). */
export function textureLave(repetX, repetY) {
  const src = LAVE.uniforms.tLave.value;
  if (!src) return null;
  const t = src.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repetX, repetY);
  t.needsUpdate = true;
  return t;
}

export function installerGeyser(groupe, { laveY }) {
  const g = new THREE.Group();
  g.visible = false;
  groupe.add(g);
  let tex = null;
  const matColonne = new THREE.MeshBasicMaterial({ color: 0xffd08a, side: THREE.DoubleSide });
  // cœur lumineux (additif) : la colonne brille plus que le lac
  const matCoeur = new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  // colonne : hauteur 1 (mise à l'échelle), du bas (y = 0) au haut (y = 1)
  const geo = new THREE.CylinderGeometry(GEYSER.rayon, GEYSER.rayon * 1.7, 1, 20, 6, true);
  geo.translate(0, 0.5, 0);
  // bords ondulés : la colonne n'est pas un tube parfait
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i), a = Math.atan2(z, x);
    const k = 1 + 0.18 * Math.sin(a * 5 + y * 9) + 0.1 * Math.sin(a * 3 - y * 13);
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  const colonne = new THREE.Mesh(geo, matColonne);
  const coeur = new THREE.Mesh(new THREE.CylinderGeometry(GEYSER.rayon * 1.12, GEYSER.rayon * 1.85, 1, 20, 1, true).translate(0, 0.5, 0), matCoeur);
  // dôme au sommet (la lave qui bouillonne)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(GEYSER.rayon * 1.05, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), matColonne);
  // bouillons à la base (sur le lac)
  const base = new THREE.Mesh(new THREE.CircleGeometry(GEYSER.rayon * 3.2, 28), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.55, depthWrite: false }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = 0.15;
  g.add(colonne, coeur, dome, base);
  // la gerbe en spirale (modèle) : une toupie par nappe, l'axe au centre de la gerbe
  const gerbe = new THREE.Group();
  gerbe.visible = false;
  g.add(gerbe);
  const toupies = [];
  chargerGerbe().then((gltf) => {
    if (!gltf) return;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.clone();
      o.matrixWorld.decompose(m.position, m.quaternion, m.scale);
      m.position.x -= MODELE.centreX;
      m.position.y -= MODELE.bas;
      m.material = o.material.clone();
      Object.assign(m.material, { transparent: true, depthWrite: false, side: THREE.DoubleSide }); // (ses propres couleurs : elles se détachent sur le lac)
      m.frustumCulled = false;
      const toupie = new THREE.Group();
      toupie.add(m);
      toupie.userData.vitesse = [5.5, -4, 7.5][toupies.length % 3];
      toupies.push(toupie);
      gerbe.add(toupie);
    });
    // la gerbe tournoie autour de la colonne de lave (le cœur lumineux n'est plus utile)
    if (toupies.length) coeur.visible = false;
  });
  // gerbes : des gouttes de lave projetées depuis le sommet
  const gouttes = [];
  const matGoutte = new THREE.MeshBasicMaterial({ color: 0xff8a1e });
  const matGoutte2 = new THREE.MeshBasicMaterial({ color: 0xffd25a });
  for (let k = 0; k < 30; k++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22 + (k % 4) * 0.1, 0), k % 3 ? matGoutte : matGoutte2);
    const a = (k / 30) * Math.PI * 2 + (k % 5) * 0.3;
    const r = 6 + (k % 6) * 2.4;
    m.userData.v = new THREE.Vector3(Math.cos(a) * r, 8 + (k % 7) * 2.5, Math.sin(a) * r);
    m.visible = false;
    gouttes.push(m);
    g.add(m);
  }

  let jet = null; // { t, hMax, depart }
  const sommetLocal = new THREE.Vector3();

  return {
    lancer({ sommet, dans }) {
      if (!tex) {
        tex = textureLave(2, 3);
        if (tex) { matColonne.map = tex; matColonne.needsUpdate = true; }
      }
      g.position.set(sommet.x, laveY, sommet.z);
      g.visible = true;
      jet = { t: Math.max(0, GEYSER.montee - dans), hMax: Math.max(4, sommet.y - laveY), gerbe: false };
      audio.grondement?.(0.9);
      this.etape(0);
    },
    etape(dt) {
      if (tex) tex.offset.y -= dt * 2.2; // la lave monte dans la colonne
      if (!jet) return;
      const J = jet, M = GEYSER.montee, T = GEYSER.tenue, D = GEYSER.descente;
      J.t += dt;
      let h;
      if (J.t < M) { const u = J.t / M; h = J.hMax * (1 - (1 - u) * (1 - u)); }
      else if (J.t < M + T) h = J.hMax * (1 + 0.04 * Math.sin((J.t - M) * 30));
      else { const u = Math.min(1, (J.t - M - T) / D); h = J.hMax * (1 - u * u); }
      h = Math.max(0.01, h);
      colonne.scale.y = h;
      gerbe.visible = toupies.length > 0;
      gerbe.scale.set(GEYSER.largeur, h / MODELE.hauteur, GEYSER.largeur);
      for (const t of toupies) t.rotation.y += dt * t.userData.vitesse;
      coeur.scale.y = h * 1.02;
      dome.position.y = h;
      const gonfle = 1 + 0.12 * Math.sin(J.t * 25);
      dome.scale.set(gonfle, 0.35 * gonfle, gonfle); // aplati : il ne cache pas le kart juste au-dessus
      base.scale.setScalar(0.6 + 0.4 * Math.min(1, J.t / 0.3));
      base.material.opacity = 0.55 * (J.t < M + T ? 1 : Math.max(0, 1 - (J.t - M - T) / D));
      // gerbes au sommet
      if (!J.gerbe && J.t >= M) {
        J.gerbe = true;
        J.tg = 0;
        sommetLocal.set(0, h, 0);
        for (const m of gouttes) m.visible = true;
      }
      if (J.gerbe) {
        J.tg += dt;
        const t = J.tg;
        for (const m of gouttes) {
          const v = m.userData.v;
          m.position.set(sommetLocal.x + v.x * t, sommetLocal.y + v.y * t - 14 * t * t, sommetLocal.z + v.z * t);
          m.rotation.x += dt * 4;
          if (m.position.y < 0) m.visible = false;
        }
      }
      if (J.t > M + T + D && (!J.gerbe || gouttes.every((m) => !m.visible))) {
        jet = null;
        g.visible = false;
      }
    },
    get jet() { return jet; },
  };
}
