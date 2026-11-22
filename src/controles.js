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
const ZONE_MORTE = 4; // degrés : en dessous, on va tout droit
const BRAQUAGE_MAX = 22; // degrés : au-delà, on tourne à fond
const LISSAGE = 0.3; // filtre passe-bas, appliqué à chaque événement du capteur

/** Inclinaison (degrés, droite = positif) -> direction entre -1 et 1. */
export function inclinaisonVersDir(degres) {
  const a = Math.abs(degres);
  if (a <= ZONE_MORTE) return 0;
  return Math.sign(degres) * Math.min(1, (a - ZONE_MORTE) / (BRAQUAGE_MAX - ZONE_MORTE));
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
export function inclinaisonPaysage(beta, angleEcran) {
  const a = ((angleEcran % 360) + 360) % 360;
  if (a === 90) return beta;
  if (a === 270) return -beta;
  return null;
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
  }

  /** Active / coupe la direction par inclinaison. */
  activerInclinaison(actif) {
    if (actif === this.inclinaison) return;
    this.inclinaison = actif;
    this.calibrer();
    if (actif) {
      this.dernierCapteur = 0;
      addEventListener("deviceorientation", this.surOrientation);
    } else {
      removeEventListener("deviceorientation", this.surOrientation);
    }
  }

  /** La position actuelle de la tablette devient le "tout droit" (au prochain événement). */
  calibrer() {
    this.aCalibrer = true;
    this.dirInclinaison = 0;
  }

  lireOrientation(e) {
    if (e.beta == null) return;
    this.dernierCapteur = performance.now();
    const incl = inclinaisonPaysage(e.beta, screen.orientation?.angle ?? window.orientation ?? 90);
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
