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

  update(dt, x, z, angleKart, vitesseRelative, y = 0) {
    if (this.angle === null) this.angle = angleKart;
    this.angle += enveloppe(angleKart - this.angle) * (1 - Math.exp(-dt * 4));
    const dx = Math.sin(this.angle), dz = Math.cos(this.angle);
    // en saut, la caméra suit à moitié la hauteur (pas de secousse)
    this.y = (this.y ?? 0) + (y - (this.y ?? 0)) * Math.min(1, dt * 6);
    this.camera.position.set(x - dx * this.distance, this.hauteur + this.y * 0.6, z - dz * this.distance);
    this.camera.lookAt(x + dx * 3, 1.1 + this.y * 0.8, z + dz * 3);
    const fov = this.fovBase + 8 * THREE.MathUtils.clamp(vitesseRelative, 0, 1);
    if (Math.abs(fov - this.camera.fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
      this.camera.updateProjectionMatrix();
    }
  }
}
