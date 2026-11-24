// Tous les sons du jeu, fabriqués avec la Web Audio API (aucun fichier externe) :
// musique joyeuse en boucle, moteur, bips du départ, fanfare d'arrivée, petits effets.

const freq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

// Mélodie originale en do majeur, en croches (null = silence). 4 mesures : Do - Lam - Fa - Sol.
const MELODIE = [
  76, 79, 84, 79, 76, 79, 81, 79,
  81, 84, 88, 84, 81, 79, 76, 72,
  77, 81, 84, 81, 79, 77, 76, 74,
  74, 79, 83, 79, 74, 76, 77, null,
];
// Basse : une note par noire (une case sur deux)
const BASSE = [48, 48, 43, 48, 45, 45, 40, 45, 41, 41, 48, 41, 43, 43, 50, 43];

class MoteurAudio {
  constructor() {
    this.ctx = null;
    this.muet = false;
    this.morceau = null; // "menu" | "course" | null
    this.pas = 0;
    this.prochaineNote = 0;
  }

  /** À appeler sur un geste de l'utilisateur (règle des navigateurs). */
  demarrer() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.maitre = ctx.createGain();
    this.maitre.gain.value = this.muet ? 0 : 1;
    this.maitre.connect(ctx.destination);
    this.busMusique = ctx.createGain();
    this.busMusique.gain.value = 0.22;
    this.busMusique.connect(this.maitre);
    this.busEffets = ctx.createGain();
    this.busEffets.gain.value = 0.55;
    this.busEffets.connect(this.maitre);

    // bruit blanc (caisse claire, charleston, chocs)
    this.bruit = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.bruit.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // moteur : deux oscillateurs + filtre, volume à 0 tant qu'on ne roule pas
    this.moteurGain = ctx.createGain();
    this.moteurGain.gain.value = 0;
    this.moteurFiltre = ctx.createBiquadFilter();
    this.moteurFiltre.type = "lowpass";
    this.moteurFiltre.frequency.value = 500;
    this.moteurFiltre.connect(this.moteurGain);
    this.moteurGain.connect(this.busEffets);
    this.osc1 = ctx.createOscillator();
    this.osc1.type = "sawtooth";
    this.osc2 = ctx.createOscillator();
    this.osc2.type = "square";
    this.osc1.connect(this.moteurFiltre);
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    this.osc2.connect(g2).connect(this.moteurFiltre);
    this.osc1.frequency.value = 55;
    this.osc2.frequency.value = 27.5;
    this.osc1.start();
    this.osc2.start();

    // séquenceur de musique
    setInterval(() => this.planifier(), 25);
  }

  setMuet(muet) {
    this.muet = muet;
    if (this.maitre) this.maitre.gain.setTargetAtTime(muet ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  /** Met en pause tout le son (appli en arrière-plan). */
  suspendre(oui) {
    if (!this.ctx) return;
    if (oui) this.ctx.suspend();
    else this.ctx.resume();
  }

  // ---------- Musique ----------
  musique(nom) {
    if (this.morceau === nom) return;
    this.morceau = nom;
    this.pas = 0;
    if (this.ctx) this.prochaineNote = this.ctx.currentTime + 0.1;
  }

  planifier() {
    if (!this.ctx || !this.morceau || this.ctx.state !== "running") return;
    const tempo = this.morceau === "course" ? 150 : 112;
    const croche = 60 / tempo / 2;
    const t0 = this.ctx.currentTime;
    if (this.prochaineNote < t0) this.prochaineNote = t0 + 0.05;
    while (this.prochaineNote < t0 + 0.12) {
      const t = this.prochaineNote, p = this.pas % 32;
      const m = MELODIE[p];
      if (m) this.note(freq(m), t, croche * 0.9, "square", 0.32);
      if (p % 2 === 0) this.note(freq(BASSE[p / 2]), t, croche * 1.8, "triangle", 0.7);
      if (this.morceau === "course") {
        if (p % 4 === 0) this.grosseCaisse(t);
        if (p % 4 === 2) this.caisseClaire(t);
        this.charleston(t);
      } else if (p % 8 === 0) {
        this.grosseCaisse(t, 0.5);
      }
      this.prochaineNote += croche;
      this.pas++;
    }
  }

  note(f, t, duree, type, volume, bus = this.busMusique) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(volume, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + duree);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + duree + 0.05);
  }

  grosseCaisse(t, volume = 1) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.9 * volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.busMusique);
    o.start(t);
    o.stop(t + 0.2);
  }

  bruitFiltre(t, duree, volume, type, frequence, bus = this.busMusique) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.bruit;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequence;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duree);
    s.connect(f).connect(g).connect(bus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + duree + 0.02);
  }

  caisseClaire(t) {
    this.bruitFiltre(t, 0.12, 0.35, "bandpass", 1800);
  }

  charleston(t) {
    this.bruitFiltre(t, 0.04, 0.12, "highpass", 7000);
  }

  // ---------- Moteur ----------
  /** vRel : vitesse / vitesse max (0..1) ; actif : on est en course. */
  moteur(vRel, actif) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.min(1, Math.abs(vRel));
    this.osc1.frequency.setTargetAtTime(55 + v * 110, t, 0.08);
    this.osc2.frequency.setTargetAtTime(27.5 + v * 55, t, 0.08);
    this.moteurFiltre.frequency.setTargetAtTime(350 + v * 900, t, 0.1);
    this.moteurGain.gain.setTargetAtTime(actif ? 0.1 + v * 0.12 : 0, t, 0.1);
  }

  // ---------- Effets ----------
  effet(f, duree, type = "square", volume = 0.5, t = this.ctx?.currentTime) {
    if (!this.ctx) return;
    this.note(f, t, duree, type, volume, this.busEffets);
  }

  bip(final = false) {
    this.effet(final ? 880 : 440, final ? 0.6 : 0.25, "square", 0.45);
  }

  clic() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(600, t);
    o.frequency.exponentialRampToValueAtTime(1200, t + 0.06);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(this.busEffets);
    o.start(t);
    o.stop(t + 0.12);
  }

  tour() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.effet(freq(84), 0.15, "triangle", 0.5, t);
    this.effet(freq(88), 0.3, "triangle", 0.5, t + 0.12);
  }

  choc() {
    if (!this.ctx) return;
    this.bruitFiltre(this.ctx.currentTime, 0.18, 0.5, "lowpass", 400, this.busEffets);
  }

  /** "Pling" joyeux quand on ramasse un bonbon (de plus en plus aigu si on enchaîne). */
  bonbon() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.serie = t - (this.dernierBonbon ?? 0) < 0.6 ? Math.min((this.serie ?? 0) + 1, 6) : 0;
    this.dernierBonbon = t;
    const base = 84 + [0, 2, 4, 5, 7, 9, 11][this.serie];
    this.effet(freq(base), 0.12, "square", 0.3, t);
    this.effet(freq(base + 7), 0.2, "triangle", 0.35, t + 0.06);
  }

  /** "CROC" : deux claquements de mâchoire et un grondement. */
  croc() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bruitFiltre(t, 0.12, 0.8, "lowpass", 900, this.busEffets);
    this.bruitFiltre(t + 0.18, 0.15, 0.9, "lowpass", 700, this.busEffets);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(120, t + 0.3);
    o.frequency.exponentialRampToValueAtTime(55, t + 1.0);
    g.gain.setValueAtTime(0.0001, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.05);
    o.connect(g).connect(this.busEffets);
    o.start(t + 0.3);
    o.stop(t + 1.1);
  }

  /** Grondement sourd du volcan qui entre en éruption (force 0..1 : plus faible quand on est loin). */
  grondement(force = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // bruit très grave qui enfle puis s'éteint
    const s = this.ctx.createBufferSource();
    s.buffer = this.bruit;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 140;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * force, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    s.connect(f).connect(g).connect(this.busEffets);
    s.start(t);
    s.stop(t + 2.7);
    // une basse qui tremble un peu (la terre gronde)
    const o = this.ctx.createOscillator();
    const go = this.ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(48, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 2.2);
    go.gain.setValueAtTime(0.0001, t);
    go.gain.exponentialRampToValueAtTime(0.35 * force, t + 0.2);
    go.gain.exponentialRampToValueAtTime(0.001, t + 2.3);
    o.connect(go).connect(this.busEffets);
    o.start(t);
    o.stop(t + 2.4);
  }

  /**
   * Sons enregistrés (fichiers .ogg de public/) : chargés tôt, décodés dès que le son est
   * démarré (premier toucher), joués sans attendre. Renvoie false si le son n'est pas encore prêt.
   */
  precharger(url) {
    this.sons ??= new Map();
    let e = this.sons.get(url);
    if (!e) {
      e = { buffer: null, decodage: null, donnees: fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null) };
      this.sons.set(url, e);
    }
    if (this.ctx && !e.decodage) {
      e.decodage = e.donnees
        .then((d) => (d ? this.ctx.decodeAudioData(d.slice(0)) : null))
        .then((b) => { e.buffer = b; })
        .catch(() => {}); // format non lu par ce navigateur : on garde le son de secours
    }
    return e;
  }

  jouer(url, volume = 1, vitesse = 1) {
    if (!this.ctx) return false;
    const e = this.precharger(url);
    if (!e.buffer) return false;
    const s = this.ctx.createBufferSource();
    s.buffer = e.buffer;
    s.playbackRate.value = vitesse;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    s.connect(g).connect(this.busEffets);
    s.start();
    return true;
  }

  /** "Boing" qui monte quand on s'envole d'un tremplin. */
  saut() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.25);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.busEffets);
    o.start(t);
    o.stop(t + 0.4);
  }

  atterrissage() {
    if (!this.ctx) return;
    this.bruitFiltre(this.ctx.currentTime, 0.15, 0.35, "lowpass", 300, this.busEffets);
  }

  fanfare() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [72, 76, 79, 84].forEach((n, i) => this.effet(freq(n), 0.25, "square", 0.4, t + i * 0.13));
    this.effet(freq(84), 0.9, "square", 0.4, t + 0.55);
    this.effet(freq(88), 0.9, "triangle", 0.3, t + 0.55);
  }
}

export const audio = new MoteurAudio();
