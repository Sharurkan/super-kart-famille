import { PERSONNAGES, urlSprite } from "./pilote.js";
import { solde, acheter, bonsEnAttente, marquerDonne } from "./portefeuille.js";
import { audio } from "./audio.js";

// ---------------------------------------------------------------------------
// LISTE DES RÉCOMPENSES : à modifier librement (prix en bonbons).
// icone : un des dessins ci-dessous (biscuit, chips, oeuf) ou un emoji.
export const RECOMPENSES = [
  { id: "biscuit", nom: "Un biscuit", prix: 1000, icone: "biscuit" },
  { id: "chips", nom: "Un paquet de chips", prix: 5000, icone: "chips" },
  { id: "oeuf", nom: "Un Kinder Surprise", prix: 10000, icone: "oeuf" },
];
// ---------------------------------------------------------------------------

const DESSINS = {
  biscuit: `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#d9a066" stroke="#a9743f" stroke-width="5"/>
    <circle cx="36" cy="38" r="6" fill="#5c3a1e"/><circle cx="60" cy="32" r="5" fill="#5c3a1e"/><circle cx="62" cy="58" r="7" fill="#5c3a1e"/>
    <circle cx="40" cy="64" r="5" fill="#5c3a1e"/><circle cx="50" cy="48" r="4" fill="#5c3a1e"/></svg>`,
  chips: `<svg viewBox="0 0 100 100"><path d="M22 14 L78 14 L72 26 L80 88 L20 88 L28 26 Z" fill="#ff6b6b" stroke="#c92a2a" stroke-width="4" stroke-linejoin="round"/>
    <path d="M20 14 Q50 22 80 14" fill="none" stroke="#c92a2a" stroke-width="4"/>
    <ellipse cx="50" cy="56" rx="20" ry="15" fill="#ffd43b" stroke="#f08c00" stroke-width="3"/>
    <ellipse cx="44" cy="52" rx="6" ry="4" fill="#ffe066"/></svg>`,
  oeuf: `<svg viewBox="0 0 100 100"><ellipse cx="50" cy="54" rx="32" ry="40" fill="#fff" stroke="#adb5bd" stroke-width="3"/>
    <path d="M18 54 Q34 42 50 54 T82 54 L82 64 Q66 52 50 64 T18 64 Z" fill="#ff922b"/>
    <text x="50" y="44" font-size="26" font-weight="900" text-anchor="middle" fill="#7048e8">?</text>
    <path d="M30 76 Q50 88 70 76" fill="none" stroke="#7a4b2a" stroke-width="5" stroke-linecap="round"/></svg>`,
};

const dessin = (icone) => DESSINS[icone] ?? `<span class="emoji-recompense">${icone}</span>`;
const nombre = (n) => n.toLocaleString("fr-FR");
const $ = (s) => document.querySelector(s);

let persoChoisi = PERSONNAGES[0];

/** Prépare l'écran boutique. persoParDefaut : le dernier personnage joué. */
export function ouvrirBoutique(persoParDefaut) {
  persoChoisi = persoParDefaut ?? persoChoisi;
  dessinerBoutique();
}

function dessinerBoutique() {
  // les 5 tirelires
  $("#tirelires").innerHTML = PERSONNAGES.map(
    (p) => `<button class="tirelire ${p === persoChoisi ? "choisie" : ""}" data-tirelire="${p}" aria-label="${p}">
      <img src="${urlSprite(p, "face_volant")}" alt=""><span>🍬 ${nombre(solde(p))}</span></button>`
  ).join("");

  // les récompenses, avec une jauge qui se remplit
  const mesBonbons = solde(persoChoisi);
  $("#recompenses").innerHTML = RECOMPENSES.map((r) => {
    const pct = Math.min(100, (mesBonbons / r.prix) * 100);
    const possible = mesBonbons >= r.prix;
    return `<button class="recompense ${possible ? "possible" : ""}" data-recompense="${r.id}" aria-label="${r.nom}">
      <div class="dessin">${dessin(r.icone)}</div>
      <div class="prix">🍬 ${nombre(r.prix)}</div>
      <div class="jauge"><div style="width:${pct}%"></div></div>
    </button>`;
  }).join("");

  // bons à récupérer
  const bons = bonsEnAttente();
  $("#bons").classList.toggle("cache", bons.length === 0);
  $("#liste-bons").innerHTML = bons
    .map((b) => {
      const r = RECOMPENSES.find((x) => x.id === b.recompense);
      return `<div class="bon"><img src="${urlSprite(b.perso, "face_volant")}" alt=""><div class="dessin">${dessin(r?.icone ?? "🎁")}</div>
        <button class="btn-donne" data-bon="${b.id}" aria-label="Donné (maintenir 3 secondes)"><svg viewBox="0 0 100 100"><circle class="anneau" cx="50" cy="50" r="44"/><path d="M28 52 L44 68 L74 36" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>`;
    })
    .join("");
}

// --- confirmation d'achat ---
let achatEnCours = null;

function demanderAchat(r) {
  if (solde(persoChoisi) < r.prix) {
    const carte = document.querySelector(`[data-recompense="${r.id}"]`);
    carte?.animate([{ translate: "0" }, { translate: "-12px" }, { translate: "12px" }, { translate: "0" }], { duration: 300 });
    return;
  }
  achatEnCours = r;
  $("#confirmer-dessin").innerHTML = dessin(r.icone);
  $("#confirmer-perso").src = urlSprite(persoChoisi, "face_volant");
  $("#confirmer-achat").classList.remove("cache");
}

function validerAchat() {
  const r = achatEnCours;
  achatEnCours = null;
  $("#confirmer-achat").classList.add("cache");
  if (!r) return;
  const bon = acheter(persoChoisi, r);
  if (!bon) return;
  audio.fanfare();
  // le bon à montrer aux parents
  $("#bon-dessin").innerHTML = dessin(r.icone);
  $("#bon-perso").src = urlSprite(persoChoisi, "face_volant");
  $("#bon-nom").textContent = r.nom;
  $("#nouveau-bon").classList.remove("cache");
  dessinerBoutique();
}

// --- appui long (3 s) pour que le parent marque le bon comme donné ---
const DUREE_APPUI = 3000;
let appui = null;

function debutAppui(bouton) {
  finAppui();
  bouton.classList.add("en-cours");
  appui = {
    bouton,
    minuteur: setTimeout(() => {
      marquerDonne(bouton.dataset.bon);
      audio.tour();
      appui = null;
      dessinerBoutique();
    }, DUREE_APPUI),
  };
}

function finAppui() {
  if (!appui) return;
  clearTimeout(appui.minuteur);
  appui.bouton.classList.remove("en-cours");
  appui = null;
}

export function installerBoutique() {
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tirelire]");
    if (t) {
      persoChoisi = t.dataset.tirelire;
      dessinerBoutique();
      return;
    }
    const r = e.target.closest("[data-recompense]");
    if (r) demanderAchat(RECOMPENSES.find((x) => x.id === r.dataset.recompense));
    if (e.target.closest("[data-action=achat-oui]")) validerAchat();
    if (e.target.closest("[data-action=achat-non]")) {
      achatEnCours = null;
      $("#confirmer-achat").classList.add("cache");
    }
    if (e.target.closest("[data-action=bon-ok]")) $("#nouveau-bon").classList.add("cache");
  });
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest("[data-bon]");
    if (b) debutAppui(b);
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"]) document.addEventListener(ev, finAppui);
}
