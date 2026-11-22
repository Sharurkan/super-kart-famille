/**
 * Libère la mémoire GPU d'un objet 3D quand on quitte un écran.
 * Les matériaux partagés (karts, pilotes) sont gardés en cache : on ne libère
 * que les géométries, sauf si "materiaux" est vrai.
 */
export function liberer(objet, materiaux = false) {
  objet.traverse((o) => {
    o.geometry?.dispose();
    if (materiaux && o.material && !o.material.userData.partage) {
      for (const m of [].concat(o.material)) {
        m.map?.dispose();
        m.dispose();
      }
    }
  });
}
