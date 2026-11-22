// Conduite arcade très tolérante, pensée pour des enfants de 5-7 ans.

export const REGLAGES = {
  vitesseMax: 24, // unités / s sur la route
  vitesseHerbe: 13, // vitesse max dans l'herbe
  vitesseArriere: 7,
  acceleration: 13,
  freinage: 22,
  roueLibre: 6, // ralentissement sans gaz
  virage: 2.1, // rad/s à pleine direction
  reactiviteDirection: 7, // lissage des boutons ◀ ▶
  delaiReplacement: 2, // secondes coincé / à contresens avant d'être replacé
};

const enveloppe = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class KartPhysique {
  constructor(piste, reglages = REGLAGES) {
    this.piste = piste;
    this.r = reglages;
    this.x = 0;
    this.z = 0;
    this.angle = 0; // direction (0 = +Z)
    this.vitesse = 0;
    this.direction = 0; // direction lissée -1..1
    this.indice = -1;
    this.tour = 0; // 0 avant d'avoir franchi la ligne la première fois
    this.lateral = 0;
    this.dansHerbe = false;
    this.contreMur = 0; // > 0 juste après un rebond
    this.tempsCoince = 0;
    this.tempsContresens = 0;
    this.clignote = 0; // > 0 pendant le clignotement après replacement
    this.poussee = { x: 0, z: 0 }; // petites poussées (rebonds, chocs)
    this.chocs = 0; // nombre de rebonds sur les barrières (pour le son)
    this.assistance = 0; // rad/s d'aide au volant (joueur uniquement)
    // tremplins : hauteur, vitesse verticale, en l'air ou pas
    this.y = 0;
    this.vy = 0;
    this.ySol = 0;
    this.enLair = false;
    this.pente = 0; // inclinaison avant/arrière (visuel)
    this.sauts = 0; // compteurs pour les sons
    this.atterrissages = 0;
    this.facteur = 1; // multiplicateur de vitesse max (adversaires : difficulté + élastique)
  }

  /** Place le kart sur la grille, "recul" échantillons derrière la ligne. */
  placer(recul, lateral = 0) {
    const p = this.piste;
    const i = (p.N - recul) % p.N;
    this.x = p.cx[i] + p.nx[i] * lateral;
    this.z = p.cz[i] + p.nz[i] * lateral;
    this.angle = p.angleA(i);
    this.vitesse = 0;
    this.indice = i;
    this.tour = recul > 0 ? 0 : 1;
    this.direction = 0;
    this.poussee.x = this.poussee.z = 0;
    this.tempsCoince = this.tempsContresens = this.clignote = 0;
    this.y = this.vy = 0;
    this.enLair = false;
  }

  get progression() {
    return this.tour + this.indice / this.piste.N;
  }

  replacer() {
    const p = this.piste, i = this.indice;
    this.x = p.cx[i];
    this.z = p.cz[i];
    this.angle = p.angleA(i);
    this.vitesse = 0;
    this.poussee.x = this.poussee.z = 0;
    this.tempsCoince = this.tempsContresens = 0;
    this.y = this.vy = 0;
    this.enLair = false;
    this.clignote = 1.2;
  }

  /** entree : { dir: -1..1 (droite = +1), gaz: bool, frein: bool } */
  update(dt, entree) {
    const r = this.r, p = this.piste;
    if (this.clignote > 0) this.clignote -= dt;

    // --- vitesse ---
    const vMax = (this.dansHerbe ? r.vitesseHerbe : r.vitesseMax) * this.facteur;
    if (entree.frein) {
      if (this.vitesse > 0.5) this.vitesse -= r.freinage * dt;
      else this.vitesse = Math.max(this.vitesse - r.acceleration * 0.6 * dt, -r.vitesseArriere);
    } else if (entree.gaz) {
      if (this.vitesse < 0) this.vitesse += r.freinage * dt;
      else if (this.vitesse < vMax) this.vitesse = Math.min(vMax, this.vitesse + r.acceleration * (1 - 0.55 * this.vitesse / r.vitesseMax) * dt);
    } else {
      const f = r.roueLibre * dt;
      this.vitesse = Math.abs(this.vitesse) < f ? 0 : this.vitesse - Math.sign(this.vitesse) * f;
    }
    // dans l'herbe : on ralentit en douceur jusqu'à la vitesse max de l'herbe
    if (this.vitesse > vMax) this.vitesse = Math.max(vMax, this.vitesse - 28 * dt);

    // --- direction ---
    this.direction += (entree.dir - this.direction) * Math.min(1, dt * r.reactiviteDirection);
    const v = Math.abs(this.vitesse);
    const efficacite = Math.min(1, v / 5) * (1 - 0.2 * Math.min(1, v / r.vitesseMax));
    this.angle -= this.direction * r.virage * efficacite * Math.sign(this.vitesse) * dt;
    // aide au volant : sans bouton appuyé, le kart se remet doucement dans le sens de la piste
    if (this.assistance > 0 && entree.dir === 0 && this.indice >= 0 && this.vitesse > 2) {
      const ecartPiste = enveloppe(this.piste.angleA(this.indice) - this.angle);
      if (Math.abs(ecartPiste) < 1.2) this.angle += Math.sign(ecartPiste) * Math.min(Math.abs(ecartPiste), this.assistance * dt);
    }

    // --- déplacement ---
    this.x += Math.sin(this.angle) * this.vitesse * dt + this.poussee.x * dt;
    this.z += Math.cos(this.angle) * this.vitesse * dt + this.poussee.z * dt;
    const amorti = Math.exp(-dt * 5);
    this.poussee.x *= amorti;
    this.poussee.z *= amorti;

    // --- position sur la piste ---
    const ancien = this.indice;
    const loc = p.localiser(this.x, this.z, this.indice);
    this.indice = loc.indice;
    this.lateral = loc.lateral;
    if (ancien >= 0) {
      if (ancien > p.N * 0.8 && this.indice < p.N * 0.2) this.tour++;
      else if (ancien < p.N * 0.2 && this.indice > p.N * 0.8) this.tour--;
    }
    const i = this.indice;
    if (!this.enLair) this.dansHerbe = Math.abs(this.lateral) > p.demi + 1.4;

    // --- tremplins : on monte la pente, puis on s'envole en haut ---
    const sol = p.hauteurTremplin(i, this.lateral, loc.long);
    this.ySol = sol.h;
    if (this.enLair) {
      this.vy -= 28 * dt;
      this.y += this.vy * dt;
      this.pente = Math.max(-0.35, Math.min(0.25, -this.vy * 0.03));
      if (this.y <= sol.h) {
        this.y = sol.h;
        this.vy = 0;
        this.enLair = false;
        this.atterrissages++;
      }
    } else {
      const avant = this.y;
      this.y = sol.h;
      this.pente = -sol.pente;
      if (avant > 0.35 && sol.h < avant - 0.3 && this.vitesse > 4) {
        this.enLair = true;
        this.y = avant;
        this.vy = this.vitesse * 0.32 + 2;
        this.sauts++;
      }
    }

    // --- barrières : rebond doux ---
    if (this.contreMur > 0) this.contreMur -= dt;
    const limite = p.demi + p.marge - 1.0;
    if (Math.abs(this.lateral) > limite) {
      const s = Math.sign(this.lateral);
      const depasse = Math.abs(this.lateral) - limite;
      this.x -= p.nx[i] * s * depasse;
      this.z -= p.nz[i] * s * depasse;
      this.lateral = s * limite;
      // pousse vers la route et réoriente un peu le kart dans le sens de la piste
      this.poussee.x = -p.nx[i] * s * 4;
      this.poussee.z = -p.nz[i] * s * 4;
      const angPiste = p.angleA(i);
      const versPiste = Math.abs(enveloppe(this.angle - angPiste)) < Math.PI / 2 ? angPiste : angPiste + Math.PI;
      this.angle += enveloppe(versPiste - this.angle) * 0.25;
      if (this.contreMur <= 0) {
        this.vitesse *= 0.75;
        this.chocs++;
      }
      this.contreMur = 0.3;
    }

    // --- coincé ou à contresens : replacement automatique ---
    const veutAvancer = entree.gaz || entree.frein;
    if (veutAvancer && v < 1.5 && !this.enLair) this.tempsCoince += dt;
    else this.tempsCoince = 0;
    const ecart = Math.abs(enveloppe(this.angle - p.angleA(i)));
    if (ecart > 2.0 && this.vitesse > -0.5) this.tempsContresens += dt;
    else this.tempsContresens = 0;
    if (this.tempsCoince > r.delaiReplacement || this.tempsContresens > r.delaiReplacement) this.replacer();
  }
}
