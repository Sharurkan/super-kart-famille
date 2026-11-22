// Options mémorisées sur la tablette (mode de conduite, difficulté, derniers choix).

const CLE = "superkart-reglages";

const DEFAUT = {
  modeAuto: true,
  difficulte: "normal", // facile | normal | rapide
  perso: "viggo",
  kart: "classique",
  circuit: "prairie",
  muet: false,
  inclinaison: false, // diriger en penchant la tablette
};

function lire() {
  try {
    return { ...DEFAUT, ...JSON.parse(localStorage.getItem(CLE) || "{}") };
  } catch {
    return { ...DEFAUT };
  }
}

export const reglages = lire();

export function sauver() {
  try {
    localStorage.setItem(CLE, JSON.stringify(reglages));
  } catch {
    // stockage indisponible (navigation privée) : tant pis, on garde en mémoire
  }
}
