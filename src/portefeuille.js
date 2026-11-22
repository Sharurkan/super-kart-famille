// Tirelire de bonbons (une par personnage) et bons de récompense, gardés sur la tablette.

const CLE = "superkart-tirelire";

function lire() {
  try {
    const d = JSON.parse(localStorage.getItem(CLE) || "{}");
    return { soldes: d.soldes ?? {}, bons: d.bons ?? [] };
  } catch {
    return { soldes: {}, bons: [] };
  }
}

const donnees = lire();

function sauver() {
  try {
    localStorage.setItem(CLE, JSON.stringify(donnees));
  } catch {
    // stockage indisponible : on garde en mémoire pour cette partie
  }
}

// Demande au navigateur de ne pas effacer ces données s'il manque de place.
try {
  navigator.storage?.persist?.();
} catch {
  // pas grave
}

export function solde(perso) {
  return donnees.soldes[perso] ?? 0;
}

export function ajouter(perso, n) {
  donnees.soldes[perso] = solde(perso) + n;
  sauver();
  return donnees.soldes[perso];
}

/** Achète une récompense : retire les bonbons et crée un bon à montrer aux parents. */
export function acheter(perso, recompense) {
  if (solde(perso) < recompense.prix) return null;
  donnees.soldes[perso] -= recompense.prix;
  const bon = { id: Date.now().toString(36), perso, recompense: recompense.id, date: new Date().toISOString(), donne: false };
  donnees.bons.push(bon);
  sauver();
  return bon;
}

/** Bons pas encore donnés (à récupérer dans la vraie vie). */
export function bonsEnAttente() {
  return donnees.bons.filter((b) => !b.donne);
}

export function marquerDonne(id) {
  const b = donnees.bons.find((x) => x.id === id);
  if (b) {
    b.donne = true;
    sauver();
  }
}
