import * as THREE from "three";
import "./style.css";
import { CIRCUITS } from "./circuits.js";
import { KARTS, COULEURS_KARTS } from "./karts.js";
import { PERSONNAGES, urlSprite } from "./pilote.js";
import { Controles } from "./controles.js";
import { Course } from "./course.js";
import { Vitrine } from "./vitrine.js";
import { reglages, sauver } from "./reglages.js";
import { audio } from "./audio.js";
import { REGLAGES } from "./physique.js";

// ---------- Rendu ----------
const renderer = new THREE.WebGLRenderer({ antialias: devicePixelRatio < 2, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
document.getElementById("jeu").appendChild(renderer.domElement);

const controles = new Controles();
const vitrine = new Vitrine();
let course = null;
let vue = vitrine; // ce qui est affiché en 3D : la vitrine ou la course
let enPause = false;

function redimensionner() {
  renderer.setSize(innerWidth, innerHeight);
  vue.redimensionner(innerWidth / innerHeight);
}
addEventListener("resize", redimensionner);

// ---------- Écrans ----------
const $ = (s) => document.querySelector(s);
const ECRANS = ["titre", "perso", "kart", "circuit", "options", "pause", "fin"];
const PRECEDENT = { perso: "titre", kart: "perso", circuit: "kart", options: "circuit" };
let ecranActuel = "titre";

const COULEURS_PERSOS = { viggo: "#ff922b", harry: "#ffd43b", maman: "#9775fa", bryan: "#ff6b6b", mamy: "#4dabf7" };

function montrer(nom) {
  ecranActuel = nom;
  for (const e of ECRANS) $(`#ecran-${e}`).classList.toggle("cache", e !== nom);
  $("#hud").classList.toggle("cache", !course || nom === "pause");
  $("#btn-son").classList.toggle("cache", Boolean(course) && nom === null);
  const pilotage = course && nom === null && (course.etat === "decompte" || course.etat === "course");
  $("#commandes").classList.toggle("cache", !pilotage);
  if (nom === "titre") vitrine.montrerTitre();
  if (nom === "kart") vitrine.montrerKart(reglages.kart, reglages.perso);
  if (nom === "options") majOptions();
}

function pleinEcran() {
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: "hide" })
      .then(() => screen.orientation?.lock?.("landscape"))
      .catch(() => {});
  }
}

// --- Personnages ---
const listePersos = $("#liste-persos");
for (const p of PERSONNAGES) {
  const b = document.createElement("button");
  b.className = "carte-perso";
  b.style.background = `radial-gradient(circle at 50% 35%, #fff8, ${COULEURS_PERSOS[p]} 70%)`;
  b.setAttribute("aria-label", p);
  b.innerHTML = `<img src="${urlSprite(p, "face")}" alt="">`;
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
  const dispo = c.dataset.circuit in CIRCUITS;
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
}
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
function lancerCourse() {
  quitterCourse();
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
      arrivee: annoncerArrivee,
      podium: montrerPodium,
    }
  );
  vue = course;
  enPause = false;
  preparerClassement(course.karts);
  derniereposition = 0;
  document.body.classList.toggle("mode-auto", reglages.modeAuto);
  redimensionner();
  montrer(null);
  audio.musique("course");
  if (import.meta.env.DEV) window.__jeu = { course, avancer };
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
  quitterCourse();
  vitrine.montrerPodium(liste.map((k) => ({ perso: k.perso, type: k.type })));
  audio.fanfare();
  audio.musique("menu");
  const maPlace = $("#ma-place");
  maPlace.classList.toggle("cache", place <= 3);
  maPlace.innerHTML = `<img src="${urlSprite(joueur.perso, "face")}" alt=""><span>${place}<small>${suffixe(place)}</small></span>`;
  montrer("fin");
}

function quitterCourse() {
  if (!course) return;
  clearTimeout(minuteurAnnonce);
  annonce.classList.add("cache");
  classementEl.classList.add("cache");
  course.liberer();
  course = null;
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
    montrer("circuit");
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

function majSon() {
  audio.setMuet(reglages.muet);
  $("#btn-son").classList.toggle("muet", reglages.muet);
}
majSon();
// Échap = pause pendant la course
addEventListener("keydown", (e) => {
  if (e.code === "Escape" && course) (enPause ? ACTIONS.reprendre : ACTIONS.pause)();
});
// si on quitte l'appli pendant la course, on met en pause
document.addEventListener("visibilitychange", () => {
  if (document.hidden && course && course.etat !== "podium" && !enPause) ACTIONS.pause();
  audio.suspendre(document.hidden);
});

// ---------- Boucle ----------
const horloge = new THREE.Clock();

function etape(dt, entree) {
  const roule = vue === course && !enPause && course.etat !== "podium";
  audio.moteur(roule ? course.joueur.phys.vitesse / REGLAGES.vitesseMax : 0, roule);
  if (vue === course && enPause) return;
  vue.etape(dt, entree);
}

function boucle() {
  etape(Math.min(horloge.getDelta(), 0.05));
  renderer.render(vue.scene, vue.camera);
  requestAnimationFrame(boucle);
}

// Outil de test (dev uniquement) : fait avancer le jeu sans requestAnimationFrame.
function avancer(secondes, entree) {
  for (let k = 0; k < secondes * 60; k++) etape(1 / 60, entree);
  renderer.render(vue.scene, vue.camera);
}
if (import.meta.env.DEV) window.__jeu = { avancer };

montrer("titre");
redimensionner();
boucle();
