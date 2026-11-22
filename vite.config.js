import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
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
        globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
    }),
  ],
});
