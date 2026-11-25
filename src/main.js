import * as THREE from "three";
import "./style.css";
import { CIRCUITS, CIRCUITS_ACTIFS } from "./circuits.js";
import { KARTS, COULEURS_KARTS } from "./karts.js";
import { PERSONNAGES, urlSprite } from "./pilote.js";
import { Controles } from "./controles.js";
import { Course } from "./course.js";
import { Minimap } from "./minimap.js";
import { Vitrine } from "./vitrine.js";
import { reglages, sauver } from "./reglages.js";
import { audio } from "./audio.js";
import { REGLAGES } from "./physique.js";
import { ouvrirBoutique, installerBoutique } from "./boutique.js";
import { ajouter as ajouterBonbons } from "./portefeuille.js";
import { chargerTexturesSol } from "./decor.js";
import { oeuf } from "./oeuf.js";

// les photos du sol se chargent pendant que les enfants choisissent leur pilote
chargerTexturesSol();

// Choix mémorisés qui n'existent plus (kart, perso ou circuit retiré) : on revient au premier.
if (!KARTS.includes(reglages.kart)) reglages.kart = KARTS[0];
if (!PERSONNAGES.includes(reglages.perso)) reglages.perso = PERSONNAGES[0];
if (!CIRCUITS_ACTIFS.includes(reglages.circuit)) reglages.circuit = CIRCUITS_ACTIFS[0];
sauver();

// ---------- Rendu ----------
// anti-crénelage toujours actif (bords lisses) ; la résolution s'adapte à la vitesse de la tablette
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
const RESOLUTION_MAX = Math.min(devicePixelRatio, 2);
let resolution = RESOLUTION_MAX;
renderer.setPixelRatio(resolution);
renderer.setSize(innerWidth, innerHeight);
document.getElementById("jeu").appendChild(renderer.domElement);

const controles = new Controles();
const vitrine = new Vitrine();
let course = null;
let minimap = null; // mini-carte du circuit pendant la course
let vue = vitrine; // ce qui est affiché en 3D : la vitrine ou la course
let enPause = false;

// Paysage forcé : si le système passe quand même en portrait (navigateur qui refuse le
// verrouillage, enfant qui penche trop la tablette pour tourner), on fait pivoter toute la page
// pour que l'image reste à sa place pour l'enfant, au lieu d'afficher l'écran "tourne la tablette".
let angleTenu = null; // angle d'écran du dernier paysage (90, 270, ou 0/180 pour les tablettes paysage natives)
let pivot = 0; // rotation CSS appliquée à la page, en degrés
// En course, le sens de référence est figé : si l'enfant penche tellement que le système
// retourne l'écran (paysage inversé, 180°), la page se retourne aussi et l'image ne bouge pas.
// Dans les menus, on adopte le sens dans lequel la tablette est tenue.
function enPilotage() {
  return Boolean(course) && (course.etat === "decompte" || course.etat === "course");
}
function majPivot() {
  const angle = screen.orientation?.angle ?? window.orientation ?? 0;
  const paysage = innerWidth >= innerHeight;
  if (paysage && (angleTenu === null || !enPilotage())) angleTenu = angle;
  pivot = 0;
  if (angleTenu !== null) {
    // rotation physique de la tablette depuis le sens de référence, compensée par la page.
    // Sens (corrigé après essai sur la tablette) : quand le système passe de l'angle 90 à 0,
    // il a redressé l'image d'un quart de tour ; on la remet en la tournant de +90° (CSS,
    // sens horaire), soit angleTenu - angle.
    let d = ((((angleTenu - angle) % 360) + 540) % 360) - 180;
    if (paysage) d = Math.abs(d) >= 135 ? 180 : 0;
    else if (Math.abs(d) !== 90) d = angleTenu - angle > 0 ? 90 : -90;
    pivot = d;
  }
  const html = document.documentElement;
  html.classList.toggle("pivote", pivot !== 0);
  html.style.setProperty("--pivot", `${pivot}deg`);
  // dimensions de la page tournée, et décalage pour la ramener dans l'écran
  // (rotation autour du coin haut gauche)
  const quart = Math.abs(pivot) === 90;
  html.style.setProperty("--pivot-l", quart ? "100vh" : "100vw");
  html.style.setProperty("--pivot-h", quart ? "100vw" : "100vh");
  html.style.setProperty("--pivot-dx", pivot === 90 || pivot === 180 ? "100vw" : "0px");
  html.style.setProperty("--pivot-dy", pivot === -90 || pivot === 180 ? "100vh" : "0px");
  controles.angleForce = pivot !== 0 ? angleTenu : null;
  // diagnostic pour le parent (écran de pause) : angle du système, référence, rotation appliquée
  const diag = document.getElementById("diag-ecran");
  if (diag) diag.textContent = `écran ${angle}° (${screen.orientation?.type ?? "?"}) · référence ${angleTenu}° · pivot ${pivot}° · ${innerWidth}×${innerHeight}`;
}
/** Taille de la zone de jeu (inversée quand la page est tournée d'un quart de tour). */
function tailleJeu() {
  return Math.abs(pivot) === 90 ? [innerHeight, innerWidth] : [innerWidth, innerHeight];
}
function redimensionner() {
  majPivot();
  const [l, h] = tailleJeu();
  renderer.setSize(l, h);
  vue.redimensionner(l / h);
}
// certains navigateurs mettent à jour l'angle et la taille de la fenêtre un peu après
// l'événement : on recalcule aussi une fois les valeurs stabilisées
const redimensionnerPuisRevoir = () => {
  redimensionner();
  setTimeout(redimensionner, 250);
};
addEventListener("resize", redimensionnerPuisRevoir);
screen.orientation?.addEventListener?.("change", redimensionnerPuisRevoir);

// ---------- Écrans ----------
const $ = (s) => document.querySelector(s);
const ECRANS = ["titre", "perso", "kart", "circuit", "options", "pause", "fin", "boutique"];
const PRECEDENT = { perso: "titre", kart: "perso", circuit: "kart", options: CIRCUITS_ACTIFS.length === 1 ? "kart" : "circuit", boutique: "titre" };
let ecranActuel = "titre";

const COULEURS_PERSOS = { viggo: "#ff922b", harry: "#ffd43b", maman: "#9775fa", bryan: "#ff6b6b", mamy: "#4dabf7" };

function montrer(nom) {
  ecranActuel = nom;
  for (const e of ECRANS) $(`#ecran-${e}`).classList.toggle("cache", e !== nom);
  $("#hud").classList.toggle("cache", !course || nom === "pause");
  $("#minimap").classList.toggle("cache", !course || nom === "pause");
  $("#btn-son").classList.toggle("cache", Boolean(course) && nom === null);
  const pilotage = course && nom === null && (course.etat === "decompte" || course.etat === "course");
  $("#commandes").classList.toggle("cache", !pilotage);
  if (nom === "titre") vitrine.montrerTitre();
  if (nom === "kart") vitrine.montrerKart(reglages.kart, reglages.perso);
  if (nom === "options") majOptions();
}

function pleinEcran() {
  const el = document.documentElement;
  // bloque en paysage (Android : seulement en plein écran ou en appli installée)
  const bloquer = () => screen.orientation?.lock?.("landscape").catch(() => {});
  // appli installée (icône) : elle est déjà plein écran sans l'API, et requestFullscreen
  // peut échouer ; on tente le blocage dans tous les cas
  const pleinPuisBloquer = () => el.requestFullscreen?.({ navigationUI: "hide" }).then(bloquer, bloquer);
  if (document.fullscreenElement) bloquer();
  else if (enAppli()) screen.orientation?.lock?.("landscape").catch(pleinPuisBloquer);
  else pleinPuisBloquer() ?? bloquer();
}
function enAppli() {
  return matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches;
}
if (enAppli()) screen.orientation?.lock?.("landscape").catch(() => {});
// revenu en plein écran (ou appli installée) : on rebloque le paysage
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) screen.orientation?.lock?.("landscape").catch(() => {});
});

// numéro de version sur l'accueil (date de construction · commit), voir vite.config.js
$("#version").textContent = __VERSION__;

// --- Personnages ---
const listePersos = $("#liste-persos");
for (const p of PERSONNAGES) {
  const b = document.createElement("button");
  b.className = "carte-perso";
  b.style.background = `radial-gradient(circle at 50% 35%, #fff8, ${COULEURS_PERSOS[p]} 70%)`;
  b.setAttribute("aria-label", p);
  b.innerHTML = `<img src="${urlSprite(p, "face_volant")}" alt="">`; // le pilote tient son volant
  b.addEventListener("click", () => {
    reglages.perso = p;
    sauver();
    montrer("kart");
  });
  listePersos.appendChild(b);
}

// --- Karts ---
const points = $("#points-karts");
for (const k of KARTS) {
  const s = document.createElement("span");
  s.style.background = COULEURS_KARTS[k];
  points.appendChild(s);
}
function majPoints() {
  [...points.children].forEach((s, i) => s.classList.toggle("actif", KARTS[i] === reglages.kart));
}
function changerKart(sens) {
  const i = (KARTS.indexOf(reglages.kart) + sens + KARTS.length) % KARTS.length;
  reglages.kart = KARTS[i];
  vitrine.montrerKart(reglages.kart, reglages.perso);
  majPoints();
}
majPoints();
// glisser le doigt pour changer de kart
{
  let depart = null;
  const ecran = $("#ecran-kart");
  ecran.addEventListener("pointerdown", (e) => {
    if (e.target === ecran) depart = e.clientX;
  });
  ecran.addEventListener("pointerup", (e) => {
    if (depart !== null && Math.abs(e.clientX - depart) > 60) changerKart(e.clientX < depart ? 1 : -1);
    depart = null;
  });
}

// --- Circuits ---
for (const c of document.querySelectorAll("[data-circuit]")) {
  const dispo = CIRCUITS_ACTIFS.includes(c.dataset.circuit);
  c.classList.toggle("cache", !dispo); // circuits retirés pour l'instant : on ne les montre pas
  c.classList.toggle("verrouille", !dispo);
  c.addEventListener("click", () => {
    if (!dispo) {
      c.animate([{ translate: "0" }, { translate: "-12px" }, { translate: "12px" }, { translate: "0" }], { duration: 300 });
      return;
    }
    reglages.circuit = c.dataset.circuit;
    sauver();
    montrer("options");
  });
}

// --- Options ---
function majOptions() {
  for (const b of document.querySelectorAll("[data-mode]")) b.classList.toggle("selection", (b.dataset.mode === "auto") === reglages.modeAuto);
  for (const b of document.querySelectorAll("[data-difficulte]")) b.classList.toggle("selection", b.dataset.difficulte === reglages.difficulte);
  $("#btn-inclinaison").classList.toggle("selection", reglages.inclinaison);
}
// Direction en penchant la tablette (Chrome : HTTPS seulement, voir controles.js)
controles.activerInclinaison(reglages.inclinaison);
$("#btn-inclinaison").addEventListener("click", async () => {
  const bouton = $("#btn-inclinaison");
  const secouer = () => bouton.animate([{ translate: "0" }, { translate: "-12px" }, { translate: "12px" }, { translate: "0" }], { duration: 300 });
  const actif = !reglages.inclinaison;
  // Autorisation des capteurs, à demander pendant le toucher (iOS, et Chrome/Samsung récents
  // qui ont aussi requestPermission). On ne s'arrête PAS sur un refus : certains navigateurs
  // répondent "denied" mais envoient quand même les mesures. C'est l'arrivée des mesures
  // (vérifiée 1,5 s plus tard) qui décide.
  let autorisation = "";
  if (actif) {
    const demander = async (E, nom) => {
      if (typeof E === "undefined" || typeof E.requestPermission !== "function") return;
      try {
        autorisation += `${nom}:${await E.requestPermission()} `;
      } catch (e) {
        autorisation += `${nom}:erreur `;
      }
    };
    await demander(typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : undefined, "o");
    await demander(typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : undefined, "m");
  }
  reglages.inclinaison = actif;
  sauver();
  controles.activerInclinaison(actif); // calibre aussi le "tout droit"
  majOptions();
  $("#diag-capteur").textContent = "";
  if (!actif) return;
  // Aucun capteur (ordinateur, ou page en http) : on revient aux boutons seuls et on secoue.
  setTimeout(() => {
    if (!reglages.inclinaison || controles.dernierCapteur) return;
    // diagnostic pour le parent : ce que le navigateur a envoyé (petit texte sous les options)
    $("#diag-capteur").textContent = `${autorisation}· ${controles.diagnostic()}`;
    reglages.inclinaison = false;
    sauver();
    controles.activerInclinaison(false);
    majOptions();
    secouer();
  }, 1500);
});
for (const b of document.querySelectorAll("[data-mode]"))
  b.addEventListener("click", () => {
    reglages.modeAuto = b.dataset.mode === "auto";
    sauver();
    majOptions();
  });
for (const b of document.querySelectorAll("[data-difficulte]"))
  b.addEventListener("click", () => {
    reglages.difficulte = b.dataset.difficulte;
    sauver();
    majOptions();
  });

// ---------- Course ----------
// Chargement suivi par le gestionnaire par défaut de three.js (tous les GLTFLoader / TextureLoader
// du jeu) : fichiers lus / demandés, et instant du dernier changement.
const fichiers = { faits: 0, demandes: 0, change: 0 };
{
  const M = THREE.DefaultLoadingManager;
  const noter = (_url, faits, demandes) => Object.assign(fichiers, { faits, demandes, change: performance.now() });
  M.onStart = noter;
  M.onProgress = noter;
  M.onLoad = () => (fichiers.change = performance.now());
}
let chargement = false; // l'œuf de dino est affiché (la course se prépare)
let lancement = 0; // numéro du dernier lancement (un « Menu » pendant le chargement l'annule)
const imageSuivante = () => new Promise((ok) => requestAnimationFrame(() => ok()));
const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Attend que le circuit soit chargé (plus aucun fichier en cours depuis un moment), en faisant
 *  avancer l'œuf. Les modèles qui en demandent d'autres une fois lus relancent l'attente. */
async function attendreChargement(jeton, f0, d0, debut) {
  let p = 0;
  for (;;) {
    if (jeton !== lancement) return false;
    const demandes = fichiers.demandes - d0, faits = fichiers.faits - f0;
    if (demandes > 0) p = Math.max(p, Math.min(0.95, faits / demandes));
    else p = Math.max(p, Math.min(0.6, (performance.now() - debut) / 2500)); // rien à lire (déjà en cache)
    oeuf.progres(p);
    const calme = fichiers.faits === fichiers.demandes && performance.now() - fichiers.change > 400;
    const ecoule = performance.now() - debut;
    if ((calme && ecoule > 1200) || ecoule > 30000) return true;
    await attendre(100);
  }
}

async function lancerCourse() {
  const jeton = ++lancement;
  quitterCourse();
  chargement = true;
  montrer(null);
  oeuf.montrer();
  audio.musique("course");
  // le navigateur affiche l'œuf avant le gros calcul (construction du circuit)
  await imageSuivante();
  await imageSuivante();
  if (jeton !== lancement) return;
  const debut = performance.now(), f0 = fichiers.faits, d0 = fichiers.demandes;
  course = new Course(
    { circuit: reglages.circuit, perso: reglages.perso, kart: reglages.kart, modeAuto: reglages.modeAuto, difficulte: reglages.difficulte },
    controles,
    {
      decompte: annoncerDecompte,
      tour: (n) => {
        $("#tour-num").textContent = n;
        if (n > 1) audio.tour();
      },
      classement: majClassement,
      bonbons: (n) => {
        const el = $("#nb-bonbons");
        el.textContent = n;
        el.parentElement.classList.remove("saute");
        void el.offsetWidth; // relance l'animation
        el.parentElement.classList.add("saute");
      },
      arrivee: annoncerArrivee,
      podium: montrerPodium,
    }
  );
  vue = course;
  enPause = false;
  preparerClassement(course.karts);
  classementEl.classList.add("cache"); // (montré avec la course, après l'œuf)
  minimap = new Minimap($("#minimap"), course.piste, course.karts, { couleurs: COULEURS_PERSOS, urlFace: (p) => urlSprite(p, "face") });
  $("#nb-bonbons").textContent = 0;
  derniereposition = 0;
  document.body.classList.toggle("mode-auto", reglages.modeAuto);
  redimensionner();
  if (import.meta.env.DEV) Object.assign(window.__jeu, { course });
  oeuf.progres(0.15);
  if (!(await attendreChargement(jeton, f0, d0, debut))) return;
  // shaders compilés et textures envoyées à la carte graphique pendant que l'œuf est là
  // (sinon la première image de la course fige le jeu)
  try {
    await Promise.race([renderer.compileAsync(course.scene, course.camera), attendre(8000)]);
  } catch {}
  if (jeton !== lancement) return;
  renderer.render(course.scene, course.camera);
  await oeuf.eclore();
  if (jeton !== lancement) return;
  oeuf.cacher();
  chargement = false;
  horloge.getDelta(); // le temps passé dans l'œuf ne compte pas pour la course
  controles.calibrer(); // la position de la tablette au départ = tout droit
  classementEl.classList.remove("cache");
  montrer(null);
}

// --- annonces au centre de l'écran ---
const annonce = $("#annonce");
let minuteurAnnonce = null;
function annoncer(html, duree) {
  clearTimeout(minuteurAnnonce);
  annonce.innerHTML = html;
  annonce.classList.remove("cache");
  if (duree) minuteurAnnonce = setTimeout(() => annonce.classList.add("cache"), duree);
}
function annoncerDecompte(n) {
  audio.bip(n === 0);
  if (n > 0) annoncer(`<span class="n${n}">${n}</span>`);
  else annoncer(`<span class="go">Partez !</span>`, 1000);
}
const suffixe = (n) => (n === 1 ? "er" : "e");
function annoncerArrivee(place) {
  audio.fanfare();
  $("#commandes").classList.add("cache");
  annoncer(`<div class="arrivee"><span>🏁</span><span class="p${place}">${place}<small>${suffixe(place)}</small></span></div>`);
}

// --- position et colonne des têtes ---
const classementEl = $("#classement");
const positionEl = $("#position");
let derniereposition = 0;
function preparerClassement(karts) {
  classementEl.innerHTML = "";
  for (const k of karts) {
    const d = document.createElement("div");
    d.className = "tete" + (k.joueur ? " moi" : "");
    d.innerHTML = `<img src="${urlSprite(k.perso, "face")}" alt="">`;
    k.tete = d;
    classementEl.appendChild(d);
  }
  classementEl.classList.remove("cache");
}
function majClassement(liste) {
  liste.forEach((k, i) => (k.tete.style.translate = `0 ${i * 100}%`));
  const place = liste.findIndex((k) => k.joueur) + 1;
  if (place !== derniereposition) {
    derniereposition = place;
    $("#position-num").textContent = place;
    $("#position-suffixe").textContent = suffixe(place);
    positionEl.className = `position p${place}`;
    void positionEl.offsetWidth; // relance l'animation
    positionEl.classList.add("saute");
  }
}

function montrerPodium(liste) {
  annonce.classList.add("cache");
  const place = liste.findIndex((k) => k.joueur) + 1;
  const joueur = liste[place - 1];
  $("#total-bonbons-nb").textContent = course.nbBonbons;
  // les bonbons gagnés vont dans la tirelire du personnage joué
  $("#tirelire-nb").textContent = ajouterBonbons(joueur.perso, course.nbBonbons).toLocaleString("fr-FR");
  quitterCourse();
  vitrine.montrerPodium(liste.map((k) => ({ perso: k.perso, type: k.type })));
  audio.fanfare();
  audio.musique("menu");
  const maPlace = $("#ma-place");
  maPlace.classList.toggle("cache", place <= 3);
  maPlace.innerHTML = `<img src="${urlSprite(joueur.perso, "face_volant")}" alt=""><span>${place}<small>${suffixe(place)}</small></span>`;
  montrer("fin");
}

function quitterCourse() {
  if (chargement) {
    lancement++;
    chargement = false;
    oeuf.cacher();
  }
  if (!course) return;
  clearTimeout(minuteurAnnonce);
  annonce.classList.add("cache");
  classementEl.classList.add("cache");
  course.liberer();
  course = null;
  minimap = null;
  vue = vitrine;
  redimensionner();
}

// ---------- Boutons ----------
const ACTIONS = {
  jouer: () => {
    pleinEcran();
    montrer("perso");
  },
  retour: () => montrer(PRECEDENT[ecranActuel] ?? "titre"),
  "kart-precedent": () => changerKart(-1),
  "kart-suivant": () => changerKart(1),
  "kart-ok": () => {
    sauver();
    // un seul circuit disponible : on saute l'écran de choix
    if (CIRCUITS_ACTIFS.length === 1) {
      reglages.circuit = CIRCUITS_ACTIFS[0];
      montrer("options");
    } else montrer("circuit");
  },
  partez: () => {
    pleinEcran();
    lancerCourse();
  },
  pause: () => {
    enPause = true;
    montrer("pause");
  },
  reprendre: () => {
    enPause = false;
    montrer(null);
  },
  rejouer: lancerCourse,
  menu: () => {
    quitterCourse();
    audio.musique("menu");
    montrer("titre");
  },
  boutique: () => {
    pleinEcran();
    ouvrirBoutique(reglages.perso);
    montrer("boutique");
  },
  son: () => {
    reglages.muet = !reglages.muet;
    sauver();
    majSon();
  },
};
// le son démarre au premier appui (règle des navigateurs)
document.addEventListener("click", (e) => {
  audio.demarrer();
  if (!audio.morceau) audio.musique(course ? "course" : "menu");
  if (e.target.closest("button")) audio.clic();
  const b = e.target.closest("[data-action]");
  if (b) ACTIONS[b.dataset.action]?.();
});

installerBoutique();

function majSon() {
  audio.setMuet(reglages.muet);
  $("#btn-son").classList.toggle("muet", reglages.muet);
}
majSon();
// Échap = pause pendant la course
addEventListener("keydown", (e) => {
  if (e.code === "Escape" && course && !chargement) (enPause ? ACTIONS.reprendre : ACTIONS.pause)();
});
// si on quitte l'appli pendant la course, on met en pause
document.addEventListener("visibilitychange", () => {
  if (document.hidden && course && !chargement && course.etat !== "podium" && !enPause) ACTIONS.pause();
  audio.suspendre(document.hidden);
});

// ---------- Boucle ----------
const horloge = new THREE.Clock();

function etape(dt, entree) {
  const roule = vue === course && !enPause && course.etat !== "podium";
  audio.moteur(roule ? course.joueur.phys.vitesse / REGLAGES.vitesseMax : 0, roule);
  if (vue === course && enPause) return;
  vue.etape(dt, entree);
  minimap?.etape(dt);
}

// Résolution adaptative : si la tablette n'arrive pas à suivre (moins de ~45 images/s
// en course), on baisse un peu la résolution ; si elle a de la marge, on remonte.
const mesure = { total: 0, n: 0, attente: 0 };
function adapterResolution(dt) {
  if (vue !== course || enPause || document.hidden) return;
  mesure.total += dt;
  mesure.n++;
  if (mesure.n < 90) return;
  const moyenne = mesure.total / mesure.n;
  mesure.total = mesure.n = 0;
  if (performance.now() < mesure.attente) return;
  let nouvelle = resolution;
  if (moyenne > 1 / 45 && resolution > 1) nouvelle = Math.max(1, resolution - 0.25);
  else if (moyenne < 1 / 58 && resolution < RESOLUTION_MAX) nouvelle = Math.min(RESOLUTION_MAX, resolution + 0.25);
  if (nouvelle !== resolution) {
    resolution = nouvelle;
    renderer.setPixelRatio(resolution);
    mesure.attente = performance.now() + 4000; // on laisse le temps de voir l'effet
  }
}

// Compteur de performances (pour un parent, ou pour régler le jeu sur la tablette) : images/s,
// temps de calcul + envoi du dessin par image (processeur), appels de dessin, triangles, résolution.
// S'affiche en touchant la ligne de diagnostic de l'écran de pause (mémorisé) ou avec ?perf.
const perfEl = document.getElementById("perf");
const perf = { actif: false, images: 0, temps: 0, cpu: 0, debut: performance.now() };
function afficherPerf(actif) {
  perf.actif = actif;
  perfEl.classList.toggle("cache", !actif);
  try {
    localStorage.setItem("superkart-perf", actif ? "1" : "");
  } catch {}
}
try {
  afficherPerf(new URLSearchParams(location.search).has("perf") || localStorage.getItem("superkart-perf") === "1");
} catch {}
document.getElementById("diag-ecran").addEventListener("click", () => afficherPerf(!perf.actif));
function majPerf(cpu) {
  perf.images++;
  perf.cpu += cpu;
  const ecoule = performance.now() - perf.debut;
  if (ecoule < 500) return;
  const i = renderer.info.render;
  perfEl.textContent = `${Math.round((perf.images * 1000) / ecoule)} i/s · ${(perf.cpu / perf.images).toFixed(1)} ms · ${i.calls} appels · ${Math.round(i.triangles / 1000)}k tri · rés. ${resolution}`;
  perf.images = perf.cpu = 0;
  perf.debut = performance.now();
}

function boucle() {
  const dt = Math.min(horloge.getDelta(), 0.05);
  requestAnimationFrame(boucle);
  if (chargement) return audio.moteur(0, false); // l'œuf couvre l'écran : rien à calculer ni dessiner
  const t0 = performance.now();
  etape(dt);
  adapterResolution(dt);
  renderer.render(vue.scene, vue.camera);
  if (perf.actif) majPerf(performance.now() - t0);
}

// Outil de test (dev uniquement) : fait avancer le jeu sans requestAnimationFrame.
function avancer(secondes, entree) {
  for (let k = 0; k < secondes * 60; k++) etape(1 / 60, entree);
  renderer.render(vue.scene, vue.camera);
}
if (import.meta.env.DEV) window.__jeu = { avancer, controles, vitrine, renderer, rendre: () => renderer.render(vue.scene, vue.camera), enChargement: () => chargement };

montrer("titre");
redimensionner();
boucle();
