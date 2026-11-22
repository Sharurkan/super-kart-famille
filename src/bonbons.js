import * as THREE from "three";
import { fusion, matCouleurs } from "./decors-circuits.js";

// Bonbons à ramasser : des rangées de 5 sur la route, et quelques-uns en l'air
// au bout des tremplins (on les attrape en sautant). Ils réapparaissent après un moment.

const COULEURS = [0xff6b6b, 0xffd43b, 0x69db7c, 0x4dabf7, 0xf783ac, 0xb197fc, 0xff922b];
const REAPPARITION = 8; // secondes
const RAYON_PRISE = 1.7;

const geoBonbon = fusion([
  { geo: new THREE.SphereGeometry(0.42, 10, 8).scale(1.25, 1, 1), couleur: 0xffffff },
  { geo: new THREE.ConeGeometry(0.3, 0.45, 6).rotateZ(Math.PI / 2).translate(0.68, 0, 0), couleur: 0xffffff },
  { geo: new THREE.ConeGeometry(0.3, 0.45, 6).rotateZ(-Math.PI / 2).translate(-0.68, 0, 0), couleur: 0xffffff },
  // reflet blanc
  { geo: new THREE.SphereGeometry(0.12, 6, 4).translate(-0.18, 0.22, 0.28), couleur: 0xffffff },
]);

export class Bonbons {
  constructor(scene, piste) {
    this.piste = piste;
    this.liste = [];
    const P = piste;
    const motifs = [
      (k) => 0, // ligne au centre
      (k) => -4.5, // à gauche
      (k) => 4.5, // à droite
      (k) => (k - 2) * 2.2, // en diagonale
      (k) => Math.sin(k * 1.2) * 4, // en vague
    ];
    // une rangée environ tous les 70 m, sauf sur la grille de départ et les tremplins
    // pas de bonbon au-dessus d'un trou de la route (ravin du ptérodactyle)
    const auDessusDuVide = (i) => P.trous?.some((t) => (i - t.debut + P.N) % P.N < (t.fin - t.debut + P.N) % P.N);
    const pasRangee = Math.round(70 / P.pas);
    let n = 0;
    for (let debut = Math.round(40 / P.pas); debut < P.N - Math.round(40 / P.pas); debut += pasRangee) {
      if (P.tremplins.some((t) => Math.abs(t.debut - debut) < 25)) continue;
      const motif = motifs[n++ % motifs.length];
      for (let k = 0; k < 5; k++) {
        const i = (debut + k * Math.round(3 / P.pas)) % P.N;
        if (auDessusDuVide(i)) continue;
        let lat = motif(k);
        // pas dans le ventre du diplodocus : on passe de l'autre côté de la route (zone évitée par l'IA)
        for (const z of P.zonesIA) {
          const dedans = (i - z.debut + P.N) % P.N <= (z.fin - z.debut + P.N) % P.N;
          if (dedans && Math.abs(lat - z.lateral) < z.demi + 1) lat = z.lateral + (z.lateral > 0 ? -1 : 1) * (z.demi + 1.5);
        }
        this.liste.push({ x: P.cx[i] + P.nx[i] * lat, y: 1.1, z: P.cz[i] + P.nz[i] * lat, attente: 0 });
      }
    }
    // bonus en l'air, après chaque tremplin
    for (const t of P.tremplins) {
      for (let k = 0; k < 3; k++) {
        const i = (t.debut + t.nb + Math.round((4 + k * 3) / P.pas)) % P.N;
        if (auDessusDuVide(i)) continue;
        this.liste.push({ x: P.cx[i] + P.nx[i] * t.lateral, y: 2.6 + (k === 1 ? 0.3 : 0), z: P.cz[i] + P.nz[i] * t.lateral, attente: 0 });
      }
    }

    this.mesh = new THREE.InstancedMesh(geoBonbon, matCouleurs(), this.liste.length);
    const c = new THREE.Color();
    this.liste.forEach((b, i) => this.mesh.setColorAt(i, c.set(COULEURS[i % COULEURS.length])));
    scene.add(this.mesh);
    this.o = new THREE.Object3D();
    this.t = 0;
  }

  /** Anime les bonbons et renvoie combien le kart (phys) vient d'en ramasser. */
  update(dt, phys) {
    this.t += dt;
    let pris = 0;
    const o = this.o;
    this.liste.forEach((b, i) => {
      if (b.attente > 0) {
        b.attente -= dt;
      } else if (phys) {
        const dx = b.x - phys.x, dz = b.z - phys.z, dy = b.y - (phys.y + 0.9);
        if (dx * dx + dz * dz < RAYON_PRISE * RAYON_PRISE && Math.abs(dy) < 1.4) {
          b.attente = REAPPARITION;
          pris++;
        }
      }
      const s = b.attente > 0 ? 0.0001 : 1.6; // caché pendant qu'il attend de réapparaître
      o.position.set(b.x, b.y + Math.sin(this.t * 3 + i) * 0.15, b.z);
      o.rotation.set(0.3, this.t * 2.5 + i, 0);
      o.scale.setScalar(s);
      o.updateMatrix();
      this.mesh.setMatrixAt(i, o.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    return pris;
  }
}
