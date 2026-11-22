// Clavier + boutons tactiles (multi-doigts). Un doigt qui glisse d'un bouton
// à l'autre change de bouton, comme on s'y attend sur une manette.

const TOUCHES = {
  gauche: ["ArrowLeft", "KeyA", "KeyQ"],
  droite: ["ArrowRight", "KeyD"],
  gaz: ["ArrowUp", "KeyW", "KeyZ", "Space"],
  frein: ["ArrowDown", "KeyS"],
};

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
    return {
      dir: (this.actif("droite") ? 1 : 0) - (this.actif("gauche") ? 1 : 0),
      gaz: modeAuto ? !frein : this.actif("gaz"),
      frein,
    };
  }
}
