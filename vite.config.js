import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "node:child_process";

// Numéro de version affiché sur l'accueil : date de construction + début du commit,
// pour voir sur la tablette que la nouvelle version est bien téléchargée.
let commit = "dev";
try {
  commit = execSync("git rev-parse --short HEAD").toString().trim();
} catch {}
// heure de Paris (le serveur de GitHub qui construit le site est en UTC)
const p = Object.fromEntries(
  new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date())
    .map((x) => [x.type, x.value]),
);
const VERSION = `${p.day}/${p.month} ${p.hour}h${p.minute} · ${commit}`;

export default defineConfig({
  define: { __VERSION__: JSON.stringify(VERSION) },
  // chemins relatifs : le jeu marche aussi dans un sous-dossier (ex. GitHub Pages)
  base: "./",
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: { chunkSizeWarningLimit: 800 },
  plugins: [
    VitePWA({
      registerType: "autoUpdate", // la nouvelle version s'installe toute seule
      includeAssets: ["icones/apple-touch-icon.png"],
      manifest: {
        name: "Super Kart Famille",
        short_name: "Super Kart",
        description: "Jeu de kart pour toute la famille",
        lang: "fr",
        start_url: "./",
        scope: "./",
        display: "fullscreen",
        orientation: "landscape",
        background_color: "#4aa8ff",
        theme_color: "#2d7ff9",
        icons: [
          { src: "icones/icone-192.png", sizes: "192x192", type: "image/png" },
          { src: "icones/icone-512.png", sizes: "512x512", type: "image/png" },
          { src: "icones/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // tout le jeu est mis en cache : il marche ensuite sans réseau
        globPatterns: ["**/*.{js,css,html,png,jpg,webp,json,svg,webmanifest,glb,ogg}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
});
