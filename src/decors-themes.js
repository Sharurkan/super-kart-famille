import * as THREE from "three";
import { instances, positions, boiteRonde } from "./decor.js";
import { fusion, matCouleurs, nuages } from "./decors-circuits.js";
import { creerDino } from "./dinos.js";
import { planter, gardeRoute, planterJungle } from "./vegetation.js";
import { installerRavin } from "./ptero.js";
import { installerAquarium } from "./aquarium.js";
import { installerBrachio } from "./brachio.js";
import { installerTrex, indicesTrex } from "./ventre.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { creerVolcan } from "./volcan.js";
import { creerMeteorite } from "./meteorite.js";
import { attaqueTrex } from "./trex-attaque.js";
import { installerRaptors } from "./raptors.js";

// Décors des circuits Dinosaures, Jouets et Concert pop.
// Astuce couleurs : les parties "blanches" d'un objet fusionné prennent la couleur
// de chaque instance (un dino vert, un bleu, un violet...), le noir reste noir.

const B = 0xffffff; // partie qui prend la couleur de l'instance
const N = 0x222222;
const auHasard = (rnd, liste) => liste[Math.floor(rnd() * liste.length)];
const versPiste = (piste, p) => {
  const { indice } = piste.localiser(p.x, p.z);
  return Math.atan2(piste.cx[indice] - p.x, piste.cz[indice] - p.z);
};

// ---------------------------------------------------------------------------
const DENSITE_MAX = 1.1; // multiplicateur maximal du nombre de plantes quand le circuit s'allonge (budget triangles)
export function decorDino(groupe, piste, rnd, horsPiste, obstacles = []) {

  // La piste traverse une jungle très dense qui ferme la vue ; à quatre endroits la forêt
  // s'ouvre sur une grande plaine où l'on voit des troupeaux de dinosaures (et le volcan).
  // debut/fin : fractions du tour ; cote : "ext" (côté extérieur du circuit) ou "int" ;
  // largeur : profondeur de la plaine (m) avant la lisière de la forêt.
  // (rien entre 0,70 et 0,92 : l'aquarium y sort de la jungle)
  const mixers = [], marcheurs = [], poses = []; // poses : dinos installés (outil de test, en dev)
  // tout ce qui est posé autour de la route passe par la garde : rien sur la route ni devant la caméra
  const garde = gardeRoute(piste);
  const { N } = piste;
  const exterieur = (i) => Math.sign((piste.cx[i] - piste.centre.x) * piste.nx[i] + (piste.cz[i] - piste.centre.z) * piste.nz[i]) || 1;
  // Troupeaux : espece, n (nombre), t (position le long de la plaine, 0 à 1), lat (distance au milieu
  // de la route, m ; bord de la route à 8 m, barrières à ~15 m).
  // S : taille par rapport à la taille réelle (HAUTEUR plus bas). À taille réelle, vus du kart, ils
  // étaient trop petits pour les enfants : tous sont très agrandis (×2,5 à ×3) en gardant l'ordre des
  // tailles (sauropode > T-rex > stégosaure, tricératops > parasaurolophus > raptors ; les raptors,
  // tout petits à l'écran, un peu plus que les autres). Moins d'individus qu'avant : ils prennent
  // plus de place et le budget de triangles (tablette) ne doit pas augmenter.
  // marche : ils tournent lentement en rond (seulement les espèces qui ont une vraie marche :
  // Stégosaure et Tricératops ; le T-rex n'a qu'une course, le Parasaurolophus et le sauropode rien).
  // file : en file indienne le long de la route, de profil (les sauropodes, très longs) ; sinon en rond.
  // heros : version détaillée du modèle (proche de la route) ; sinon la version « loin », ~3 fois
  // plus légère (budget de triangles ; raptor et tricératops n'existent qu'en une version).
  // Le T-rex n'est pas dans ce tableau : il attend tout près de la route, avant sa tête géante (TREX plus bas).
  // Les vélociraptors non plus : meutes, chasseurs et coureurs sont dans raptors.js (installés plus bas).
  const PLAINES = [
    // ligne droite du haut (le ravin du ptérodactyle) : le volcan au fond de la plaine
    { debut: 0.155, fin: 0.3, cote: "ext", largeur: 230, troupeaux: [
      // derrière le ravin (rien au-dessus du vide : le bout arrondi du ravin s'arrête à ~65 m de la route)
      { espece: "Apatosaurus", n: 2, t: 0.3, lat: 80, S: 2.8, file: true },
      { espece: "Parasaurolophus", n: 3, t: 0.8, lat: 36, S: 2.8, heros: true },
    ] },
    // ligne droite du diplodocus
    { debut: 0.37, fin: 0.47, cote: "ext", largeur: 200, troupeaux: [
      { espece: "Triceratops", n: 3, t: 0.3, lat: 44, S: 2.9 },
      { espece: "Stegosaurus", n: 2, t: 0.75, lat: 58, S: 2.9, marche: true, heros: true },
    ] },
    // ligne droite du T-rex (le T-rex géant couché de ventre.js ; un T-rex debout avant sa tête : voir TREX)
    { debut: 0.525, fin: 0.64, cote: "ext", largeur: 200, troupeaux: [
      { espece: "Stegosaurus", n: 2, t: 0.13, lat: 58, S: 2.9, heros: true },
    ] },
    // ligne droite du départ (le looping), côté intérieur du circuit
    { debut: 0.975, fin: 0.085, cote: "int", largeur: 120, troupeaux: [
      { espece: "Parasaurolophus", n: 3, t: 0.62, lat: 44, S: 2.8, heros: true },
      { espece: "Triceratops", n: 2, t: 0.2, lat: 48, S: 2.9, marche: true }, // loin du troupeau voisin
    ] },
  ].map((P) => {
    const debut = Math.round(P.debut * N) % N, fin = Math.round(P.fin * N) % N;
    const milieu = (debut + Math.round(((fin - debut + N) % N) / 2)) % N;
    return { ...P, debut, fin, cote: exterieur(milieu) * (P.cote === "ext" ? 1 : -1) };
  });
  // Animations sur place, au hasard (voir les clips de chaque modèle dans dinos.js ; la version
  // « loin » n'a que Idle, Eat et Walk). Chaque dino démarre à un instant différent de son clip.
  const CLIPS = {
    Apatosaurus: ["Idle", "Eat", "Eat"],
    Parasaurolophus: ["Idle", "Eat", "Eat"],
    Stegosaurus: ["Eat", "Idle", "Eat", "Attack"], // Attack (il rugit) : version détaillée seulement
    Triceratops: ["Eat", "Eat", "Idle", "Attack"],
    Velociraptor: ["Eat", "Idle", "Idle", "Attack"],
    Trex: ["Idle"],
  };
  // vitesse (m/s, à la taille normale et à vitesse d'animation 1) à laquelle les pieds ne glissent
  // pas : mesurée sur le pied d'appui pendant le clip « Walk »
  const MARCHE = { Stegosaurus: 2, Triceratops: 1.75 };
  // taille normale : hauteur (m) donnée au modèle, et longueur (m) mesurée sur le modèle à cette hauteur
  // (museau-queue ; le sauropode du troupeau, cou et queue tendus, fait ~42 m pour 8,8 m de haut)
  const HAUTEUR = { Apatosaurus: 8.8, Trex: 7, Stegosaurus: 4.2, Triceratops: 3.6, Parasaurolophus: 3.6, Velociraptor: 2.2 };
  const LONGUEUR = { Apatosaurus: 42, Trex: 17.7, Stegosaurus: 7.9, Triceratops: 8.3, Parasaurolophus: 8.5, Velociraptor: 4.4 };
  const clairieres = []; // pas d'arbres ni de plantes sur les troupeaux : cercles { x, z, r (arbres), occupe (plantes) }
  /** Clairière le long d'un dinosaure (long et étroit) : quelques cercles sur son axe. */
  const clairiereDino = (x, z, angle, L, espece, i) => {
    const ux = Math.sin(angle), uz = Math.cos(angle), rho = 0.2 * L + 2;
    for (let f = -0.4; f <= 0.41; f += 0.2) clairieres.push({ x: x + ux * f * L, z: z + uz * f * L, r: rho + 6, occupe: rho, espece, i });
  };
  // Emprise au sol d'un dinosaure : contour de la boîte de son modèle (dans son repère, + marge),
  // tourné et posé en (x, z). Aucun point ne doit toucher la route, les barrières, le ravin ou les
  // grands décors ; au centre, la garde vérifie aussi qu'il ne cache pas la route à la caméra.
  const MARGE_DINO = 1.5;
  const contour = (b, x, z, angle) => {
    const c = Math.cos(angle), s = Math.sin(angle), pts = [];
    const x0 = b.min.x - MARGE_DINO, x1 = b.max.x + MARGE_DINO, z0 = b.min.z - MARGE_DINO, z1 = b.max.z + MARGE_DINO;
    for (let k = 0; k <= 8; k++) {
      const f = k / 8, lx = x0 + (x1 - x0) * f, lz = z0 + (z1 - z0) * f;
      for (const [u, w] of [[lx, z0], [lx, z1], [x0, lz], [x1, lz]]) pts.push([x + u * c + w * s, z - u * s + w * c]);
    }
    return pts;
  };
  /** Ce qui gêne le dinosaure à cet endroit, ou "" si la place est bonne. */
  const gene = (b, x, z, angle) => {
    for (const [px, pz] of contour(b, x, z, angle)) {
      const raison = garde.probleme(px, pz, 0.5, 1.1);
      if (raison) return raison;
    }
    const largeur = Math.min(b.max.x - b.min.x, b.max.z - b.min.z);
    return garde.probleme(x, z, largeur / 2, b.max.y - b.min.y);
  };
  // dinosaures immobiles déjà posés : deux voisins ne doivent pas se traverser
  const emprises = [];
  const dansEmprise = (E, px, pz) => {
    const dx = px - E.x, dz = pz - E.z, c = Math.cos(E.angle), s = Math.sin(E.angle);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return lx > E.b.min.x && lx < E.b.max.x && lz > E.b.min.z && lz < E.b.max.z;
  };
  const chevauche = (b, x, z, angle) => emprises.some((E) => {
    if (Math.hypot(E.x - x, E.z - z) > 150) return false;
    const moi = { b, x, z, angle };
    return contour(b, x, z, angle).some(([px, pz]) => dansEmprise(E, px, pz)) || contour(E.b, E.x, E.z, E.angle).some(([px, pz]) => dansEmprise(moi, px, pz));
  });
  for (const P of PLAINES) for (const T of P.troupeaux) {
    const long = (P.fin - P.debut + N) % N;
    const i = (P.debut + Math.round(T.t * long)) % N;
    const lat = T.lat * P.cote;
    const cx = piste.cx[i] + piste.nx[i] * lat, cz = piste.cz[i] + piste.nz[i] * lat;
    const S = T.S ?? 1;
    const L = LONGUEUR[T.espece] * S; // écarts, cercle de marche et clairière suivent la taille
    // cercle de marche : assez grand pour la file de marcheurs (n × (longueur + 5 m))
    const rayonMarche = T.marche ? Math.max((6 + rnd() * 3) * S, (T.n * (L + 5)) / 6.283) : 0;
    // en rond (troupeau sur place) : rayon tel que deux voisins soient à ~1,15 longueur l'un de l'autre
    // (ils sont tournés au hasard : moins serrés, ils ne se traversent pas)
    const anneau = T.n > 1 && !T.marche && !T.file ? (1.15 * L) / (2 * Math.sin(Math.PI / T.n)) : 0;
    // les marcheurs d'un troupeau avancent tous à la même vitesse (sinon ils se rattrapent et se traversent)
    const vMarche = 0.85 + rnd() * 0.3;
    // clairière : tout le cercle du troupeau (ils peuvent tourner sur place pour ne pas se traverser) ;
    // le long de chaque sauropode (file), creusée plus bas
    const occupe = (T.marche ? rayonMarche : anneau * 1.1) + L * 0.6 + 2;
    if (!T.file) clairieres.push({ x: cx, z: cz, r: occupe + 6, occupe, espece: T.espece, i });
    const travers = T.file ? Math.PI / 2 : 0; // les sauropodes se montrent de profil
    const a0 = rnd() * 6.283;
    for (let k = 0; k < T.n; k++) {
      // tirages faits tout de suite (les modèles arrivent plus tard, dans le désordre)
      let x, z;
      if (T.file) {
        // en file le long de la route, un sur deux un peu plus loin (ils se chevauchent en profondeur)
        const s = (k - (T.n - 1) / 2) * 0.45 * L, l = lat + P.cote * (k % 2) * 0.25 * L;
        x = cx + piste.tx[i] * s + piste.nx[i] * (l - lat);
        z = cz + piste.tz[i] * s + piste.nz[i] * (l - lat);
      } else {
        const a = a0 + (k / T.n) * 6.283 + (rnd() - 0.5) * 0.5, d = anneau * (0.9 + rnd() * 0.2);
        x = cx + Math.cos(a) * d;
        z = cz + Math.sin(a) * d;
      }
      const clips = CLIPS[T.espece].filter((c) => c !== "Attack" || T.heros || T.espece === "Triceratops" || T.espece === "Velociraptor");
      const anim = T.marche ? "Walk" : clips[Math.floor(rnd() * clips.length)];
      const tourne = (rnd() - 0.5) * (travers ? 0.2 : 2.4), vitesse = 0.85 + rnd() * 0.3, echelle = 0.9 + rnd() * 0.2;
      const angle0 = a0 + (k / T.n) * 6.283; // répartis sur le cercle de marche
      const angle = versPiste(piste, { x, z }) + travers + tourne;
      if (T.file) clairiereDino(x, z, angle, L * echelle, T.espece, i);
      // marcheur : animation accordée à sa taille pour que les pieds ne glissent pas (vitesse commune)
      creerDino(T.espece, { animation: anim, vitesse: T.marche ? vMarche / echelle : vitesse, hauteur: HAUTEUR[T.espece] * S * echelle, detail: T.heros ? "auto" : "loin", troupeau: true }).then(({ objet, animer }) => {
        // sa vraie taille (boîte du modèle) : rien ne doit déborder sur la route, ni pendant la marche
        const boite = new THREE.Box3().setFromObject(objet);
        if (T.marche) {
          // marche lente en rond autour du troupeau : tout le cercle doit rester loin de la route
          for (let m = 0; m < 24; m++) {
            const a = (m / 24) * 6.283;
            const raison = gene(boite, cx + Math.cos(a) * rayonMarche, cz + Math.sin(a) * rayonMarche, Math.atan2(-Math.sin(a), Math.cos(a)));
            if (raison) {
              if (import.meta.env.DEV) console.warn(`dino ${T.espece} : cercle de marche gêné (${raison}), retiré`);
              return;
            }
          }
          // la foulée grandit avec la taille : vitesse ∝ taille × vitesse d'animation (pas de glissade)
          marcheurs.push({ objet, cx, cz, R: rayonMarche, a: angle0, w: (MARCHE[T.espece] * S * vMarche) / rayonMarche });
          poses.push({ objet, espece: T.espece, marche: marcheurs[marcheurs.length - 1] });
        } else {
          // (pas déplacé : sa clairière dans la forêt et entre les rochers est déjà creusée ici) ;
          // s'il gêne ou traverse un voisin, il essaie de se tourner un peu (de profil : à peine)
          let raison = "";
          const essais = (T.file ? [0, 0.15, -0.15] : [0, 0.6, -0.6, 1.2, -1.2, Math.PI]).map((da) => angle + da);
          const bon = essais.find((a) => !(raison = gene(boite, x, z, a)) && !(raison = chevauche(boite, x, z, a) ? "voisin" : ""));
          if (bon === undefined) {
            if (import.meta.env.DEV) console.warn(`dino ${T.espece} (${Math.round(x)}, ${Math.round(z)}) : gêné (${raison}), retiré`);
            return;
          }
          objet.position.set(x, 0, z);
          objet.rotation.y = bon;
          emprises.push({ b: boite, x, z, angle: bon });
          poses.push({ objet, espece: T.espece });
        }
        groupe.add(objet);
        mixers.push({ update: animer }); // animer(dt, camera) : moins souvent au loin ou hors champ (dinos.js)
      });
    }
  }
  // Le T-rex : un géant (~27 m de haut) debout tout près de la route (derrière les rochers de l'entonnoir,
  // sans toucher les barrières), 60 m avant le centre de la tête du T-rex géant couché (ventre.js,
  // indicesTrex), côté plaine, entre la queue du diplodocus et la tête géante. Il regarde les karts
  // arriver ; quand le joueur passe, il fait semblant de l'attraper (trex-attaque.js).
  // avant : m avant le centre de la tête géante ; lat : du milieu de la route (m) ; S : taille (×7 m) ;
  // tourne : rad, il regarde les karts qui arrivent (le long de la route), un peu tourné vers la route ;
  // frappe : m avant lui (le long de la route) où sa gueule claque à côté du kart (voir trex-attaque.js),
  // sur le plat entre la queue du diplodocus et l'entonnoir de rochers de la gueule géante
  const TREX = { avant: 60, lat: 30, S: 3.9, tourne: 0.26, frappe: 6 };
  const P3 = PLAINES[2];
  const placeTrex = (iTete) => {
    const i = (iTete - Math.round(TREX.avant / piste.pas) + N) % N;
    const l = TREX.lat * P3.cote;
    const x = piste.cx[i] + piste.nx[i] * l, z = piste.cz[i] + piste.nz[i] * l;
    const c = Math.cos(TREX.tourne), s = Math.sin(TREX.tourne) * P3.cote;
    const dx = -piste.tx[i] * c - piste.nx[i] * s, dz = -piste.tz[i] * c - piste.nz[i] * s;
    return { i, x, z, angle: Math.atan2(dx, dz), iFrappe: (i - Math.round(TREX.frappe / piste.pas) + N) % N };
  };
  const trex = { place: placeTrex(indicesTrex(piste).tete), pret: false };
  clairiereDino(trex.place.x, trex.place.z, trex.place.angle, LONGUEUR.Trex * TREX.S, "Trex", trex.place.i);
  {
    // couloir de la tête quand il mord : pas d'arbre entre lui et la route (les plantes basses restent :
    // la tête passe à plus de 4 m au-dessus)
    const { x, z, iFrappe: j } = trex.place, l = (piste.demi + 6) * P3.cote;
    const bx = piste.cx[j] + piste.nx[j] * l, bz = piste.cz[j] + piste.nz[j] * l;
    for (let f = 0; f <= 1.001; f += 0.2) clairieres.push({ x: x + (bx - x) * f, z: z + (bz - z) * f, r: 12, occupe: 3, espece: "Trex", i: j });
  }
  creerDino("Trex", { animation: "Idle", hauteur: HAUTEUR.Trex * TREX.S, detail: "auto" }).then(({ objet, mixer, clips, choisirDetail }) => {
    // toute son emprise est vérifiée (route, barrières, vue de la caméra, tête géante)
    const boite = new THREE.Box3().setFromObject(objet);
    const raison = gene(boite, trex.place.x, trex.place.z, trex.place.angle);
    if (raison) {
      if (import.meta.env.DEV) console.warn(`dino Trex : gêné (${raison}), retiré`);
      return;
    }
    emprises.push({ b: boite, x: trex.place.x, z: trex.place.z, angle: trex.place.angle });
    const { x, z, angle } = trex.place;
    objet.position.set(x, 0, z);
    objet.rotation.y = angle;
    groupe.add(objet);
    // il fait semblant d'attraper le joueur (clips + os tournés par-dessus, après son mixer)
    trex.attaque = attaqueTrex({ objet, mixer, clips, piste, cote: P3.cote, iFrappe: trex.place.iFrappe });
    // ordre : os remis aux valeurs du clip, clips (mixer), puis les os tournés par-dessus (voir remettre())
    // (version allégée au loin, mêmes os : choisirDetail, voir dinos.js)
    mixers.push({ update: (dt, camera) => { choisirDetail(camera); trex.attaque.remettre(); mixer.update(dt); trex.attaque.update(dt); } });
    trex.objet = objet;
    trex.boite = boite;
    poses.push({ objet, espece: "Trex" });
    trex.pret = true;
  });

  // plantes, rochers et nids : pas sur les dinosaures des plaines
  const horsTroupeaux = (liste) => liste.filter((p) => clairieres.every((c) => Math.hypot(p.x - c.x, p.z - c.z) > c.occupe));

  // forêt jurassique : vrais modèles 3D (fougères géantes, plantes tropicales, arbres, rochers)
  const varie = (liste, s0, ds) => liste.map((p) => ({ ...p, s: s0 + rnd() * ds, r: rnd() * 6.3 }));
  // Circuit plus long = plus de surface à décorer. Le budget de triangles (tablette) ne permet
  // pas de multiplier les plantes autant que la longueur : on en ajoute un peu (DENSITE_MAX)
  // et on resserre les bandes autour de la route pour garder la même densité vue du kart.
  const rapport = (piste.N * piste.pas) / 714; // 714 m : longueur pour laquelle les nombres ont été réglés
  const densite = Math.min(rapport, DENSITE_MAX);
  const serre = Math.max(0.6, Math.min(1, densite / rapport));
  const nb = (n) => Math.round(n * densite);
  const zone = (n, dMin, dMax) => horsTroupeaux(positions(piste, rnd, nb(n), dMin, dMin + (dMax - dMin) * serre));
  // plantes réalistes de l'époque : fougères (scan Poly Haven) et cycas, avec quelques plantes
  // stylisées du pack Quaternius pour la variété (budget de triangles : voir TAILLES et le pack)
  planter(groupe, "Fougere", varie(zone(54, piste.demi + 2.6, 45), 0.8, 0.7), garde);
  planter(groupe, "Fern_1", varie(zone(40, piste.demi + 2.6, 45), 0.7, 0.9), garde);
  planter(groupe, "Cycas", varie(zone(33, horsPiste, 60), 0.75, 0.6), garde);
  planter(groupe, "Plant_1_Big", varie(zone(11, horsPiste, 60), 0.7, 0.7), garde);
  planter(groupe, "Plant_1", varie(zone(55, piste.demi + 2.6, 40), 0.8, 0.6), garde);
  planter(groupe, "Grass_Common_Tall", varie(zone(24, piste.demi + 2.2, 35), 0.7, 0.8), garde); // 300 triangles chacune
  // (les arbres sont des imposteurs réalistes : voir planterJungle plus bas)
  // rochers : vrais rochers scannés (les anciens noms sont remplacés dans vegetation.js)
  for (const r of ["Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3"]) planter(groupe, r, varie(zone(16, horsPiste, 100), 0.6, 1.2).map((p) => ({ ...p, y: -0.15 })), garde);
  planter(groupe, "Gros_Rocher", varie(zone(6, horsPiste + 20, 100), 0.7, 0.6).map((p) => ({ ...p, y: -0.4 })), garde);

  // petits détails au bord de la route : cailloux (scannés), fleurs, champignons géants
  // (les cailloux au pied des barrières, pas dans l'herbe où l'on roule : voir gardeRoute)
  const cailloux = ["Pebble_Round_1", "Pebble_Round_2", "Pebble_Round_3", "Pebble_Round_4", "Pebble_Round_5", "Pebble_Square_1", "Pebble_Square_2", "Pebble_Square_3"];
  const pied = piste.demi + piste.marge + 1.2;
  for (const c of cailloux) planter(groupe, c, varie(positions(piste, rnd, nb(8), pied, pied + 4), 0.7, 0.8), garde);
  planter(groupe, "Flower_3_Group", varie(zone(16, piste.demi + 2, 35), 0.8, 0.5), garde);
  planter(groupe, "Flower_4_Group", varie(zone(8, piste.demi + 2, 35), 0.8, 0.5), garde);
  planter(groupe, "Mushroom_Common", varie(zone(6, horsPiste - 1, 40), 0.8, 0.7), garde);
  sentiers(groupe, piste, rnd, nb(4), garde);

  // nids d'œufs (aucun modèle libre équivalent : formes simples, peu de triangles)
  const nid = fusion([
    { geo: new THREE.TorusGeometry(1, 0.35, 5, 9).rotateX(Math.PI / 2).translate(0, 0.3, 0), couleur: 0x9c7a4a },
    { geo: new THREE.SphereGeometry(0.45, 7, 5).scale(1, 1.35, 1).translate(-0.35, 0.6, 0), couleur: 0xfff3bf },
    { geo: new THREE.SphereGeometry(0.45, 7, 5).scale(1, 1.35, 1).translate(0.35, 0.6, 0.15), couleur: 0xd3f9d8 },
    { geo: new THREE.SphereGeometry(0.45, 7, 5).scale(1, 1.35, 1).translate(0, 0.6, -0.4), couleur: 0xffe8cc },
  ]);
  const nids = horsTroupeaux(positions(piste, rnd, nb(14), horsPiste, 40)).map((p) => ({ ...p, s: 1, r: rnd() * 6 })); // posés plus bas

  // volcan en éruption au fond de la plaine (vrai modèle 3D, fumée, lave : voir volcan.js)
  // (essais en développement : window.__volcanEssai = { angle, distance, echelle })
  const placeV = { ...PLACE_VOLCAN, ...(import.meta.env.DEV ? window.__volcanEssai : null) };
  const distV = placeV.distance || piste.rayon + 260;
  const xV = piste.centre.x + Math.cos(placeV.angle) * distV;
  const zV = piste.centre.z + Math.sin(placeV.angle) * distV;
  const ANGLE_VOLCAN = Math.atan2(zV - piste.centre.z, xV - piste.centre.x);
  const volcan = creerVolcan(groupe, xV, zV, { versPiste: Math.atan2(piste.centre.z - zV, piste.centre.x - xV), versVue: angleVueVolcan(piste, xV, zV), echelle: placeV.echelle });
  if (import.meta.env.DEV) Object.assign(window, { __volcan: volcan, __THREE: THREE });
  // la météorite qui grossit tour après tour et percute le volcan au 2e tour, puis le monde passe en lave (meteorite.js, lave.js)
  const meteorite = creerMeteorite(groupe, volcan, piste);
  if (import.meta.env.DEV) window.__meteorite = meteorite;
  // collines lointaines : même sol que la forêt (vraies textures), un peu plus sombres
  const collines = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    if (Math.abs(Math.atan2(Math.sin(a - ANGLE_VOLCAN), Math.cos(a - ANGLE_VOLCAN))) < 0.7) continue; // rien devant le volcan
    const r = piste.rayon + 230 + rnd() * 70;
    collines.push({ x: piste.centre.x + Math.cos(a) * r, y: -8, z: piste.centre.z + Math.sin(a) * r, s: 70 + rnd() * 50, sy: 30 + rnd() * 25, couleur: [0xa8b890, 0x98a882, 0xb4bc9c][i % 3] });
  }
  const sol = groupe.children.find((o) => o.isMesh && o.geometry?.type === "PlaneGeometry" && o.geometry.parameters.width >= 1000);
  groupe.add(instances(new THREE.SphereGeometry(1, 16, 10), sol?.material ?? new THREE.MeshLambertMaterial({ color: 0x74b816 }), collines));
  // pas de petit nuage blanc devant le volcan (ni devant son panache)
  nuages(groupe, piste, rnd, (a) => Math.abs(Math.atan2(Math.sin(a - ANGLE_VOLCAN), Math.cos(a - ANGLE_VOLCAN))) < 0.6);
  mixers.push(installerTrex(groupe, piste)); // T-rex géant couché : la route passe dans sa gueule et son ventre (ventre.js)
  diplodocus(piste, groupe); // après le T-rex : sa place ne change pas
  decorLooping(piste, groupe);
  ravinDuPtero(groupe, piste); // ligne droite du haut : le vide et le ptérodactyle
  mixers.push(aquariumGeant(groupe, piste)); // virages du bas : tunnel sous un aquarium géant (son update(dt) suit les mixers)
  mixers.push(installerBrachio(groupe, piste)); // fin du 1er virage : brachiosaure géant au-dessus de la route (coucou)
  // la jungle (imposteurs réalistes), une fois le ravin, le diplodocus, le T-rex et l'aquarium installés ;
  // rien sur le pied du volcan ni sur les troupeaux des plaines (ni dans piste.zonesDecor)
  if (import.meta.env.DEV) window.__troupeaux = Object.assign(clairieres, { plaines: PLAINES, trex, dinos: poses });
  // vélociraptors (meutes, chasseurs, coureurs) : placés maintenant que tous les grands décors sont sur la
  // piste ; leurs trajets sont réservés dans la garde (la jungle, les rochers et les plantes les évitent)
  const animerRaptors = installerRaptors(groupe, piste, { garde, plaines: PLAINES, clairieres, evite: [{ x: xV, z: zV, r: volcan.rayonPied + 5 }] });
  planterJungle(groupe, piste, rnd, garde, { plaines: PLAINES, exclusions: [{ x: xV, z: zV, r: volcan.rayonPied + 5 }, ...clairieres], trouee: troueesVolcan(piste, xV, zV) });
  // les nids passent par la garde une fois le ravin, le diplodocus et le T-rex installés
  groupe.add(instances(nid, matCouleurs(), nids.flatMap((p) => {
    const ok = garde.verifier(p.x, p.z, 1.4, 1.2, "nid");
    return ok ? [{ ...p, ...ok }] : [];
  })));

  return (dt, camera) => {
    volcan.update(dt, camera);
    meteorite.update(dt, camera); // avant le ventre et l'aquarium : ils gardent la main sur la brume
    for (const m of mixers) m.update(dt, camera);
    animerRaptors(dt, camera);
    // dinosaures qui marchent en rond, lentement, autour de leur troupeau
    for (const D of marcheurs) {
      D.a += D.w * dt;
      D.objet.position.set(D.cx + Math.cos(D.a) * D.R, 0, D.cz + Math.sin(D.a) * D.R);
      D.objet.rotation.y = Math.atan2(-Math.sin(D.a), Math.cos(D.a)); // tangente au cercle (modèles tournés vers +Z)
    }
  };
}

/** Direction (x, z) du volcan vers la caméra du kart, en moyenne sur le tour, là où on le voit : la face visible. */
function angleVueVolcan(piste, xV, zV) {
  let sx = 0, sz = 0;
  const N = piste.N;
  for (let i = 0; i < N; i += 4) {
    const j = (i + 3) % N, k = (i - 3 + N) % N;
    let dx = piste.cx[j] - piste.cx[k], dz = piste.cz[j] - piste.cz[k];
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    const cx = piste.cx[i] - dx * 7, cz = piste.cz[i] - dz * 7;
    let vx = xV - cx, vz = zV - cz;
    const lv = Math.hypot(vx, vz); vx /= lv; vz /= lv;
    if (vx * dx + vz * dz < Math.cos(0.8)) continue; // pas dans le champ
    sx -= vx; sz -= vz;
  }
  return Math.atan2(sz, sx);
}

/**
 * Trouées dans la jungle pour voir le volcan : partout où, depuis la caméra du kart, le volcan
 * est dans le champ (à moins de ~45° de l'axe), on ne plante pas d'arbres sur la ligne de vue,
 * entre 15 et 170 m de la caméra (bande de ~22 m de large). Grille de cases de 6 m (rapide).
 */
function troueesVolcan(piste, xV, zV) {
  const CASE = 6, R = piste.rayon + 300, NG = Math.ceil((2 * R) / CASE), grille = new Uint8Array(NG * NG);
  const x0 = piste.centre.x - R, z0 = piste.centre.z - R, N = piste.N;
  for (let i = 0; i < N; i += 6) {
    const j = (i + 3) % N, k = (i - 3 + N) % N;
    let dx = piste.cx[j] - piste.cx[k], dz = piste.cz[j] - piste.cz[k];
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    const cx = piste.cx[i] - dx * 7, cz = piste.cz[i] - dz * 7;
    let vx = xV - cx, vz = zV - cz;
    const lv = Math.hypot(vx, vz); vx /= lv; vz /= lv;
    if (vx * dx + vz * dz < Math.cos(0.8)) continue; // le volcan n'est pas dans le champ
    for (let d = 15; d < Math.min(170, lv - 150); d += 4)
      for (let s = -11; s <= 11; s += 4) {
        const gi = Math.floor((cx + vx * d - vz * s - x0) / CASE), gj = Math.floor((cz + vz * d + vx * s - z0) / CASE);
        if (gi >= 0 && gj >= 0 && gi < NG && gj < NG) grille[gj * NG + gi] = 1;
      }
  }
  return (x, z) => {
    const gi = Math.floor((x - x0) / CASE), gj = Math.floor((z - z0) / CASE);
    return gi >= 0 && gj >= 0 && gi < NG && gj < NG && grille[gj * NG + gi] === 1;
  };
}

// Volcan : voir volcan.js (modèle, matériau, éruption). Place : direction et distance depuis le
// centre du circuit, échelle du modèle.
// mesuré (outil de test : pixels du volcan vus depuis la caméra du kart, sur un tour) : plus près,
// un peu tourné et plus grand, il se voit 2 fois plus longtemps qu'à l'ancienne place (1,056 ; 533 m ; ×1)
const PLACE_VOLCAN = { angle: 0.85, distance: 560, echelle: 1.5 };

// ---------------------------------------------------------------------------
export function decorJouets(groupe, piste, rnd, horsPiste) {
  const vives = [0xff6b6b, 0xffd43b, 0x4dabf7, 0x51cf66, 0xf783ac, 0xff922b, 0x9775fa];

  // grosses briques à picots
  const picots = [];
  for (const x of [-1.5, -0.5, 0.5, 1.5]) for (const z of [-0.5, 0.5]) picots.push({ geo: new THREE.CylinderGeometry(0.32, 0.32, 0.3, 20).translate(x, 2.55, z), couleur: B });
  const brique = fusion([{ geo: boiteRonde(4, 2.4, 2).translate(0, 1.2, 0), couleur: B }, ...picots]);
  const briques = [];
  for (const p of positions(piste, rnd, 50, horsPiste, 90)) {
    const c = auHasard(rnd, vives), r = rnd() * 6;
    briques.push({ ...p, s: 1, r, couleur: c });
    if (rnd() < 0.5) briques.push({ x: p.x + 0.5, y: 2.4, z: p.z + 0.3, s: 1, r: r + (rnd() < 0.5 ? Math.PI / 2 : 0), couleur: auHasard(rnd, vives) });
  }
  groupe.add(instances(brique, matCouleurs(), briques));

  // cubes de bois empilés
  const cubes = [];
  for (const p of positions(piste, rnd, 25, horsPiste, 70)) {
    const r = rnd() * 6;
    for (const [dx, dy, dz] of [[0, 0, 0], [2.1, 0, 0], [1.05, 2, 0]]) {
      cubes.push({ x: p.x + Math.cos(r) * dx, y: dy, z: p.z + Math.sin(r) * dx + dz, s: 1, r: -r, couleur: auHasard(rnd, vives) });
    }
  }
  const cube = fusion([
    { geo: boiteRonde(2, 2, 2).translate(0, 1, 0), couleur: 0xf1d3a1 },
    { geo: boiteRonde(1.4, 1.4, 2.04).translate(0, 1, 0), couleur: B },
    { geo: boiteRonde(2.04, 1.4, 1.4).translate(0, 1, 0), couleur: B },
  ]);
  groupe.add(instances(cube, matCouleurs(), cubes));

  // crayons géants couchés
  const crayon = fusion([
    { geo: new THREE.CylinderGeometry(0.5, 0.5, 6, 12).rotateZ(Math.PI / 2).translate(0, 0.5, 0), couleur: B },
    { geo: new THREE.ConeGeometry(0.5, 1.2, 12).rotateZ(-Math.PI / 2).translate(3.6, 0.5, 0), couleur: 0xf1d3a1 },
    { geo: new THREE.ConeGeometry(0.17, 0.4, 12).rotateZ(-Math.PI / 2).translate(4.05, 0.5, 0), couleur: B },
    { geo: new THREE.CylinderGeometry(0.52, 0.52, 0.5, 12).rotateZ(Math.PI / 2).translate(-3.2, 0.5, 0), couleur: 0xffc9c9 },
  ]);
  groupe.add(instances(crayon, matCouleurs(), positions(piste, rnd, 30, horsPiste, 60).map((p) => ({ ...p, s: 1, r: rnd() * 6, couleur: auHasard(rnd, vives) }))));

  // ballons à bande blanche
  const ballon = fusion([
    { geo: new THREE.IcosahedronGeometry(1.4, 2).translate(0, 1.4, 0), couleur: B },
    { geo: new THREE.TorusGeometry(1.38, 0.18, 4, 16).translate(0, 1.4, 0), couleur: 0xffffff },
  ]);
  groupe.add(instances(ballon, matCouleurs(), positions(piste, rnd, 30, horsPiste, 70).map((p) => ({ ...p, s: 0.8 + rnd() * 0.6, r: rnd() * 6, couleur: auHasard(rnd, vives) }))));

  // nounours assis, tournés vers la piste
  const brun = 0xc08552, clair = 0xf1d3a1;
  const nounours = fusion([
    { geo: new THREE.SphereGeometry(1.2, 16, 13).scale(1, 1.15, 0.9).translate(0, 1.3, 0), couleur: brun },
    { geo: new THREE.SphereGeometry(0.75, 16, 13).scale(1, 1.1, 0.4).translate(0, 1.2, 0.75), couleur: clair },
    { geo: new THREE.SphereGeometry(0.9, 16, 13).translate(0, 3.0, 0), couleur: brun },
    { geo: new THREE.SphereGeometry(0.35, 13, 10).translate(0, 2.85, 0.8), couleur: clair },
    { geo: new THREE.IcosahedronGeometry(0.12, 1).translate(0, 2.95, 1.12), couleur: N },
    { geo: new THREE.IcosahedronGeometry(0.1, 1).translate(0.32, 3.25, 0.78), couleur: N },
    { geo: new THREE.IcosahedronGeometry(0.1, 1).translate(-0.32, 3.25, 0.78), couleur: N },
    { geo: new THREE.SphereGeometry(0.35, 13, 10).translate(0.65, 3.75, 0), couleur: brun },
    { geo: new THREE.SphereGeometry(0.35, 13, 10).translate(-0.65, 3.75, 0), couleur: brun },
    { geo: new THREE.SphereGeometry(0.4, 13, 10).scale(1, 1.6, 1).translate(1.2, 1.7, 0.3), couleur: brun },
    { geo: new THREE.SphereGeometry(0.4, 13, 10).scale(1, 1.6, 1).translate(-1.2, 1.7, 0.3), couleur: brun },
    { geo: new THREE.SphereGeometry(0.5, 13, 10).scale(1, 0.9, 1.6).translate(0.6, 0.45, 0.9), couleur: brun },
    { geo: new THREE.SphereGeometry(0.5, 13, 10).scale(1, 0.9, 1.6).translate(-0.6, 0.45, 0.9), couleur: brun },
    { geo: boiteRonde(1.0, 0.25, 0.25).translate(0, 2.25, 0.7), couleur: 0xff6b6b }, // nœud papillon
  ]);
  groupe.add(instances(nounours, matCouleurs(), positions(piste, rnd, 14, horsPiste, 45).map((p) => ({ ...p, s: 1.3, r: versPiste(piste, p) }))));

  // toupies qui tournent
  const toupie = fusion([
    { geo: new THREE.ConeGeometry(1, 1.2, 20).rotateX(Math.PI).translate(0, 0.6, 0), couleur: B },
    { geo: new THREE.CylinderGeometry(1.05, 1.05, 0.25, 20).translate(0, 1.25, 0), couleur: 0xffffff },
    { geo: new THREE.ConeGeometry(1, 0.6, 20).translate(0, 1.65, 0), couleur: B },
    { geo: new THREE.CylinderGeometry(0.1, 0.1, 0.7, 12).translate(0, 2.2, 0), couleur: 0x8b5a2b },
  ]);
  const toupies = positions(piste, rnd, 12, horsPiste, 40).map((p) => ({ ...p, s: 1.2, r: 0, couleur: auHasard(rnd, vives) }));
  const mesToupies = instances(toupie, matCouleurs(), toupies);
  groupe.add(mesToupies);

  // piles de livres géants au loin
  const livres = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const r = piste.rayon + 200 + rnd() * 80;
    let y = 0;
    for (let k = 0; k < 3 + Math.floor(rnd() * 3); k++) {
      const h = 10 + rnd() * 8;
      livres.push({ x: piste.centre.x + Math.cos(a) * r, y, z: piste.centre.z + Math.sin(a) * r, s: 1, r: rnd() * 6, couleur: auHasard(rnd, vives), h });
      y += h;
    }
  }
  const livre = fusion([
    { geo: boiteRonde(60, 1, 40).translate(0, 0.5, 0), couleur: B },
    { geo: boiteRonde(58, 0.9, 38).translate(1.2, 0.5, 0), couleur: 0xfffaf0 },
  ]);
  groupe.add(instances(livre, matCouleurs(), livres.map((l) => ({ ...l, sy: l.h }))));

  nuages(groupe, piste, rnd);

  let t = 0;
  const o = new THREE.Object3D();
  return (dt) => {
    t += dt;
    toupies.forEach((p, i) => {
      o.position.set(p.x + Math.sin(t * 0.7 + i) * 0.6, 0, p.z + Math.cos(t * 0.6 + i) * 0.6);
      o.rotation.set(Math.sin(t * 2 + i) * 0.08, t * 8 + i, 0);
      o.scale.setScalar(p.s);
      o.updateMatrix();
      mesToupies.setMatrixAt(i, o.matrix);
    });
    mesToupies.instanceMatrix.needsUpdate = true;
  };
}

// ---------------------------------------------------------------------------
function textureEcran() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d");
  const d = g.createLinearGradient(0, 0, 256, 128);
  d.addColorStop(0, "#ff4dd2");
  d.addColorStop(0.5, "#7b2cff");
  d.addColorStop(1, "#22b8cf");
  g.fillStyle = d;
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = "#fff";
  g.font = "bold 70px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("♪ ★ ♫", 128, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function decorConcert(groupe, piste, rnd, horsPiste) {
  const neons = [0xff4dd2, 0x22b8cf, 0xffd43b, 0x9775fa, 0x69db7c, 0xff922b];

  // la scène, face à la ligne droite de départ
  const i0 = Math.floor(piste.N * 0.04);
  const cote = 1;
  const dist = piste.demi + piste.marge + 18;
  const sx = piste.cx[i0] + piste.nx[i0] * dist * cote, sz = piste.cz[i0] + piste.nz[i0] * dist * cote;
  const scene = new THREE.Group();
  scene.position.set(sx, 0, sz);
  scene.rotation.y = Math.atan2(-piste.nx[i0] * cote, -piste.nz[i0] * cote); // regarde la piste
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: false });
  const sol = new THREE.Mesh(boiteRonde(30, 2, 14), mat(0x343a40));
  sol.position.set(0, 1, 0);
  const fond = new THREE.Mesh(boiteRonde(30, 14, 1), mat(0x212529));
  fond.position.set(0, 9, -6.5);
  const ecran = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), new THREE.MeshBasicMaterial({ map: textureEcran(), fog: false }));
  ecran.position.set(0, 10, -5.9);
  scene.add(sol, fond, ecran);
  // enceintes
  const enceinte = fusion([
    { geo: boiteRonde(3, 4, 2.4).translate(0, 2, 0), couleur: 0x1a1a1a },
    { geo: new THREE.CylinderGeometry(0.9, 0.9, 0.1, 12).rotateX(Math.PI / 2).translate(0, 2.6, 1.22), couleur: 0x555555 },
    { geo: new THREE.CylinderGeometry(0.45, 0.45, 0.1, 12).rotateX(Math.PI / 2).translate(0, 1.0, 1.22), couleur: 0x555555 },
  ]);
  scene.add(instances(enceinte, matCouleurs(), [
    { x: -13, y: 2, z: 2, s: 1 }, { x: 13, y: 2, z: 2, s: 1 }, { x: -13, y: 6, z: 2, s: 1 }, { x: 13, y: 6, z: 2, s: 1 },
  ]));
  // boule à facettes
  const boule = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 2), new THREE.MeshLambertMaterial({ color: 0xdee2e6, flatShading: false, emissive: 0x333333 }));
  boule.position.set(0, 15.5, 2);
  scene.add(boule);
  groupe.add(scene);

  // tours de lumière avec projecteurs colorés qui balaient le ciel
  const projecteurs = [];
  const geoFaisceau = new THREE.ConeGeometry(4, 40, 12, 1, true).translate(0, -20, 0).rotateX(Math.PI); // pointe en bas
  for (const p of positions(piste, rnd, 10, horsPiste + 2, 45)) {
    const mat2 = new THREE.MeshLambertMaterial({ color: 0x495057 });
    const poteau = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 10, 12), mat2);
    poteau.position.set(p.x, 5, p.z);
    groupe.add(poteau);
    const pivot = new THREE.Group();
    pivot.position.set(p.x, 10, p.z);
    const faisceau = new THREE.Mesh(geoFaisceau, new THREE.MeshBasicMaterial({
      color: auHasard(rnd, neons), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    pivot.add(faisceau);
    groupe.add(pivot);
    projecteurs.push({ pivot, phase: rnd() * 6 });
  }

  // notes de musique flottantes
  const note = fusion([
    { geo: new THREE.SphereGeometry(0.5, 13, 10).scale(1.3, 1, 0.5).translate(0, 0.5, 0), couleur: B },
    { geo: boiteRonde(0.14, 2.2, 0.14).translate(0.58, 1.6, 0), couleur: B },
    { geo: boiteRonde(0.7, 0.3, 0.14).rotateZ(-0.4).translate(0.85, 2.55, 0), couleur: B },
  ]);
  const notes = positions(piste, rnd, 40, horsPiste, 70).map((p) => ({ ...p, y: 3 + rnd() * 6, s: 1 + rnd(), r: rnd() * 6, couleur: auHasard(rnd, neons) }));
  const mesNotes = instances(note, new THREE.MeshBasicMaterial({ vertexColors: true }), notes);
  groupe.add(mesNotes);

  // ballons
  const ballon = fusion([
    { geo: new THREE.SphereGeometry(0.9, 16, 13).scale(1, 1.2, 1).translate(0, 4, 0), couleur: B },
    { geo: new THREE.CylinderGeometry(0.02, 0.02, 3, 12).translate(0, 1.5, 0), couleur: 0xdddddd },
  ]);
  groupe.add(instances(ballon, matCouleurs(), positions(piste, rnd, 50, piste.demi + 2.5, 50).map((p) => ({ ...p, s: 1, r: 0, couleur: auHasard(rnd, neons) }))));

  // étoiles
  const nb = 500, pos = new Float32Array(nb * 3);
  for (let i = 0; i < nb; i++) {
    const a = rnd() * Math.PI * 2, h = 0.15 + rnd() * 0.85;
    const r = 700 * Math.sqrt(1 - h * h);
    pos.set([piste.centre.x + Math.cos(a) * r, 700 * h, piste.centre.z + Math.sin(a) * r], i * 3);
  }
  const geoEt = new THREE.BufferGeometry();
  geoEt.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  groupe.add(new THREE.Points(geoEt, new THREE.PointsMaterial({ color: 0xffffff, size: 2.5, sizeAttenuation: false, fog: false })));

  let t = 0;
  const o = new THREE.Object3D();
  return (dt) => {
    t += dt;
    for (const p of projecteurs) p.pivot.rotation.set(Math.sin(t * 0.7 + p.phase) * 0.6, 0, Math.cos(t * 0.5 + p.phase) * 0.6);
    boule.rotation.y += dt * 0.8;
    notes.forEach((n, i) => {
      o.position.set(n.x, n.y + Math.sin(t * 1.5 + i) * 0.8, n.z);
      o.rotation.set(0, n.r + t * 0.8, Math.sin(t + i) * 0.2);
      o.scale.setScalar(n.s);
      o.updateMatrix();
      mesNotes.setMatrixAt(i, o.matrix);
    });
    mesNotes.instanceMatrix.needsUpdate = true;
  };
}

// ---------------------------------------------------------------------------
/** Surface à facettes passant par une suite de sections (même nombre de points par section). */
function loft(sections, couleur, double = true) {
  const pos = [];
  for (let s = 0; s < sections.length - 1; s++) {
    const A = sections[s], B = sections[s + 1];
    for (let k = 0; k < A.pts.length - 1; k++) {
      const a0 = [A.pts[k][0], A.pts[k][1], A.z], a1 = [A.pts[k + 1][0], A.pts[k + 1][1], A.z];
      const b0 = [B.pts[k][0], B.pts[k][1], B.z], b1 = [B.pts[k + 1][0], B.pts[k + 1][1], B.z];
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: couleur, flatShading: true, side: double ? THREE.DoubleSide : THREE.FrontSide }));
}

/** Bouchon plat (éventail) qui ferme une section. */
function bouchon(section, couleur) {
  const pos = [];
  const c = section.pts.reduce((m, p) => [m[0] + p[0] / section.pts.length, m[1] + p[1] / section.pts.length], [0, 0]);
  for (let k = 0; k < section.pts.length - 1; k++)
    pos.push(c[0], c[1], section.z, section.pts[k][0], section.pts[k][1], section.z, section.pts[k + 1][0], section.pts[k + 1][1], section.z);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: couleur, flatShading: true, side: THREE.DoubleSide }));
}

/** Indice de la ligne droite la plus longue autour d'une position voulue, loin des tremplins. */
function ligneDroite(piste, fraction, eviter = []) {
  const N = piste.N;
  const enveloppe = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const courbure = (i) => Math.abs(enveloppe(piste.angleA((i + 25) % N) - piste.angleA((i - 25 + N) % N)));
  let i = Math.floor(N * fraction), cMin = Infinity;
  for (let k = -Math.floor(N * 0.25); k <= N * 0.25; k++) {
    const j = (Math.floor(N * fraction) + k + N) % N;
    if (j < 50 || j > N - 70) continue;
    if (piste.tremplins.some((t) => Math.abs(t.debut - j) < 60)) continue;
    if (eviter.some((e) => Math.abs(e - j) < 90)) continue;
    const c = courbure(j) + Math.abs(k) * 0.0005;
    if (c < cMin) { cMin = c; i = j; }
  }
  return i;
}

/**
 * Tunnel : une énorme tête de T-rex posée en travers de la route, gueule grande ouverte.
 * On entre par la gueule (sur la langue) et on ressort par l'arrière de la tête.
 * Couleurs et facettes reprises du vrai modèle de T-rex (pack Quaternius).
 */
function tunnelTrex(piste) {
  const i = ligneDroite(piste, 0.55);
  const VERT = 0x5a6b4e, OLIVE = 0x848164, BEIGE = 0xb9935f, ROUGE = 0x863f45, NOIR = 0x161616;
  const tete = new THREE.Group();
  tete.userData.indice = i;
  const L = piste.demi + piste.marge + 2; // demi-largeur de la gueule (au-delà des barrières)
  const pal = 8.5; // hauteur du palais

  // crâne : sections du bout du museau (z = -22) jusqu'à l'arrière (z = +20)
  const section = (z, haut, w) => ({
    z,
    pts: [[-(w - 2.2), pal], [-w, pal + 1.4], [-w, pal + 4], [-w * 0.7, haut - 0.8], [0, haut], [w * 0.7, haut - 0.8], [w, pal + 4], [w, pal + 1.4], [w - 2.2, pal]],
  });
  const W = L + 3;
  const crane = [section(-22, 12.5, W - 0.5), section(-14, 14, W), section(-4, 15.5, W + 0.3), section(6, 18.5, W + 0.8), section(14, 18, W + 0.5), section(20, 16, W)];
  tete.add(loft(crane, VERT));
  tete.add(bouchon(crane[0], VERT)); // bout du museau
  // dessous de la lèvre du haut, plus clair
  tete.add(loft(crane.map((c) => ({ z: c.z, pts: [[-(W - 2.2), pal], [-(W - 2.2), pal - 0.6], [W - 2.2, pal - 0.6], [W - 2.2, pal]] })), OLIVE));
  // palais (intérieur de la gueule)
  const palais = new THREE.Mesh(new THREE.PlaneGeometry(2 * (W - 2.2), 42), new THREE.MeshBasicMaterial({ color: 0x5c1f26, side: THREE.DoubleSide }));
  palais.rotation.x = Math.PI / 2;
  palais.position.set(0, pal - 0.62, -1);
  tete.add(palais);

  // mâchoire du bas : deux côtés posés au sol, de part et d'autre de la route
  const matDent = new THREE.MeshLambertMaterial({ color: 0xfff8e1, flatShading: true });
  for (const sx of [1, -1]) {
    const mach = [];
    for (const [z, h] of [[-21, 2.6], [-10, 3.4], [2, 4.4], [12, 5.2], [20, 5]]) {
      mach.push({ z, pts: [[sx * L, 0], [sx * L, h], [sx * (L + 1.6), h + 0.5], [sx * W, h - 0.4], [sx * (W + 0.4), 0]] });
    }
    tete.add(loft(mach, BEIGE));
    // intérieur des joues (rouge sombre)
    const joue = new THREE.Mesh(new THREE.PlaneGeometry(40, pal), new THREE.MeshBasicMaterial({ color: ROUGE, side: THREE.DoubleSide }));
    joue.rotation.y = Math.PI / 2;
    joue.position.set(sx * (L - 0.05), pal / 2, -1);
    tete.add(joue);
    // dents du haut (pendent des gencives) et du bas (sortent de la mâchoire)
    for (let z = -20; z <= 8; z += 2.8) {
      const d = new THREE.Mesh(new THREE.ConeGeometry(0.85, 2.8, 5), matDent);
      d.rotation.x = Math.PI;
      d.position.set(sx * (W - 2.6), pal - 1.4, z);
      tete.add(d);
      if (z < 6) {
        const b = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.4, 5), matDent);
        const hm = 2.6 + ((z + 21) / 41) * 2.4;
        b.position.set(sx * (L + 0.8), hm + 1.1, z + 1.4);
        tete.add(b);
      }
    }
    // œil jaune avec pupille fendue, et arcade osseuse au-dessus
    const oeil = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8, 1), new THREE.MeshLambertMaterial({ color: 0xf2c94c, flatShading: true }));
    oeil.position.set(sx * (W + 0.2), 14.5, 6);
    tete.add(oeil);
    const pupille = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.5), new THREE.MeshBasicMaterial({ color: NOIR }));
    pupille.position.set(sx * (W + 1.85), 14.5, 6);
    tete.add(pupille);
    const arcade = new THREE.Mesh(new THREE.ConeGeometry(1.8, 4.5, 4), new THREE.MeshLambertMaterial({ color: OLIVE, flatShading: true }));
    arcade.rotation.set(Math.PI / 2, 0, sx * 0.4);
    arcade.position.set(sx * (W - 0.4), 17.2, 5);
    tete.add(arcade);
    // narine
    const narine = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: NOIR }));
    narine.scale.set(1, 0.5, 1.4);
    narine.position.set(sx * 4, 12.6, -19.5);
    tete.add(narine);
  }
  // rangée de dents à l'avant du museau
  for (let x = -(W - 3); x <= W - 3; x += 2.9) {
    const d = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3, 5), matDent);
    d.rotation.x = Math.PI;
    d.position.set(x, pal - 1.5, -21);
    tete.add(d);
  }
  // langue sur la route
  const langue = new THREE.Mesh(new THREE.CircleGeometry(1, 32).scale(7, 18, 1), new THREE.MeshLambertMaterial({ color: 0xc2526a }));
  langue.rotation.x = -Math.PI / 2;
  langue.position.set(0, 0.045, -2);
  tete.add(langue);

  // cou qui part sur le côté gauche, et dos qui dépasse du sol (le reste est "enterré")
  const matVert = new THREE.MeshLambertMaterial({ color: VERT, flatShading: true });
  const cou = new THREE.Mesh(new THREE.CylinderGeometry(7, 9, 26, 7), matVert);
  cou.position.set(W + 8, 7, 18);
  cou.rotation.set(0, 0, 1.15);
  tete.add(cou);
  const dos = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), matVert);
  dos.scale.set(14, 9, 20);
  dos.position.set(W + 26, 0, 24);
  tete.add(dos);
  const ventre = new THREE.Mesh(new THREE.SphereGeometry(1, 9, 6), new THREE.MeshLambertMaterial({ color: BEIGE, flatShading: true }));
  ventre.scale.set(12, 5, 17);
  ventre.position.set(W + 22, 0, 22);
  tete.add(ventre);

  tete.position.set(piste.cx[i], 0, piste.cz[i]);
  tete.rotation.y = piste.angleA(i);
  return tete;
}

// ---------------------------------------------------------------------------
/**
 * Diplodocus géant couché SUR la route : vrai modèle de sauropode ("Brachiosaurus_AR card" de
 * Zinaida.Kovrova, CC-BY 4.0) mis en pose couchée avec son squelette dans Blender
 * (outils/blender/coucher_sauropode.py) : ventre au sol, pattes repliées, cou tendu jusqu'à la
 * tête posée par terre, queue droite. Il occupe presque toute la ligne droite de droite : la
 * route se resserre jusqu'à un petit talus de terre devant son museau, on monte sur sa tête (le
 * talus est étroit et bas : on voit ses yeux et sa mâchoire sur les côtés), on remonte son cou
 * jusqu'au dos, puis on redescend par sa queue. Tout le monde passe dessus (joueur et adversaires).
 *
 * Le modèle est agrandi uniformément (~4,3 m par unité), tête, cou, dos et queue un peu
 * élargis pour qu'on y roule ; il est "plié" le long de la ligne centrale. La hauteur est
 * mesurée en "dessinant" ses triangles dans une grille (piste.surfaces) : les karts roulent sur
 * ce qu'on voit. Sur le corps, des barrières invisibles (piste.retrecissements) empêchent de
 * tomber sur les côtés.
 */
const DIPLO = {
  longueur: 108, // m, du bout du museau au bout de la queue
  // élargissement en travers (1 = agrandissement uniforme), le long du corps (u : 0 = museau, 1 = queue)
  largeur: [[0, 2.1], [0.04, 2.0], [0.1, 1.75], [0.3, 1.7], [0.38, 1.3], [0.45, 1.2], [0.6, 1.2], [0.7, 1.3], [1, 1.4]],
  // demi-largeur où l'on roule (barrières invisibles) : tête, cou, dos, queue ; au bout de la
  // queue (basse) plus de barrière, on redescend sur la route
  voie: [[0, 2.3], [0.08, 2.8], [0.15, 3.1], [0.3, 3.2], [0.4, 3.6], [0.62, 3.6], [0.7, 3.0], [0.8, 2.4], [0.88, 1.8], [0.97, 0.8]],
  finVoie: 0.97,
  entonnoir: 55, // m avant le museau où la route se resserre (rochers de chaque côté)
  // talus de terre devant le museau : il monte jusqu'à un peu sous le bout du museau ; son
  // dessus a la largeur de la voie, ses flancs sont raides (on voit la mâchoire et les yeux)
  butte: { longueur: 12, demiHaut: 2.4, joint: 0.3, marche: 0.8 },
  // rochers de l'entonnoir : rayon réel au sol (rochers réalistes de vegetation.js, REMPLACEMENTS)
  // et marge pour qu'aucun ne déborde sur la voie (demi-largeur d'un kart comprise)
  rochers: { Rock_Medium_1: 1.72, Rock_Medium_2: 1.72, Rock_Medium_3: 2.25 },
  margeRochers: 0.9 + 0.4,
  // barrières sur le corps : jusqu'où le dessus peut descendre sous le milieu, marge, minimum
  bord: { descente: 1.8, marge: 0.3, min: 0.6 },
};
const interpole = (table, u) => {
  if (u <= table[0][0]) return table[0][1];
  for (let k = 1; k < table.length; k++) {
    if (u <= table[k][0]) {
      const [u0, a] = table[k - 1], [u1, b] = table[k];
      const t = (u - u0) / (u1 - u0);
      return a + (b - a) * t * t * (3 - 2 * t);
    }
  }
  return table[table.length - 1][1];
};
const doux = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Dessine des triangles (s, latéral, y) dans une grille de hauteurs : on garde le plus haut. */
function dessinerDansGrille(g, S, L, Y, index, nbSommets) {
  const nTri = index ? index.length / 3 : nbSommets / 3;
  const sommet = (m) => (index ? index[m] : m);
  for (let t = 0; t < nTri; t++) {
    const A = sommet(3 * t), B = sommet(3 * t + 1), C = sommet(3 * t + 2);
    const ua = S[A] / g.pas + g.avant, ub = S[B] / g.pas + g.avant, uc = S[C] / g.pas + g.avant;
    const va = (L[A] - g.latMin) / g.pasLat, vb = (L[B] - g.latMin) / g.pasLat, vc = (L[C] - g.latMin) / g.pasLat;
    const det = (vb - va) * (uc - ua) - (vc - va) * (ub - ua);
    if (Math.abs(det) < 1e-9) continue; // triangle vu par la tranche
    for (let i = Math.max(0, Math.ceil(Math.min(ua, ub, uc))); i <= Math.min(g.nb - 1, Math.floor(Math.max(ua, ub, uc))); i++) {
      for (let j = Math.max(0, Math.ceil(Math.min(va, vb, vc))); j <= Math.min(g.nbLat - 1, Math.floor(Math.max(va, vb, vc))); j++) {
        const wb = ((j - va) * (uc - ua) - (vc - va) * (i - ua)) / det;
        const wc = ((vb - va) * (i - ua) - (j - va) * (ub - ua)) / det;
        if (wb < -1e-6 || wc < -1e-6 || wb + wc > 1 + 1e-6) continue;
        const y = Y[A] + (Y[B] - Y[A]) * wb + (Y[C] - Y[A]) * wc;
        if (y > g.h[i * g.nbLat + j]) g.h[i * g.nbLat + j] = y;
      }
    }
  }
}

function diplodocus(piste, groupe) {
  const N = piste.N, pas = piste.pas;
  const nbLong = Math.ceil(DIPLO.longueur / pas);
  const B = DIPLO.butte;
  // ligne droite de droite : butte et museau au début, la queue redescend juste avant le virage
  const iMuseau = ligneDroiteLongue(piste, 0.372, 25, DIPLO.longueur + 3, 0.015);

  // 1. entonnoir jusqu'à la butte, puis la voie sur le corps (une barrière par échantillon)
  const debutEntonnoir = (iMuseau - Math.round(DIPLO.entonnoir / pas) + N) % N;
  piste.retrecissements.push({ debut: debutEntonnoir, fin: (iMuseau + 2) % N, demiMin: DIPLO.voie[0][1] });
  // (largeurs prévues ; une fois le modèle chargé, chacune est réglée sur la largeur du dessus)
  const nbVoie = Math.round((DIPLO.finVoie * DIPLO.longueur) / pas);
  const murs = [];
  for (let k = 0; k <= nbVoie; k++) {
    // { debut: j - 1, fin: j } : étroit exactement à l'échantillon j (voir piste.limiteLaterale)
    const j = (iMuseau + k) % N;
    murs.push({ debut: (j - 1 + N) % N, fin: j, demiMin: interpole(DIPLO.voie, (k * pas) / DIPLO.longueur) });
  }
  piste.retrecissements.push(...murs);
  piste.diplodocus = { indice: iMuseau, fin: (iMuseau + nbLong) % N, debutEntonnoir };
  // +Z du modèle d'un côté ou de l'autre de la route : sans effet miroir (triangles dans le bon sens)
  const sens = Math.sign(piste.tx[iMuseau] * piste.nz[iMuseau] - piste.tz[iMuseau] * piste.nx[iMuseau]) || 1;

  // rochers le long de l'entonnoir (ce sont eux qui "font" les murs avant le museau) : chacun
  // entièrement hors de la voie permise par les barrières, rayon réel compris (on ne passe jamais
  // "à travers" un rocher) ; aucun à côté de la tête ni du talus (on voit le visage)
  const ROCHERS = Object.keys(DIPLO.rochers);
  const rochers = ROCHERS.map(() => []);
  const nbEntonnoir = (iMuseau - debutEntonnoir + N) % N;
  for (let k = 0; k <= nbEntonnoir; k += 3) {
    const j = (debutEntonnoir + k) % N;
    const avantMuseau = (nbEntonnoir - k) * pas;
    if (avantMuseau < B.longueur + 2) continue;
    for (const s of [1, -1]) {
      const n = (k / 3 + (s > 0 ? 1 : 2)) % 3, e = 1 + ((k * 7) % 5) * 0.08;
      const rayon = DIPLO.rochers[ROCHERS[n]] * e;
      // la voie la plus large sur toute l'étendue du rocher (l'entonnoir se resserre)
      let voie = 0;
      for (let d = -Math.ceil(rayon / pas); d <= Math.ceil(rayon / pas); d++) voie = Math.max(voie, piste.limiteLaterale((j + d + N) % N));
      const l = voie + DIPLO.margeRochers + rayon;
      if (l - rayon > piste.demi + piste.marge) continue;
      rochers[n].push({ x: piste.cx[j] + piste.nx[j] * s * l, z: piste.cz[j] + piste.nz[j] * s * l, s: e, y: -0.2, r: k * 1.3 + s });
    }
  }
  ROCHERS.forEach((nom, n) => planter(groupe, nom, rochers[n]));

  new GLTFLoader().loadAsync(import.meta.env.BASE_URL + "dinos/diplodocus.glb").then((gltf) => {
    let mesh = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    gltf.scene.updateMatrixWorld(true);
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    const pos = geo.attributes.position, nor = geo.attributes.normal;
    const n = pos.count;
    // modèle couché le long de X (tête vers -X), ventre sur y = 0, dos centré sur z = 0
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    const E = DIPLO.longueur / (b.max.x - b.min.x); // mètres par unité du modèle
    const u = new Float32Array(n), S = new Float32Array(n), Lt = new Float32Array(n), Y = new Float32Array(n);
    let lMin = Infinity, lMax = -Infinity;
    for (let k = 0; k < n; k++) {
      u[k] = (pos.getX(k) - b.min.x) / (b.max.x - b.min.x);
      S[k] = u[k] * DIPLO.longueur;
      Lt[k] = sens * pos.getZ(k) * E * interpole(DIPLO.largeur, u[k]);
      Y[k] = pos.getY(k) * E;
      lMin = Math.min(lMin, Lt[k]); lMax = Math.max(lMax, Lt[k]);
    }

    // pliage le long de la ligne centrale (interpolée entre deux échantillons)
    const plier = (s, l, y, cible) => {
      const f = s / pas, i0 = Math.floor(f), t = f - i0;
      const a = (iMuseau + i0 + N) % N, c = (a + 1) % N;
      const x = piste.cx[a] + (piste.cx[c] - piste.cx[a]) * t, z = piste.cz[a] + (piste.cz[c] - piste.cz[a]) * t;
      const nx = piste.nx[a] + (piste.nx[c] - piste.nx[a]) * t, nz = piste.nz[a] + (piste.nz[c] - piste.nz[a]) * t;
      const ln = Math.hypot(nx, nz);
      return cible.set(x + (nx / ln) * l, y, z + (nz / ln) * l);
    };
    const v = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      plier(S[k], Lt[k], Y[k], v);
      pos.setXYZ(k, v.x, v.y, v.z);
      if (nor) {
        // normale : même repère (le long, en haut, en travers), corrigée de l'élargissement
        const a = (iMuseau + Math.floor(S[k] / pas)) % N;
        const ns = nor.getX(k), ny = nor.getY(k), nl = (sens * nor.getZ(k)) / interpole(DIPLO.largeur, u[k]);
        v.set(piste.tx[a] * ns + piste.nx[a] * nl, ny, piste.tz[a] * ns + piste.nz[a] * nl).normalize();
        nor.setXYZ(k, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
    if (!nor) geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const m0 = mesh.material; // peau réaliste du modèle (couleur + relief)
    if (m0.map) m0.map.anisotropy = 4;
    const dino = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({
      map: m0.map, normalMap: m0.normalMap, normalScale: new THREE.Vector2(1, 1), shininess: 12, specular: 0x1c1a18, color: 0xffffff,
    }));
    dino.name = "diplodocus";
    groupe.add(dino);

    // grille de hauteurs : chaque triangle est "dessiné" dans la grille (s, latéral), on garde le plus haut
    const avant = Math.ceil((B.longueur + 2) / pas); // la butte devant le museau est dans la grille
    const latMin = Math.floor(lMin) - 1;
    const g = { pas, avant, latMin, pasLat: 0.25, nb: nbLong + avant + 3 };
    g.nbLat = Math.ceil((lMax + 1 - latMin) / g.pasLat) + 1;
    g.h = new Float32Array(g.nb * g.nbLat);
    dessinerDansGrille(g, S, Lt, Y, geo.index ? geo.index.array : null, n);

    // 2. talus de terre devant le museau : il monte jusqu'à un peu sous le bout du museau (au
    // joint), ensuite on roule sur le museau puis le dessus de la tête
    const jc = Math.round(-latMin / g.pasLat);
    const hc = (s) => g.h[Math.round(s / pas + avant) * g.nbLat + jc];
    let hTete = 0;
    for (let s = 0; s < 8; s += 0.25) hTete = Math.max(hTete, hc(s));
    let sJ = 0;
    while (hc(sJ) < hTete * B.joint && sJ < 8) sJ += 0.25;
    // le talus s'arrête un peu plus bas que le bout du museau (marche douce : on voit la bouche)
    const hJ = Math.max(0.5, hc(sJ) - B.marche);
    // coupe du museau au joint : le haut du talus suit sa forme en travers
    const rangJ = Math.round(sJ / pas + avant) * g.nbLat;
    const coupe = (l) => {
      const f = Math.min(g.nbLat - 1, Math.max(0, (l - latMin) / g.pasLat)), j0 = Math.floor(f), j1 = Math.min(g.nbLat - 1, j0 + 1);
      return g.h[rangJ + j0] + (g.h[rangJ + j1] - g.h[rangJ + j0]) * (f - j0) - 0.05;
    };
    const butte = butteDeTerre(B, sJ, hJ, coupe);
    dessinerDansGrille(g, butte.S, butte.L, butte.Y, butte.index, butte.S.length);
    const pb = butte.geo.attributes.position;
    for (let k = 0; k < pb.count; k++) {
      plier(butte.S[k], butte.L[k], butte.Y[k], v);
      pb.setXYZ(k, v.x, v.y, v.z);
    }
    butte.geo.computeVertexNormals();
    let ny = 0;
    for (let k = 0; k < pb.count; k++) ny += butte.geo.attributes.normal.getY(k);
    if (ny < 0) {
      // triangles dans le mauvais sens (selon le côté de la route) : on les retourne
      const ix = butte.geo.index.array;
      for (let k = 0; k < ix.length; k += 3) [ix[k + 1], ix[k + 2]] = [ix[k + 2], ix[k + 1]];
      butte.geo.computeVertexNormals();
    }
    const mButte = new THREE.Mesh(butte.geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mButte.name = "butte-diplodocus";
    groupe.add(mButte);

    // 3. sol un peu lissé là où l'on roule (plis de la peau), jamais à plus de 0,3 m de ce qu'on voit
    const brut = g.h.slice();
    const src = g.h.slice();
    for (let i = 1; i < g.nb - 1; i++) {
      for (let j = 1; j < g.nbLat - 1; j++) {
        const k = i * g.nbLat + j;
        if (brut[k] <= 0.05) continue;
        let s = 0, c = 0;
        for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
          const h = src[k + di * g.nbLat + dj];
          if (h > 0.05) { s += h; c++; }
        }
        g.h[k] = Math.min(brut[k] + 0.25, Math.max(brut[k] - 0.25, s / c));
      }
    }
    // dans les descentes, pas de cassure trop raide (sinon on s'envole loin à pleine vitesse)
    const chuteMax = 0.5 * pas;
    for (let j = 0; j < g.nbLat; j++) {
      for (let i = 1; i < g.nb; i++) {
        const k = i * g.nbLat + j;
        if (brut[k] <= 0.05) continue;
        g.h[k] = Math.max(g.h[k], Math.min(brut[k] + 0.25, g.h[k - g.nbLat] - chuteMax));
      }
    }
    // 4. barrières réglées sur ce qu'on voit : à chaque échantillon du corps, demi-largeur où le
    // dessus reste à moins de DIPLO.bord.descente sous le milieu, des deux côtés (au plus la
    // largeur prévue) ; puis la plus étroite des voisines, pour ne jamais rouler au bord du vide
    const H = (i, l) => g.h[i * g.nbLat + Math.min(g.nbLat - 1, Math.max(0, Math.round((l - latMin) / g.pasLat)))];
    const largeurs = murs.map((m, k) => {
      const i = k + avant, hm = H(i, 0);
      if (hm < 1) return m.demiMin;
      let w = 0;
      while (w < m.demiMin + DIPLO.bord.marge && H(i, -w - g.pasLat) > hm - DIPLO.bord.descente && H(i, w + g.pasLat) > hm - DIPLO.bord.descente) w += g.pasLat;
      return Math.max(DIPLO.bord.min, Math.min(m.demiMin, w - DIPLO.bord.marge));
    });
    murs.forEach((m, k) => {
      let w = Infinity;
      for (let d = -1; d <= 1; d++) if (largeurs[k + d] !== undefined) w = Math.min(w, largeurs[k + d]);
      m.demiMin = w;
    });

    const debut = (iMuseau - avant + N) % N;
    const surface = { debut, nb: g.nb, latMin, pasLat: g.pasLat, nbLat: g.nbLat, h: g.h };
    piste.surfaces.push(surface);
    Object.assign(piste.diplodocus, { objet: dino, surface, hauteurTete: hTete, joint: sJ });
  });
}

/**
 * Talus de terre et de cailloux qui monte doucement de la route jusque sur le museau du
 * diplodocus (s = sJ, hauteur hJ, forme en travers coupe(l)). Ses flancs sont raides pour qu'on
 * voie la mâchoire et les yeux. Coordonnées (s, latéral, y) ; le pliage le long de la route est
 * fait après.
 */
function butteDeTerre(B, sJ, hJ, coupe) {
  const nS = 26, nL = 44;
  const s0 = sJ - B.longueur;
  const S = [], L = [], Y = [], col = [];
  const terre = new THREE.Color(0x7a6146), cailloux = new THREE.Color(0x8e8a80), herbe = new THREE.Color(0x6f8a3a);
  const c = new THREE.Color();
  // 3 rangées de plus sous le museau : elles bouchent le creux entre le talus et la tête
  for (let a = 0; a <= nS + 3; a++) {
    const t = Math.min(1, a / nS);
    const s = s0 + t * B.longueur + Math.max(0, a - nS) * 0.5;
    const h = hJ * (t * t * (3 - 2 * t) * 0.6 + t * 0.4); // pente douce au début, jamais plate en haut
    const wHaut = B.demiHaut;
    const wBas = wHaut + 0.6 + h * 0.35; // flancs raides
    for (let m = 0; m <= nL; m++) {
      const lr = (m / nL) * 2 - 1; // -1 .. 1
      const l = lr * wBas;
      const bord = doux(wHaut, wBas, Math.abs(l));
      // dessus plat (au plus 0,3 m plus bas sur les côtés là où le museau, plus étroit, s'arrondit)
      const dessus = Math.max(0, Math.min(h, Math.max(h - 0.3, coupe(Math.max(-wHaut, Math.min(wHaut, l))))));
      const bosse = 0.12 * Math.sin(s * 1.7 + l * 2.3) * Math.sin(l * 1.1 - s * 0.6) * (1 - doux(0.75, 0.95, t));
      const fin = Math.max(0, a - nS) / 3; // sous le museau, les flancs redescendent (pas de bord coupé)
      const y = (dessus * (1 - bord) + (h > 0.2 ? bosse * (1 + 2.5 * bord) : 0)) * (1 - fin * doux(0, 0.15, bord)) - 0.25 * bord;
      S.push(s); L.push(l); Y.push(Math.max(-0.3, y));
      const r = (Math.sin(s * 3.1 + l * 5.7) * Math.sin(l * 2.9 - s * 4.3) + 1) / 2;
      c.copy(terre).lerp(cailloux, r * 0.6).lerp(herbe, bord * bord * 0.7);
      col.push(c.r, c.g, c.b);
    }
  }
  const index = [];
  for (let a = 0; a < nS + 3; a++) {
    for (let m = 0; m < nL; m++) {
      const p = a * (nL + 1) + m, q = p + nL + 1;
      index.push(p, p + 1, q, p + 1, q + 1, q);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(S.length * 3), 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  return { S: Float32Array.from(S), L: Float32Array.from(L), Y: Float32Array.from(Y), index, geo };
}

/** Petits sentiers de pierres plates qui partent de derrière les barrières vers la forêt. */
function sentiers(groupe, piste, rnd, nombre, garde) {
  const carres = [], ronds = [];
  for (let n = 0; n < nombre; n++) {
    const j = Math.floor(rnd() * piste.N);
    const cote = rnd() < 0.5 ? 1 : -1;
    const dx = piste.cx[(j + 1) % piste.N] - piste.cx[j], dz = piste.cz[(j + 1) % piste.N] - piste.cz[j]; // le long de la route
    const lt = Math.hypot(dx, dz) || 1;
    for (let k = 0; k < 5; k++) {
      // la première pierre juste derrière la barrière (pas dans l'herbe où l'on roule)
      const lat = cote * (piste.demi + piste.marge + 1.8 + k * 1.35);
      const zig = (k % 2 ? 0.35 : -0.35) + (rnd() - 0.5) * 0.3;
      const x = piste.cx[j] + piste.nx[j] * lat + (dx / lt) * zig;
      const z = piste.cz[j] + piste.nz[j] * lat + (dz / lt) * zig;
      if (piste.distanceCentre(x, z) < piste.demi + 0.8) break; // on ne recoupe pas la route
      (k % 2 ? ronds : carres).push({ x, z, s: 0.85 + rnd() * 0.3, r: rnd() * 6.3 });
    }
  }
  planter(groupe, "RockPath_Square_Small_2", carres, garde);
  planter(groupe, "RockPath_Round_Small_1", ronds, garde);
}

// ---------------------------------------------------------------------------
/** Indice d'une ligne droite assez longue avant (et un peu après) un point, près d'une position voulue. */
function ligneDroiteLongue(piste, fraction, avant, apres, fenetre) {
  const N = piste.N;
  const enveloppe = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const nAvant = Math.round(avant / piste.pas), nApres = Math.round(apres / piste.pas);
  let meilleur = Math.floor(N * fraction), cMin = Infinity;
  for (let k = -Math.floor(N * fenetre); k <= N * fenetre; k++) {
    const j = (Math.floor(N * fraction) + k + N) % N;
    if (piste.tremplins.some((t) => ((j - t.debut + N) % N) < nAvant + 10 || ((t.debut - j + N) % N) < nApres + 10)) continue;
    // virage total sur toute la longueur (une courbe en S compte aussi)
    let c = 0;
    for (let m = -nAvant; m < nApres; m++) c += Math.abs(enveloppe(piste.angleA((j + m + 1 + N) % N) - piste.angleA((j + m + N) % N)));
    c += Math.abs(k) * 0.0005;
    if (c < cMin) { cMin = c; meilleur = j; }
  }
  return meilleur;
}

// ---------------------------------------------------------------------------
// Looping + vrille dans la ligne droite du départ (looping.js) et virage relevé façon
// vélodrome après le ravin du ptérodactyle (velodrome.js)
import { looping } from "./looping.js";
import { virageReleve } from "./velodrome.js";
function decorLooping(piste, groupe) {
  looping(piste, groupe);
  virageReleve(piste, groupe);
}

/**
 * Ravin du ptérodactyle sur la ligne droite du haut (0,175 → 0,275 du tour) : la route
 * s'arrête au bord du vide, un ptérodactyle attrape chaque kart et le dépose en face (ptero.js).
 */
function ravinDuPtero(groupe, piste) {
  installerRavin(groupe, piste, { debut: Math.round(piste.N * 0.207) });
}

/**
 * Aquarium géant (aquarium.js) dans les virages du bas (0,73 → 0,84 du tour) : la route passe
 * dans un tunnel de verre sous un grand bassin où nage un mosasaure. Son emprise au sol est
 * dans piste.zonesDecor (la forêt n'y plante rien). Renvoie { update(dt) }.
 */
function aquariumGeant(groupe, piste) {
  return installerAquarium(groupe, piste);
}
