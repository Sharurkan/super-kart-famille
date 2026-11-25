// Écran de chargement de la course : un œuf de dino dans son nid.
// Il tremble (animation CSS, jouée par le compositeur : elle continue même quand le jeu calcule),
// se fissure et les empreintes se remplissent au fil du vrai chargement ; quand le circuit est prêt,
// la coquille saute et un bébé dino sort (un différent à chaque fois), puis la course démarre.
// Dessins des bébés : xing qiu, série « baby dinosaurs » d'Openclipart (CC0, voir public/CREDITS.txt).
import { audio } from "./audio.js";

const BASE = import.meta.env.BASE_URL + "bebes/";
// [fichier, nom, largeur, hauteur] (images de public/bebes, recadrées)
const BEBES = [
  ["t_rex_01", "T-rex", 352, 360], ["t_rex_02", "T-rex", 341, 360], ["t_rex_03", "T-rex", 360, 264],
  ["triceratops_01", "Tricératops", 360, 269], ["triceratops_02", "Tricératops", 360, 297], ["triceratops_03", "Tricératops", 314, 360],
  ["stegosaurus_01", "Stégosaure", 360, 259], ["stegosaurus_02", "Stégosaure", 360, 339],
  ["apatosaurus_01", "Apatosaure", 360, 286], ["apatosaurus_02", "Apatosaure", 241, 360], ["apatosaurus_03", "Apatosaure", 360, 355],
  ["pteranodon_01", "Ptéranodon", 360, 204], ["pteranodon_02", "Ptéranodon", 252, 360], ["pteranodon_03", "Ptéranodon", 360, 300],
  ["ankylosaurus_01", "Ankylosaure", 360, 178], ["ankylosaurus_02", "Ankylosaure", 341, 360], ["ankylosaurus_03", "Ankylosaure", 360, 329],
  ["hadrosaur_01", "Parasaurolophus", 360, 253], ["hadrosaur_03", "Parasaurolophus", 360, 206],
  ["coelophysis_02", "Cœlophysis", 360, 290], ["coelophysis_03", "Cœlophysis", 268, 360], ["coelophysis_04", "Cœlophysis", 360, 332],
];
const CLE = "superkart-dernier-bebe";

// --- dessins (repère 300 × 300 ; l'œuf est centré en x = 150) ---
const ZIG = "M80 168 L95 152 L108 172 L122 150 L136 174 L150 150 L164 174 L178 150 L192 172 L205 152 L220 168";
const COQUE_HAUT = `${ZIG} C 218 110 190 72 150 72 C 110 72 82 110 80 168 Z`;
const COQUE_BAS = `${ZIG} C 222 225 192 262 150 262 C 108 262 78 225 80 168 Z`;
const TACHES_HAUT = `<circle cx="120" cy="120" r="10"/><circle cx="175" cy="105" r="7"/><circle cx="165" cy="140" r="12"/>`;
const TACHES_BAS = `<circle cx="115" cy="210" r="11"/><circle cx="180" cy="225" r="8"/><circle cx="150" cy="240" r="6"/>`;
const FISSURES = [
  "M150 74 L144 96 L154 108 L146 122",
  "M146 122 L132 130 L128 146",
  "M154 108 L170 116 L176 132 L190 140",
  "M128 146 L110 150 L100 162",
  "M190 140 L204 156",
];
const NID = `<ellipse cx="150" cy="262" rx="110" ry="22" fill="#8d5a2b"/>` +
  Array.from({ length: 14 }, (_, i) => `<path d="M${50 + i * 15} ${258 + (i % 2) * 6} q12 -10 26 0" stroke="#b07a3f" stroke-width="5" fill="none" stroke-linecap="round"/>`).join("");
const PALMIER = `<path d="M30 300 Q40 200 70 160" stroke="#6b4a2b" stroke-width="10" fill="none"/>
  <path d="M70 160 q-50 -10 -70 20 M70 160 q-20 -40 -60 -40 M70 160 q30 -40 70 -30 M70 160 q50 0 60 40" stroke="#3f8f3a" stroke-width="12" fill="none" stroke-linecap="round"/>`;
const ETOILE = (x, y) => `<path d="M${x} ${y - 14} L${x + 4} ${y - 4} L${x + 14} ${y} L${x + 4} ${y + 4} L${x} ${y + 14} L${x - 4} ${y + 4} L${x - 14} ${y} L${x - 4} ${y - 4} Z"/>`;
const PAS = `<svg viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="20" cy="26" rx="9" ry="10"/><ellipse cx="9" cy="11" rx="4" ry="7" transform="rotate(-25 9 11)"/><ellipse cx="20" cy="7" rx="4" ry="7"/><ellipse cx="31" cy="11" rx="4" ry="7" transform="rotate(25 31 11)"/></svg>`;
const NB_PAS = 6;

let el = null;
function construire() {
  el = document.getElementById("chargement");
  el.innerHTML = `
    <svg class="palmiers" viewBox="0 0 512 288" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
      <g>${PALMIER}</g><g transform="translate(512 0) scale(-1 1)">${PALMIER}</g>
    </svg>
    <div class="titre-chargement">Le circuit arrive…</div>
    <div class="scene-oeuf">
      <svg viewBox="0 0 300 300" aria-hidden="true">${NID}</svg>
      <img class="bebe" alt="">
      <div class="coquille">
        <svg class="coque-bas" viewBox="0 0 300 300" aria-hidden="true">
          <path d="${COQUE_BAS}" fill="#eef8de" stroke="#9cc47a" stroke-width="3"/><g fill="#c9e7a8">${TACHES_BAS}</g>
        </svg>
        <svg class="coque-haut" viewBox="0 0 300 300" aria-hidden="true">
          <path d="${COQUE_HAUT}" fill="#eef8de" stroke="#9cc47a" stroke-width="3"/><g fill="#c9e7a8">${TACHES_HAUT}</g>
          <g stroke="#5c6b4a" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${FISSURES.map((d) => `<path class="fissure" d="${d}"/>`).join("")}</g>
        </svg>
      </div>
      <svg class="etincelles" viewBox="0 0 300 300" aria-hidden="true" fill="#fff59d">
        ${[[50, 90], [250, 80], [60, 200], [245, 190], [150, 40]].map(([x, y]) => ETOILE(x, y)).join("")}
      </svg>
    </div>
    <div class="empreintes">${PAS.repeat(NB_PAS)}</div>
    <div class="nom-bebe"></div>`;
}

function tirer() {
  let dernier = null;
  try { dernier = localStorage.getItem(CLE); } catch {}
  const choix = BEBES.filter((b) => b[1] !== dernier); // jamais deux fois de suite la même espèce
  const b = choix[Math.floor(Math.random() * choix.length)];
  try { localStorage.setItem(CLE, b[1]); } catch {}
  return b;
}

let bebe = null;
let progresAffiche = -1;

export const oeuf = {
  /** Affiche l'œuf (tout neuf) et prépare un bébé au hasard. */
  montrer() {
    if (!el) construire();
    el.classList.remove("eclos");
    progresAffiche = -1;
    this.progres(0);
    bebe = tirer();
    const [fichier, , w, h] = bebe;
    // le bébé : centré, le bas caché dans la coquille (repère 300 × 300 de la scène)
    const H = 200, L = Math.min((H * w) / h, 215), Hb = (L * h) / w;
    const img = el.querySelector(".bebe");
    img.src = BASE + fichier + ".webp";
    Object.assign(img.style, { left: `${((150 - L / 2) / 300) * 100}%`, top: `${((218 - Hb) / 300) * 100}%`, width: `${(L / 300) * 100}%` });
    el.querySelector(".nom-bebe").textContent = `C'est un bébé ${bebe[1]} !`;
    el.classList.remove("cache");
  },

  /** Avancement du chargement (0 → 1) : fissures et empreintes. */
  progres(p) {
    if (!el) return;
    const n = Math.round(Math.min(1, Math.max(0, p)) * NB_PAS);
    if (n === progresAffiche) return;
    if (n > progresAffiche && progresAffiche >= 0) audio.craque();
    progresAffiche = n;
    el.querySelectorAll(".empreintes svg").forEach((s, i) => s.classList.toggle("on", i < n));
    const nf = Math.round((n / NB_PAS) * FISSURES.length);
    el.querySelectorAll(".fissure").forEach((f, i) => f.classList.toggle("on", i < nf));
  },

  /** Le circuit est prêt : la coquille saute, le bébé sort. Résout quand on peut lancer la course. */
  eclore() {
    this.progres(1);
    el.querySelector(".coque-haut").style.setProperty("--dx", `${Math.random() < 0.5 ? -1 : 1}`);
    el.classList.add("eclos");
    audio.eclosion();
    return new Promise((ok) => setTimeout(ok, 2300));
  },

  cacher() {
    el?.classList.add("cache");
  },
};
