// Pilote automatique simple : vise un point devant lui sur la piste, dans
// "sa" voie, et lève le pied avant les virages serrés.

const enveloppe = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class PiloteIA {
  constructor(phys, voie = 0) {
    this.phys = phys;
    this.piste = phys.piste;
    this.voie = voie; // décalage latéral préféré
    this.voieCible = voie;
    this.prochainChangement = 3 + Math.random() * 4;
  }

  entree(dt) {
    const p = this.phys, P = this.piste;
    const N = P.N;

    // change de voie de temps en temps, pour que ça bouge un peu
    this.prochainChangement -= dt;
    if (this.prochainChangement <= 0) {
      this.voieCible = (Math.random() * 2 - 1) * (P.demi - 2.5);
      this.prochainChangement = 3 + Math.random() * 5;
    }
    this.voie += (this.voieCible - this.voie) * Math.min(1, dt * 0.8);
    // zone à éviter devant (ex. le diplodocus) : on se met de l'autre côté de la route
    for (const z of P.zonesIA) {
      const devant = (z.debut - p.indice + N) % N;
      const dedans = (p.indice - z.debut + N) % N <= (z.fin - z.debut + N) % N;
      if ((devant < 60 || dedans) && Math.abs(this.voie - z.lateral) < z.demi + 2.5) {
        this.voie = z.lateral + (z.lateral > 0 ? -1 : 1) * (z.demi + 2.5);
        this.voieCible = this.voie;
      }
    }

    // point visé : plus loin quand on va vite
    const distance = 7 + Math.abs(p.vitesse) * 0.45;
    const j = (p.indice + Math.round(distance / P.pas)) % N;
    const cx = P.cx[j] + P.nx[j] * this.voie;
    const cz = P.cz[j] + P.nz[j] * this.voie;
    const erreur = enveloppe(Math.atan2(cx - p.x, cz - p.z) - p.angle);
    const dir = Math.max(-1, Math.min(1, -erreur * 3));

    // virage serré devant : on ralentit un peu
    const k = (p.indice + Math.round(25 / P.pas)) % N;
    const courbure = Math.abs(enveloppe(P.angleA(k) - P.angleA(p.indice)));
    const vCible = p.r.vitesseMax * p.facteur * (1 - Math.min(0.3, courbure * 0.35));

    return { dir, gaz: p.vitesse < vCible, frein: false };
  }
}
