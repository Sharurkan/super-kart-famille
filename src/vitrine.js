import * as THREE from "three";
import { creerKart, KARTS } from "./karts.js";
import { creerPilote, PERSONNAGES } from "./pilote.js";
import { textureRond } from "./textures.js";
import { liberer } from "./liberer.js";

/**
 * Petite scène 3D pour les menus :
 * - "titre" : les 5 personnages dans leurs karts, alignés côte à côte ;
 * - "kart" : un seul kart au centre, sur un plateau, avec le personnage choisi ;
 * - "podium" : les 3 premiers sur les marches.
 * Les pilotes sont des dessins plats : dans les menus, tous les karts regardent la caméra, qui
 * reste presque de face (balancement de quelques degrés), pour ne jamais les voir de biais.
 */
export class Vitrine {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x6ec6ff);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.4));
    const soleil = new THREE.DirectionalLight(0xffffff, 1.5);
    soleil.position.set(4, 8, 6);
    this.scene.add(soleil);

    // sol : grand disque d'herbe + plateau
    const sol = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshLambertMaterial({ color: 0x7ed957 }));
    sol.rotation.x = -Math.PI / 2;
    this.scene.add(sol);
    this.plateau = new THREE.Group();
    const disque = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.5, 0.25, 32), new THREE.MeshLambertMaterial({ color: 0xffd34d }));
    disque.position.y = 0.12;
    const bord = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.08, 6, 40), new THREE.MeshLambertMaterial({ color: 0xff8a1f }));
    bord.rotation.x = Math.PI / 2;
    bord.position.y = 0.25;
    this.plateau.add(disque, bord);
    this.scene.add(this.plateau);
    this.ombre = new THREE.MeshBasicMaterial({ map: textureRond(), transparent: true, depthWrite: false });

    this.objets = []; // { kart, pilote }
    this.mode = "titre";
    this.t = 0;
    this.pop = 0;
  }

  vider() {
    for (const o of this.objets) {
      o.parent.remove(o.kart.groupe);
      liberer(o.kart.groupe);
    }
    this.objets = [];
  }

  ajouter(type, perso, x, z, angle, parent = this.scene) {
    const kart = creerKart(type);
    const pilote = creerPilote(perso);
    kart.siege.add(pilote.mesh);
    kart.groupe.position.set(x, 0, z);
    kart.groupe.rotation.y = angle;
    parent.add(kart.groupe);
    const o = { kart, pilote, parent };
    this.objets.push(o);
    return o;
  }

  montrerTitre() {
    this.vider();
    this.mode = "titre";
    this.plateau.visible = false;
    // en ligne, tous de face (avant du kart = +Z, vers la caméra)
    PERSONNAGES.forEach((p, i) => {
      const x = (i - (PERSONNAGES.length - 1) / 2) * ECART_TITRE;
      // chaque kart pointe vers la caméra (ceux des bouts tournent un peu vers le centre)
      this.ajouter(KARTS[i % KARTS.length], p, x, -3, Math.atan2(-x, 14));
    });
  }

  montrerKart(type, perso) {
    this.vider();
    this.mode = "kart";
    this.plateau.visible = true;
    this.ajouter(type, perso, 0, 0, 0, this.plateau).kart.groupe.position.y = 0.25;
    this.pop = 1;
  }

  /** podium : [{perso, type}] pour les 3 premiers (1er, 2e, 3e). */
  montrerPodium(podium) {
    this.vider();
    this.mode = "podium";
    this.plateau.visible = false;
    if (!this.marches) this.marches = construireMarches(this.scene);
    this.marches.groupe.visible = true;
    this.marches.confettis.visible = true;
    podium.slice(0, 3).forEach((p, i) => {
      const m = MARCHES[i];
      const o = this.ajouter(p.type, p.perso, m.x, 0.3, Math.atan2(-m.x, 13)); // tourné vers la caméra
      o.kart.groupe.position.y = m.h;
      o.base = m.h;
      o.place = i;
    });
  }

  redimensionner(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  etape(dt) {
    this.t += dt;
    const c = this.camera;
    if (this.marches && this.mode !== "podium") this.marches.groupe.visible = this.marches.confettis.visible = false;
    // léger balancement de la caméra : au plus ~5° de chaque côté, jamais de profil
    const balance = Math.sin(this.t * 0.35);
    if (this.mode === "podium") {
      const d = distanceCadre(c, 5.2, 12.5);
      c.position.set(balance * d * 0.08, 3.4, 0.3 + d);
      c.lookAt(0, 1.6, 0.3);
      // le gagnant saute de joie
      for (const o of this.objets) {
        const saut = o.place === 0 ? Math.abs(Math.sin(this.t * 4)) * 0.5 : Math.abs(Math.sin(this.t * 3 + o.place)) * 0.15;
        o.kart.groupe.position.y = o.base + saut;
      }
      this.marches.animer(dt);
    } else if (this.mode === "titre") {
      // toute la rangée tient dans l'écran, même en 4:3 (tablette)
      const d = distanceCadre(c, ((PERSONNAGES.length - 1) * ECART_TITRE) / 2 + 1.4, 10);
      c.position.set(balance * d * 0.08, 0.35 * d, -3 + d);
      c.lookAt(0, 0.2, -3);
    } else {
      const d = distanceCadre(c, 2.6, 7.4);
      c.position.set(balance * d * 0.08, 2.6, d);
      c.lookAt(0, 1.05, 0);
      this.plateau.rotation.y = 0; // le plateau ne tourne plus : kart et pilote de face
      this.pop = Math.max(0, this.pop - dt * 3);
      const s = 1 + Math.sin(this.pop * Math.PI) * 0.15;
      this.plateau.scale.setScalar(s);
    }
    // roues qui tournent un peu, et pilotes face à la caméra
    for (const o of this.objets) {
      const k = o.kart;
      for (const r of [...k.roues.avant, ...k.roues.arriere]) r.tourne.rotation.x += dt * 2;
      k.corps.position.y = Math.abs(Math.sin(this.t * 6 + k.groupe.position.x)) * 0.03;
      k.groupe.updateMatrixWorld();
      const yaw = k.groupe.rotation.y + (o.parent === this.plateau ? this.plateau.rotation.y : 0);
      o.pilote.orienter(c, yaw, yaw, 1); // panneau exactement face à la caméra
    }
  }
}

const ECART_TITRE = 2.7; // mètres entre deux karts de l'accueil

/** Recul de la caméra pour que la demi-largeur voulue tienne dans l'écran (jamais sous "mini"). */
function distanceCadre(camera, demiLargeur, mini) {
  const demiAngle = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
  return Math.max(mini, demiLargeur / Math.tan(demiAngle));
}

// ---------- Podium ----------
const MARCHES = [
  { x: 0, h: 1.6, couleur: 0xffd43b, chiffre: "1" },
  { x: -3.1, h: 1.05, couleur: 0xced4da, chiffre: "2" },
  { x: 3.1, h: 0.6, couleur: 0xe8a165, chiffre: "3" },
];

function textureChiffre(chiffre, fond) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#" + fond.toString(16).padStart(6, "0");
  g.fillRect(0, 0, 128, 128);
  g.font = "900 100px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 10;
  g.strokeStyle = "#1b3a8a";
  g.strokeText(chiffre, 64, 70);
  g.fillStyle = "#fff";
  g.fillText(chiffre, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function construireMarches(scene) {
  const groupe = new THREE.Group();
  for (const m of MARCHES) {
    const cote = new THREE.MeshLambertMaterial({ color: m.couleur });
    const face = new THREE.MeshLambertMaterial({ map: textureChiffre(m.chiffre, m.couleur) });
    // ordre des faces d'une boîte : +x, -x, +y, -y, +z (devant), -z
    const bloc = new THREE.Mesh(new THREE.BoxGeometry(3, m.h, 3), [cote, cote, cote, cote, face, cote]);
    bloc.position.set(m.x, m.h / 2, 0.3);
    groupe.add(bloc);
  }
  scene.add(groupe);

  // confettis : petits carrés colorés qui tombent en tournant
  const N = 160;
  const confettis = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.18, 0.12),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    N
  );
  const couleurs = [0xff6b6b, 0xffd43b, 0x51cf66, 0x4dabf7, 0xf783ac, 0xb197fc];
  const c = new THREE.Color();
  const etats = [];
  for (let i = 0; i < N; i++) {
    confettis.setColorAt(i, c.set(couleurs[i % couleurs.length]));
    etats.push({ x: (Math.random() - 0.5) * 14, y: Math.random() * 10, z: (Math.random() - 0.5) * 6, r: Math.random() * 6, v: 0.8 + Math.random() * 1.2 });
  }
  scene.add(confettis);
  const o = new THREE.Object3D();
  return {
    groupe,
    confettis,
    animer(dt) {
      etats.forEach((e, i) => {
        e.y -= e.v * dt;
        e.r += dt * 4;
        if (e.y < 0) e.y = 9 + Math.random() * 2;
        o.position.set(e.x + Math.sin(e.r) * 0.3, e.y, e.z);
        o.rotation.set(e.r, e.r * 0.7, 0);
        o.updateMatrix();
        confettis.setMatrixAt(i, o.matrix);
      });
      confettis.instanceMatrix.needsUpdate = true;
    },
  };
}
