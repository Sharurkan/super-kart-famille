// Vérifie un circuit (même courbe que src/piste.js) : longueur, rayon de courbe mini,
// lignes droites, distance mini de la piste à elle-même.
// Usage : node outils/verif-piste.mjs dino
import * as THREE from "three";
import { CIRCUITS } from "../src/circuits.js";

const nom = process.argv[2] ?? "dino";
const def = { ...CIRCUITS[nom] };
// pour essayer un tracé : node outils/verif-piste.mjs dino "[[0,-50],[0,50],...]"
if (process.argv[3]) {
  def.points = JSON.parse(process.argv[3]);
  def.echantillons = undefined;
}
if (process.argv[3] || !def.echantillons) {
  // ~1,15 m entre échantillons, comme demandé à piste.js
  const e0 = def.echelle ?? 1;
  const c0 = new THREE.CatmullRomCurve3(def.points.map(([x, z]) => new THREE.Vector3(x * e0, 0, z * e0)), true, "centripetal");
  if (process.argv[3]) def.echantillons = Math.round(c0.getLength() / 1.15 / 50) * 50;
}
const e = def.echelle ?? 1;
const courbe = new THREE.CatmullRomCurve3(def.points.map(([x, z]) => new THREE.Vector3(x * e, 0, z * e)), true, "centripetal");
const N = def.echantillons ?? 600;
const p = courbe.getSpacedPoints(N);
p.pop();
const L = courbe.getLength(), pas = L / N;
const ang = p.map((_, i) => {
  const a = p[(i + 1) % N], b = p[(i - 1 + N) % N];
  return Math.atan2(a.x - b.x, a.z - b.z);
});
const env = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// rayon de courbe sur une fenêtre de ~10 m
const w = Math.max(2, Math.round(5 / pas));
let rMin = Infinity, iR = 0;
for (let i = 0; i < N; i++) {
  const da = Math.abs(env(ang[(i + w) % N] - ang[(i - w + N) % N]));
  const r = (2 * w * pas) / Math.max(da, 1e-9);
  if (r < rMin) { rMin = r; iR = i; }
}
const rayon = (i) => (2 * w * pas) / Math.max(Math.abs(env(ang[(i + w) % N] - ang[((i - w) % N + N) % N])), 1e-9);
const virages = [];
for (let i = 0; i < N; i++) {
  const r = rayon(i);
  if (r < 50 && r <= rayon(i - 1) && r < rayon(i + 1)) virages.push(`${(i / N).toFixed(2)}:${r.toFixed(0)}m`);
}

// distance mini entre portions éloignées le long de la piste (> 120 m l'une de l'autre)
const sep = Math.round(120 / pas);
let dMin = Infinity, paire = null;
for (let i = 0; i < N; i++) {
  for (let j = i + sep; j < N; j++) {
    if (N - (j - i) < sep) continue;
    const d = Math.hypot(p[i].x - p[j].x, p[i].z - p[j].z);
    if (d < dMin) { dMin = d; paire = [i, j]; }
  }
}

// lignes droites : rayon > 150 m sur une fenêtre de 20 m
const k10 = Math.round(10 / pas);
const droite = ang.map((_, i) => Math.abs(env(ang[(i + k10) % N] - ang[(i - k10 + N) % N])) < 20 / 150);
const segs = [];
let debut = -1;
for (let k = 0; k < 2 * N; k++) {
  const i = k % N;
  if (droite[i] && debut < 0) debut = k;
  if ((!droite[i] || k === 2 * N - 1) && debut >= 0) {
    if (debut < N && (debut > 0 || !droite[N - 1])) segs.push([debut, k - debut]);
    debut = -1;
  }
}

console.log(`${nom} : L = ${L.toFixed(0)} m, N = ${N}, pas = ${pas.toFixed(2)} m`);
console.log(`rayon mini ≈ ${rMin.toFixed(1)} m à i = ${iR} (${(iR / N).toFixed(2)} du tour)`);
console.log(`virages serrés (< 50 m) : ${virages.join(", ") || "aucun"}`);
console.log(`distance mini (portions à > 120 m) = ${dMin.toFixed(1)} m entre i = ${paire?.[0]} et ${paire?.[1]} : ${dMin > 35 ? "OK" : "TROP PRÈS"}`);
console.log("lignes droites (> 25 m) :");
for (const [d, n] of segs.filter((s) => s[1] * pas > 25)) {
  console.log(`  ${(d / N).toFixed(3)} → ${(((d + n) % N) / N).toFixed(3)} : ${(n * pas).toFixed(0)} m`);
}
