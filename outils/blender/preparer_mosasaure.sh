#!/bin/sh
# Prépare public/aquarium/mosasaure.glb à partir du glTF Sketchfab (CC-BY 4.0)
#   « Mosasaurus » d'Alexey Zaika (lexazaixa25)
#   https://sketchfab.com/3d-models/mosasaurus-684754a2ad8c46aca0634326b53d1f04
# Usage : sh preparer_mosasaure.sh dossier_zip dossier_travail
#   (dossier_zip = zip Sketchfab décompressé : scene.gltf, scene.bin, textures/)
# 1. texture couleur réduite en JPEG 1024 avec Blender (métal/rugosité abandonnée)
# 2. filtre du glTF : un seul cycle de nage (images 8 à 40 à 24 i/s = 0,333 s à 1,667 s, boucle parfaite)
#    La mâchoire est l'os « Bone.026_029 » (le jeu l'ouvre lui-même pendant la traversée).
# 3. gltf-transform : prune, weld, simplify (18 700 -> ~5 500 triangles), resample, dedup
set -e
Z="$1"; W="$2"
ICI="$(cd "$(dirname "$0")" && pwd)"
JEU="$ICI/../.."
B="${BLENDER:-/c/Program Files/Blender Foundation/Blender 5.3/blender.exe}"
T="npx --yes @gltf-transform/cli@4.1.1"
RATIO="${RATIO:-0.3}"
mkdir -p "$W/tex" "$JEU/public/aquarium"

"$B" --background --python "$ICI/textures_raptor_trice.py" -- "$Z/textures/Material.003_baseColor.png" "$W/tex/mosasaure-couleur.jpg" 1024 80 | grep TEXTURE
node "$ICI/filtrer_mosasaure.cjs" "$Z/scene.gltf" "$W/mosasaure.gltf" "$W/tex/mosasaure-couleur.jpg" 0.3333333 1.6666667

$T prune "$W/mosasaure.gltf" "$W/e1.glb" >/dev/null
$T weld "$W/e1.glb" "$W/e2.glb" >/dev/null
$T simplify "$W/e2.glb" "$W/e3.glb" --ratio "$RATIO" --error 0.01 >/dev/null
$T resample "$W/e3.glb" "$W/e4.glb" >/dev/null
$T prune "$W/e4.glb" "$W/e5.glb" >/dev/null
$T dedup "$W/e5.glb" "$JEU/public/aquarium/mosasaure.glb" >/dev/null
rm -f "$W"/e?.glb
ls -la "$JEU/public/aquarium/mosasaure.glb"
