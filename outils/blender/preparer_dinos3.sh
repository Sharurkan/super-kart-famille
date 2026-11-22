#!/bin/sh
# Prépare les dinosaures réalistes (Sketchfab, CC-BY 4.0) de public/dinos/ :
#   trex-realiste.glb      « Randaling T- Rex, animated! » de quander
#   stego-realiste.glb     « PBR Stegasaurus (Animated) » de Ferocious Industries
#   para-realiste.glb      « Parasaurolophus » de ichigo15
#   sauropode-troupeau.glb « Brachiosaurus_AR card » de Zinaida.Kovrova
# Usage : sh preparer_dinos3.sh dossier_sources dossier_travail
#   dossier_sources/{trex,stego,para,sauropode}/ = zips Sketchfab décompressés (scene.gltf, scene.bin, textures/)
# 1. textures réduites en JPEG avec Blender (couleur 1024 avec l'occlusion multipliée dedans, normal map 512)
# 2. preparer_dinos3.mjs : animations découpées / dérivées / renommées pour le jeu, orientation corrigée,
#    morphing, spéculaire et attributs inutiles retirés (sans passer par Blender : le skinning reste intact)
# 3. gltf-transform : prune, weld, simplify, resample, dedup
set -e
SRC="$1"; W="$2"
ICI="$(cd "$(dirname "$0")" && pwd)"
JEU="$ICI/../.."
B="${BLENDER:-/c/Program Files/Blender Foundation/Blender 5.3/blender.exe}"
T="npx --yes @gltf-transform/cli@4.1.1"
mkdir -p "$W/tex"

if [ -z "$SANS_TEXTURES" ]; then
tex() { "$B" --background --python "$ICI/textures_dinos3.py" -- "$@" | grep -E "TEXTURE|TAILLE"; }
tex "$SRC/trex/textures/material_0_diffuse.png" "$W/tex/trex-couleur.jpg" 1024 82 "$SRC/trex/textures/material_0_occlusion.png" 0.7
tex "$SRC/trex/textures/material_0_normal.png" "$W/tex/trex-normale.jpg" 512 80
tex "$SRC/stego/textures/Material_diffuse.png" "$W/tex/stego-couleur.jpg" 1024 82 "$SRC/stego/textures/Material_occlusion.png" 0.7
tex "$SRC/stego/textures/Material_normal.png" "$W/tex/stego-normale.jpg" 512 80
tex "$SRC/stego/textures/Eyes_diffuse.png" "$W/tex/stego-yeux.jpg" 128 80
tex "$SRC/para/textures/para_baseColor.png" "$W/tex/para-couleur.jpg" 1024 85
tex "$SRC/para/textures/para_normal.png" "$W/tex/para-normale.jpg" 512 80
tex "$SRC/para/textures/eyes_baseColor.png" "$W/tex/para-yeux.jpg" 128 80
tex "$SRC/sauropode/textures/mamenxilong_baseColor.jpeg" "$W/tex/sauro-couleur.jpg" 1024 82
tex "$SRC/sauropode/textures/mamenxilong_normal.png" "$W/tex/sauro-normale.jpg" 512 80
# versions « loin » (troupeaux au loin) : couleur 512
tex "$SRC/trex/textures/material_0_diffuse.png" "$W/tex/trex-couleur-512.jpg" 512 82 "$SRC/trex/textures/material_0_occlusion.png" 0.7
tex "$SRC/stego/textures/Material_diffuse.png" "$W/tex/stego-couleur-512.jpg" 512 82 "$SRC/stego/textures/Material_occlusion.png" 0.7
tex "$SRC/para/textures/para_baseColor.png" "$W/tex/para-couleur-512.jpg" 512 85
tex "$SRC/sauropode/textures/mamenxilong_baseColor.jpeg" "$W/tex/sauro-couleur-512.jpg" 512 82
fi

node "$ICI/preparer_dinos3.mjs" "$SRC" "$W"

chaine() { # entree.gltf sortie.glb ratio_de_sommets [tolérance_animations] [erreur_simplification]
  $T prune "$1" "$W/e1.glb" >/dev/null
  $T weld "$W/e1.glb" "$W/e2.glb" >/dev/null
  $T simplify "$W/e2.glb" "$W/e3.glb" --ratio "$3" --error "${5:-0.05}" >/dev/null
  $T resample "$W/e3.glb" "$W/e4.glb" --tolerance "${4:-0.0001}" >/dev/null
  $T prune "$W/e4.glb" "$W/e5.glb" >/dev/null
  $T dedup "$W/e5.glb" "$2" >/dev/null
  rm -f "$W"/e?.glb
  ls -la "$2"
}
D="$JEU/public/dinos"
chaine "$W/trex.gltf" "$D/trex-realiste.glb" "${R_TREX:-0.5}" 0.002
chaine "$W/stego.gltf" "$D/stego-realiste.glb" "${R_STEGO:-0.3}" 0.002
chaine "$W/para.gltf" "$D/para-realiste.glb" "${R_PARA:-0.7}" 0.002
chaine "$W/sauropode.gltf" "$D/sauropode-troupeau.glb" "${R_SAURO:-0.33}" 0.002
# versions « loin »
chaine "$W/trex-loin.gltf" "$D/trex-realiste-loin.glb" "${RL_TREX:-0.17}" 0.004 0.2
chaine "$W/stego-loin.gltf" "$D/stego-realiste-loin.glb" "${RL_STEGO:-0.1}" 0.004 0.2
chaine "$W/para-loin.gltf" "$D/para-realiste-loin.glb" "${RL_PARA:-0.27}" 0.004 0.2
chaine "$W/sauropode-loin.gltf" "$D/sauropode-troupeau-loin.glb" "${RL_SAURO:-0.11}" 0.004 0.2
