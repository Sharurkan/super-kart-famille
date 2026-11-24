// Mini-carte du circuit pendant la course : le tracé vu du ciel (nord en haut, fixe)
// et un rond par kart pour que les enfants voient où sont les autres.
// Dessin 2D très léger : le tracé est dessiné une seule fois dans un canevas caché,
// puis à chaque image (≈ 20 fois par seconde) on le recopie et on ajoute les points.

const INTERVALLE = 1 / 20; // secondes entre deux dessins
const MARGE = 0.1; // marge autour du tracé (fraction de la taille)

/** Où dessiner un kart : sa vraie position (le ventre du T-rex fait partie de la route). */
export function positionCarte(piste, k) {
  return { x: k.phys.x, z: k.phys.z };
}

export class Minimap {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} piste    piste principale (cx, cz, N, nx, nz, demi)
   * @param {object[]} karts  karts de la course (phys, perso, joueur)
   * @param {object} options  { couleurs: {perso: "#hex"}, urlFace: (perso) => url }
   */
  constructor(canvas, piste, karts, { couleurs = {}, urlFace } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.piste = piste;
    this.karts = karts;
    this.couleurs = couleurs;
    this.attente = 0;
    this.taille = 0;
    this.fond = document.createElement("canvas");
    // visages des pilotes (dessinés dans un rond quand l'image est prête)
    this.faces = {};
    if (urlFace)
      for (const k of karts) {
        if (this.faces[k.perso]) continue;
        const img = new Image();
        img.src = urlFace(k.perso);
        this.faces[k.perso] = img;
      }
    // emprise du tracé
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < piste.N; i++) {
      minX = Math.min(minX, piste.cx[i]); maxX = Math.max(maxX, piste.cx[i]);
      minZ = Math.min(minZ, piste.cz[i]); maxZ = Math.max(maxZ, piste.cz[i]);
    }
    this.emprise = { minX, maxX, minZ, maxZ };
    this.dessiner();
  }

  /** Adapte la résolution du canevas à sa taille affichée (et à l'écran). */
  ajusterTaille() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const taille = Math.max(1, Math.round(Math.min(r.width, r.height) * dpr));
    if (taille === this.taille) return;
    this.taille = this.canvas.width = this.canvas.height = this.fond.width = this.fond.height = taille;
    // échelle commune en x et en z (on garde les proportions), tracé centré
    const { minX, maxX, minZ, maxZ } = this.emprise;
    const utile = taille * (1 - 2 * MARGE);
    this.echelle = utile / Math.max(maxX - minX, maxZ - minZ, 1);
    this.ox = taille / 2 - ((minX + maxX) / 2) * this.echelle;
    this.oz = taille / 2 - ((minZ + maxZ) / 2) * this.echelle;
    this.dessinerTrace();
  }

  /** Passage des coordonnées du monde (x, z) aux pixels de la carte. */
  versCarte(x, z) {
    return [this.ox + x * this.echelle, this.oz + z * this.echelle];
  }

  /** Le tracé et la ligne de départ, une fois pour toutes. */
  dessinerTrace() {
    const p = this.piste, c = this.fond.getContext("2d"), t = this.taille;
    c.clearRect(0, 0, t, t);
    c.lineJoin = c.lineCap = "round";
    c.beginPath();
    for (let i = 0; i <= p.N; i++) {
      const [x, y] = this.versCarte(p.cx[i % p.N], p.cz[i % p.N]);
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
    // bordure sombre puis route claire
    const epaisseur = Math.max(t * 0.06, 2 * p.demi * this.echelle);
    c.strokeStyle = "rgba(0, 0, 0, 0.45)";
    c.lineWidth = epaisseur + t * 0.025;
    c.stroke();
    c.strokeStyle = "rgba(255, 255, 255, 0.85)";
    c.lineWidth = epaisseur;
    c.stroke();
    // ligne de départ : damier noir et blanc en travers de la route
    const nx = p.nx[0], nz = p.nz[0];
    const [ax, ay] = this.versCarte(p.cx[0] + nx * p.demi * 1.6, p.cz[0] + nz * p.demi * 1.6);
    const [bx, by] = this.versCarte(p.cx[0] - nx * p.demi * 1.6, p.cz[0] - nz * p.demi * 1.6);
    const long = Math.max(Math.hypot(bx - ax, by - ay), epaisseur * 1.4);
    const ang = Math.atan2(by - ay, bx - ax);
    const case_ = long / 6;
    c.save();
    c.translate((ax + bx) / 2, (ay + by) / 2);
    c.rotate(ang);
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 2; j++) {
        c.fillStyle = (i + j) % 2 ? "#111" : "#fff";
        c.fillRect(-long / 2 + i * case_, (j - 1) * case_, case_, case_);
      }
    c.strokeStyle = "rgba(0, 0, 0, 0.6)";
    c.lineWidth = Math.max(1, t * 0.006);
    c.strokeRect(-long / 2, -case_, long, case_ * 2);
    c.restore();
  }

  /** Un rond pour un kart : visage du pilote s'il est chargé, sinon couleur pleine. */
  rond(x, y, rayon, couleur, perso, bordure, epaisseur) {
    const c = this.ctx;
    c.beginPath();
    c.arc(x, y, rayon, 0, Math.PI * 2);
    c.fillStyle = couleur;
    c.fill();
    const img = this.faces[perso];
    if (img && img.complete && img.naturalWidth) {
      c.save();
      c.beginPath();
      c.arc(x, y, rayon * 0.92, 0, Math.PI * 2);
      c.clip();
      const d = rayon * 2;
      c.drawImage(img, x - rayon, y - rayon, d, d);
      c.restore();
    }
    c.beginPath();
    c.arc(x, y, rayon, 0, Math.PI * 2);
    c.strokeStyle = bordure;
    c.lineWidth = epaisseur;
    c.stroke();
  }

  dessiner() {
    this.ajusterTaille();
    const c = this.ctx, t = this.taille;
    c.clearRect(0, 0, t, t);
    c.drawImage(this.fond, 0, 0);
    // les adversaires d'abord, le joueur par-dessus
    const ordre = [...this.karts].sort((a, b) => a.joueur - b.joueur);
    for (const k of ordre) {
      const pos = positionCarte(this.piste, k);
      const [x, y] = this.versCarte(pos.x, pos.z);
      const couleur = this.couleurs[k.perso] ?? "#ff6b6b";
      if (k.joueur) this.rond(x, y, t * 0.085, couleur, k.perso, "#fff", Math.max(2, t * 0.022));
      else this.rond(x, y, t * 0.055, couleur, k.perso, couleur, Math.max(1.5, t * 0.016));
    }
  }

  /** À appeler à chaque image ; ne redessine qu'environ 20 fois par seconde. */
  etape(dt) {
    this.attente -= dt;
    if (this.attente > 0) return;
    this.attente = INTERVALLE;
    this.dessiner();
  }
}
