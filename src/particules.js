import * as THREE from "three";
import { textureRond } from "./textures.js";

/** Petites bouffées (fumée de dérapage, herbe) avec un nombre fixe de sprites. */
export class Particules {
  constructor(scene, nombre = 40) {
    const tex = textureRond("rgba(255,255,255,0.9)", "rgba(255,255,255,0)");
    this.liste = [];
    for (let i = 0; i < nombre; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      s.visible = false;
      scene.add(s);
      this.liste.push({ s, vie: 0, duree: 1, vy: 0, taille: 1 });
    }
    this.prochain = 0;
  }

  emettre(x, y, z, couleur, taille = 0.8, duree = 0.6) {
    const p = this.liste[this.prochain];
    this.prochain = (this.prochain + 1) % this.liste.length;
    p.s.position.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
    p.s.material.color.set(couleur);
    p.vie = p.duree = duree;
    p.taille = taille;
    p.vy = 0.8 + Math.random() * 0.6;
    p.s.visible = true;
  }

  update(dt) {
    for (const p of this.liste) {
      if (p.vie <= 0) continue;
      p.vie -= dt;
      if (p.vie <= 0) {
        p.s.visible = false;
        continue;
      }
      const t = 1 - p.vie / p.duree;
      p.s.position.y += p.vy * dt;
      p.s.scale.setScalar(p.taille * (0.6 + t));
      p.s.material.opacity = 0.8 * (1 - t);
    }
  }
}
