// Clavier + boutons tactiles (multi-doigts). Un doigt qui glisse d'un bouton
// à l'autre change de bouton, comme on s'y attend sur une manette.

const TOUCHES = {
  gauche: ["ArrowLeft", "KeyA", "KeyQ"],
  droite: ["ArrowRight", "KeyD"],
  gaz: ["ArrowUp", "KeyW", "KeyZ", "Space"],
  frein: ["ArrowDown", "KeyS"],
};

// --- Direction en penchant la tablette (tenue en paysage) ---
// Attention : Chrome ne fournit "deviceorientation" que dans un contexte sécurisé
// (HTTPS ou localhost). Ça marche sur la version GitHub Pages, mais PAS sur l'adresse
// http du réseau local (http://192.168.x.x:5173) utilisée en développement.
// Réglage doux (retour de jeu : 22° pour braquer à fond, c'était beaucoup trop fort) :
// zone morte plus large, braquage complet seulement vers 40°, et courbe progressive
// (petite inclinaison = petit virage, on ne tourne fort qu'en penchant franchement).
// Réglé sur la tablette par essais successifs : 22° → 40° → 90° → 60° → 40° (avec la courbe douce).
const ZONE_MORTE = 6; // degrés : en dessous, on va tout droit
const BRAQUAGE_MAX = 40; // degrés : braquage complet
const COURBE = 1.3; // > 1 : les petites inclinaisons tournent peu
const LISSAGE = 0.2; // filtre passe-bas, appliqué à chaque événement du capteur

/** Inclinaison (degrés, droite = positif) -> direction entre -1 et 1. */
export function inclinaisonVersDir(degres) {
  const a = Math.abs(degres);
  if (a <= ZONE_MORTE) return 0;
  const t = Math.min(1, (a - ZONE_MORTE) / (BRAQUAGE_MAX - ZONE_MORTE));
  return Math.sign(degres) * Math.pow(t, COURBE);
}

/** Ramène un angle dans [-180, 180[. */
function angleRelatif(a) {
  return ((((a + 180) % 360) + 360) % 360) - 180;
}

/**
 * Inclinaison gauche/droite (degrés, droite = positif) d'un appareil tenu en paysage.
 * En paysage, l'axe gauche/droite est "beta" (rotation autour du petit côté du portrait).
 * Écran tourné à 90° (haut du portrait à gauche) : beta augmente quand le bord gauche
 * monte, donc quand on penche à droite. À 270° (= -90°) c'est l'inverse.
 * Renvoie null en portrait (non géré).
 */
export function inclinaisonPaysage(beta, angleEcran, gamma = null) {
  const a = ((angleEcran % 360) + 360) % 360;
  if (a === 90) return beta;
  if (a === 270) return -beta;
  // Tablettes dont la position "naturelle" est déjà le paysage : l'angle d'écran vaut 0 (ou 180)
  // en paysage, et l'axe gauche/droite est alors "gamma" (positif quand le bord droit descend).
  if (gamma != null && a === 0) return gamma;
  if (gamma != null && a === 180) return -gamma;
  return null;
}

/**
 * Secours sans gyroscope (beaucoup de tablettes Android) : Chrome n'envoie alors que des
 * "deviceorientation" vides, mais l'accéléromètre ("devicemotion") donne la pesanteur.
 * gx, gy : accelerationIncludingGravity dans le repère de l'appareil. Renvoie l'inclinaison
 * gauche/droite de l'écran en degrés (droite = positif), quel que soit le sens de l'écran.
 */
export function inclinaisonPesanteur(gx, gy, angleEcran) {
  const a = (angleEcran * Math.PI) / 180;
  const sx = gx * Math.cos(a) - gy * Math.sin(a); // composante le long du bord horizontal de l'écran
  // Android : la mesure pointe vers le haut ; quand le bord droit descend, sx devient négatif
  return (Math.asin(Math.max(-1, Math.min(1, -sx / 9.81))) * 180) / Math.PI;
}

export class Controles {
  constructor() {
    this.touches = new Set();
    this.doigts = new Map(); // pointerId -> nom du bouton (ou null)
    this.boutons = [...document.querySelectorAll("[data-ctrl]")];

    addEventListener("keydown", (e) => {
      this.touches.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    });
    addEventListener("keyup", (e) => this.touches.delete(e.code));
    addEventListener("blur", () => {
      this.touches.clear();
      this.doigts.clear();
      this.visuel();
    });

    const bouton = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-ctrl]")?.dataset.ctrl ?? null;
    addEventListener("pointerdown", (e) => {
      this.doigts.set(e.pointerId, bouton(e));
      this.visuel();
    });
    addEventListener("pointermove", (e) => {
      if (!this.doigts.has(e.pointerId)) return;
      this.doigts.set(e.pointerId, bouton(e));
      this.visuel();
    });
    const fin = (e) => {
      this.doigts.delete(e.pointerId);
      this.visuel();
    };
    addEventListener("pointerup", fin);
    addEventListener("pointercancel", fin);
    addEventListener("contextmenu", (e) => e.preventDefault());

    // Inclinaison
    this.inclinaison = false;
    this.brut = null; // dernière inclinaison lue (degrés, droite = +)
    this.zero = 0; // inclinaison qui veut dire "tout droit"
    this.aCalibrer = true;
    this.dirInclinaison = 0; // direction lissée
    this.dernierCapteur = 0; // performance.now() du dernier événement du capteur
    this.surOrientation = (e) => this.lireOrientation(e);
    this.surMouvement = (e) => this.lireMouvement(e);
    this.orientationOk = false; // le gyroscope donne de vraies valeurs : on ignore l'accéléromètre
    this.diag = { o: 0, oVide: 0, m: 0, mVide: 0 }; // événements reçus (diagnostic)
  }

  /** Active / coupe la direction par inclinaison. */
  activerInclinaison(actif) {
    if (actif === this.inclinaison) return;
    this.inclinaison = actif;
    this.calibrer();
    if (actif) {
      this.dernierCapteur = 0;
      this.orientationOk = false;
      this.diag = { o: 0, oVide: 0, m: 0, mVide: 0 };
      addEventListener("deviceorientation", this.surOrientation);
      addEventListener("devicemotion", this.surMouvement);
    } else {
      removeEventListener("deviceorientation", this.surOrientation);
      removeEventListener("devicemotion", this.surMouvement);
    }
  }

  angleEcran() {
    // écran pivoté par le jeu (le système est passé en portrait) : on garde le repère du paysage
    if (this.angleForce != null) return this.angleForce;
    return screen.orientation?.angle ?? window.orientation ?? 90;
  }

  /** La position actuelle de la tablette devient le "tout droit" (au prochain événement). */
  calibrer() {
    this.aCalibrer = true;
    this.dirInclinaison = 0;
  }

  /** Résumé lisible par un parent de ce que le navigateur envoie (diagnostic). */
  diagnostic() {
    const d = this.diag;
    return `orientation ${d.o} (vides ${d.oVide}) · mouvement ${d.m} (vides ${d.mVide}) · écran ${this.angleEcran()}° · ${isSecureContext ? "https" : "http"}`;
  }

  lireOrientation(e) {
    this.diag.o++;
    if (e.beta == null) this.diag.oVide++;
    if (e.beta == null) return; // pas de gyroscope : l'accéléromètre prend le relais
    this.orientationOk = true;
    this.appliquer(inclinaisonPaysage(e.beta, this.angleEcran(), e.gamma));
  }

  lireMouvement(e) {
    this.diag.m++;
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null) this.diag.mVide++;
    if (this.orientationOk) return;
    if (!g || g.x == null || g.y == null) return;
    this.appliquer(inclinaisonPesanteur(g.x, g.y, this.angleEcran()));
  }

  appliquer(incl) {
    this.dernierCapteur = performance.now();
    if (incl === null) {
      this.brut = null;
      this.dirInclinaison = 0;
      return;
    }
    if (this.aCalibrer || this.brut === null) {
      this.zero = incl;
      this.aCalibrer = false;
    }
    this.brut = incl;
    const cible = inclinaisonVersDir(angleRelatif(incl - this.zero));
    this.dirInclinaison += (cible - this.dirInclinaison) * LISSAGE;
    if (Math.abs(this.dirInclinaison) < 0.001) this.dirInclinaison = 0;
  }

  actif(nom) {
    if (TOUCHES[nom].some((t) => this.touches.has(t))) return true;
    for (const b of this.doigts.values()) if (b === nom) return true;
    return false;
  }

  visuel() {
    const appuyes = new Set(this.doigts.values());
    for (const b of this.boutons) b.classList.toggle("appuye", appuyes.has(b.dataset.ctrl));
  }

  /** modeAuto : le kart accélère tout seul (sauf si on freine). */
  etat(modeAuto) {
    const frein = this.actif("frein");
    const droite = this.actif("droite");
    const gauche = this.actif("gauche");
    // Un bouton ◀ ▶ (ou une flèche du clavier) a toujours priorité sur l'inclinaison.
    const dir = droite || gauche ? (droite ? 1 : 0) - (gauche ? 1 : 0) : this.inclinaison ? this.dirInclinaison : 0;
    return {
      dir,
      gaz: modeAuto ? !frein : this.actif("gaz"),
      frein,
    };
  }
}
