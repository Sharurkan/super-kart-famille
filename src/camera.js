import * as THREE from "three";

const enveloppe = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Caméra à la 3e personne derrière le kart, avec un léger retard dans les virages. */
export class CameraPoursuite {
  constructor(camera) {
    this.camera = camera;
    this.angle = null;
    this.distance = 7.2;
    this.hauteur = 3.1;
    this.fovBase = camera.fov;
  }

  update(dt, x, z, angleKart, vitesseRelative, y = 0, roulis = 0) {
    if (this.angle === null) this.angle = angleKart;
    this.angle += enveloppe(angleKart - this.angle) * (1 - Math.exp(-dt * 4));
    const dx = Math.sin(this.angle), dz = Math.cos(this.angle);
    // en saut, la caméra suit à moitié la hauteur (pas de secousse)
    this.y = (this.y ?? 0) + (y - (this.y ?? 0)) * Math.min(1, dt * 6);
    this.camera.position.set(x - dx * this.distance, this.hauteur + this.y, z - dz * this.distance);
    this.camera.lookAt(x + dx * 3, 1.1 + this.y, z + dz * 3);
    // virage relevé : la caméra penche un peu avec le kart (moins que lui, pour ne pas donner le tournis)
    this.roulis = (this.roulis ?? 0) + (roulis - (this.roulis ?? 0)) * Math.min(1, dt * 5);
    if (Math.abs(this.roulis) > 1e-4) this.camera.rotateZ(-this.roulis * 0.45);
    const fov = this.fovBase + 8 * THREE.MathUtils.clamp(vitesseRelative, 0, 1);
    if (Math.abs(fov - this.camera.fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
      this.camera.updateProjectionMatrix();
    }
  }
}
