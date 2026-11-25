import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { audio } from "./audio.js";

// Le mégalodon du ravin (circuit dino) : pendant que le ptérodactyle porte le kart du joueur
// au-dessus du vide, un mégalodon géant jaillit tout droit de la rivière, à la verticale, le nez
// vers le ciel et la gueule grande ouverte ; il monte jusqu'à côté du kart, CLAC ! il le rate de
// peu, puis retombe à la verticale (la queue la première) dans un grand « plouf ».
//
// Modèle : public/dinos/megalodon.glb, d'après « Megalodon » de Sealife Fan 3 (Sketchfab,
// CC-BY 4.0, voir CREDITS.txt), allégé (gltf-transform : simplify, textures WebP 1024).
// Clips : « Swim », « Swim Fast », « Bite » (gueule ouverte → fermée à 1,0 s → rouverte), « Tear ».
// Le modèle regarde vers +Z ; le pivot de saut est mis sur le bout du museau.

export const MEGALO = {
  taille: 3, // × le modèle (14,5 m) : ~43 m de long
  montee: 0.6, // s de la sortie de l'eau jusqu'au sommet (là où la gueule claque) : pendant la chute du kart
  cote: 0, // m : le museau monte juste sous le kart (latéralement)
  dessous: 0.6, // m : ... la gueule ouverte juste sous le bas du kart
  devant: 0, // m : ... à l'endroit même où le kart tombe
  penche: 0, // rad : le nez vers le ciel
};
const NEZ_Z = 4.1; // m (modèle) : bout du museau
const CLAC_CLIP = 1.0; // s : instant du clip « Bite » où la gueule est fermée

let promesse = null;
export function chargerMegalodon() {
  promesse ??= new GLTFLoader()
    .loadAsync(`${import.meta.env.BASE_URL}dinos/megalodon.glb`)
    .catch((e) => {
      console.warn("mégalodon : modèle indisponible", e);
      return null;
    });
  return promesse;
}

/** Éclaboussure : un anneau qui s'élargit et une gerbe qui monte puis retombe (à la surface de l'eau). */
function creerPlouf() {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const anneau = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 40), mat.clone());
  anneau.rotation.x = -Math.PI / 2;
  const gerbe = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1, 1, 24, 1, true), mat.clone());
  gerbe.geometry.translate(0, 0.5, 0);
  const gouttes = [];
  for (let k = 0; k < 18; k++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), mat.clone());
    const a = (k / 18) * Math.PI * 2;
    m.userData.v = new THREE.Vector3(Math.cos(a) * (4 + (k % 3) * 2.5), 9 + (k % 4) * 3, Math.sin(a) * (4 + (k % 3) * 2.5));
    gouttes.push(m);
    g.add(m);
  }
  g.add(anneau, gerbe);
  g.visible = false;
  let t = -1;
  return {
    objet: g,
    lancer(pos) {
      g.position.copy(pos);
      g.visible = true;
      t = 0;
    },
    etape(dt) {
      if (t < 0) return;
      t += dt;
      const u = t / 1.6;
      if (u >= 1) { g.visible = false; t = -1; return; }
      anneau.scale.setScalar(3 + 12 * Math.sqrt(u));
      anneau.material.opacity = 0.9 * (1 - u);
      const h = 9 * Math.sin(Math.min(1, u * 1.6) * Math.PI);
      gerbe.scale.set(3.5 + 3 * u, Math.max(0.01, h), 3.5 + 3 * u);
      gerbe.material.opacity = 0.45 * (1 - u);
      for (const m of gouttes) {
        const v = m.userData.v;
        m.position.set(v.x * t, v.y * t - 12 * t * t, v.z * t);
        m.scale.setScalar(1.1 * (1 - u) + 0.25);
        m.material.opacity = m.position.y > -0.5 ? 0.9 * (1 - u) : 0;
      }
    },
  };
}

/**
 * Prépare le mégalodon du ravin. eauY : hauteur de la rivière (monde).
 * Renvoie { lancer({ cible, tSommet, lateral, ... }), etape(dt) } ; lancer() est appelé par le
 * scénario du ravin (ptero.js) quand le joueur est attrapé.
 */
export function installerMegalodon(groupe, { eauY }) {
  const pivot = new THREE.Group(); // origine = bout du museau, +Z = sens du nez
  pivot.visible = false;
  groupe.add(pivot);
  const plouf = creerPlouf();
  groupe.add(plouf.objet);
  let mixer = null, bite = null;
  chargerMegalodon().then((gltf) => {
    if (!gltf) return;
    const m = gltf.scene;
    m.scale.setScalar(MEGALO.taille);
    m.position.set(0, -2.6 * MEGALO.taille, -NEZ_Z * MEGALO.taille);
    m.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false; // (squelette animé : la boîte du maillage au repos ne suit pas)
    });
    pivot.add(m);
    mixer = new THREE.AnimationMixer(m);
    const clip = gltf.animations.find((a) => /Bite/.test(a.name));
    if (clip) { bite = mixer.clipAction(clip); bite.play(); }
  });

  // saut en cours : s = temps depuis le départ (sous l'eau)
  let saut = null;
  const tete = new THREE.Vector3(), haut = new THREE.Vector3(0, 1, 0);
  const mBase = new THREE.Matrix4(), axeX = new THREE.Vector3(), axeY = new THREE.Vector3();

  function position(s, cible) {
    const S = saut, ds = s - S.sp;
    cible.copy(S.sommet); // à la verticale : il retombe par où il est sorti
    cible.y = S.sommet.y - S.a * ds * ds;
    return cible;
  }

  return {
    pret: () => !!mixer,
    /**
     * cible : point du monde où le museau doit être au sommet ; lat : direction latérale (horizontale)
     * du kart vers le requin ; dans : s avant le sommet (le saut démarre sous l'eau).
     */
    lancer({ sommet, lat, dans }) {
      if (!mixer) return false;
      const sp = MEGALO.montee;
      const depart = Math.max(0, sp - dans); // (si on est en retard, on démarre déjà en l'air)
      saut = {
        sp, sommet: sommet.clone(), lat: lat.clone().normalize(),
        a: (sommet.y - eauY + 3) / (sp * sp), // le museau part 3 m sous l'eau
        s: depart, ploufs: 0, clac: false,
      };
      // repère fixe : nez vers le ciel, un peu penché vers le kart, le ventre tourné vers lui
      const versKart = saut.lat.clone().negate();
      const f = haut.clone().multiplyScalar(Math.cos(MEGALO.penche)).addScaledVector(versKart, Math.sin(MEGALO.penche)).normalize();
      axeX.crossVectors(versKart, haut).normalize(); // perpendiculaire au plan kart-requin
      axeY.crossVectors(f, axeX).normalize(); // dos à l'opposé du kart
      mBase.makeBasis(axeX, axeY, f);
      pivot.quaternion.setFromRotationMatrix(mBase);
      pivot.visible = true;
      this.etape(0);
      return true;
    },
    etape(dt) {
      plouf.etape(dt);
      if (!saut) return;
      const S = saut;
      S.s += dt;
      position(S.s, tete);
      pivot.position.copy(tete);
      // gueule : grande ouverte en montant (clip « Bite » à 0,5 s), elle se referme au sommet
      // (1,0 s), puis se rouvre en retombant
      if (bite) {
        const d = S.s - S.sp;
        mixer.setTime(d < -0.25 ? 0.5 : Math.min(bite.getClip().duration - 0.01, CLAC_CLIP + (d < 0 ? d * 2 : d)));
      }
      // éclaboussures : à la sortie de l'eau et en replongeant
      const auDessus = tete.y > eauY;
      if (S.ploufs === 0 && auDessus) {
        S.ploufs = 1;
        plouf.lancer(new THREE.Vector3(tete.x, eauY, tete.z));
      } else if (S.ploufs === 1 && S.s > S.sp && !auDessus) { // il replonge
        S.ploufs = 2;
        plouf.lancer(new THREE.Vector3(tete.x, eauY, tete.z));
      }
      if (!S.clac && S.s >= S.sp) {
        S.clac = true;
        if (!audio.jouer?.(`${import.meta.env.BASE_URL}sons/trex-clac.ogg`, 1.0, 0.8)) audio.croc?.();
      }
      // fini quand la queue (sous le museau) est repassée sous l'eau
      if (S.s > S.sp && tete.y < eauY - 2) {
        saut = null;
        pivot.visible = false;
      }
    },
    /** (essais) */
    get saut() { return saut; },
    pivot,
  };
}
