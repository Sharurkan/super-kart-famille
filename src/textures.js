import * as THREE from "three";

function canvas(l, h) {
  const c = document.createElement("canvas");
  c.width = l;
  c.height = h;
  return [c, c.getContext("2d")];
}

/** Bitume avec lignes blanches sur les bords et pointillés au centre. */
export function textureAsphalte() {
  const [c, g] = canvas(128, 256);
  g.fillStyle = "#5d616b";
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 80 + Math.random() * 40;
    g.fillStyle = `rgb(${v},${v + 2},${v + 8})`;
    g.fillRect(Math.random() * 128, Math.random() * 256, 2, 2);
  }
  g.fillStyle = "#ffffff";
  g.fillRect(3, 0, 5, 256);
  g.fillRect(120, 0, 5, 256);
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.fillRect(61, 20, 6, 100);
  g.fillRect(61, 148, 6, 100);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Damier noir et blanc. */
export function textureDamier(colonnes = 8, lignes = 2) {
  const [c, g] = canvas(colonnes * 8, lignes * 8);
  for (let y = 0; y < lignes; y++)
    for (let x = 0; x < colonnes; x++) {
      g.fillStyle = (x + y) % 2 ? "#111" : "#fff";
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Disque flou (ombres, fumée). */
export function textureRond(interieur = "rgba(0,0,0,0.55)", exterieur = "rgba(0,0,0,0)") {
  const [c, g] = canvas(64, 64);
  const d = g.createRadialGradient(32, 32, 4, 32, 32, 31);
  d.addColorStop(0, interieur);
  d.addColorStop(1, exterieur);
  g.fillStyle = d;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dessus des tremplins : jaune avec des flèches orange. */
export function textureChevrons() {
  const [c, g] = canvas(64, 64);
  g.fillStyle = "#ffd43b";
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#ff6b00";
  g.lineWidth = 9;
  g.lineJoin = "round";
  for (const y of [14, 42]) {
    g.beginPath();
    g.moveTo(10, y + 14);
    g.lineTo(32, y);
    g.lineTo(54, y + 14);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
