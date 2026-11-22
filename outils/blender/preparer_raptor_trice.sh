#!/bin/sh
# Prépare public/dinos/velociraptor-pbr.glb et triceratops-lp.glb à partir des glTF Sketchfab (CC-BY 4.0)
#   « PBR Velociraptor (Animated) » de Ferocious Industries
#   « Triceratops - dinosaur - low poly » de Legendary Claws (Weverton.Oliveira)
# Usage : sh preparer_raptor_trice.sh dossier_raptor dossier_trice dossier_travail
#   (dossiers = zips Sketchfab décompressés, chacun avec scene.gltf, scene.bin, textures/)
# 1. textures réduites en JPEG avec Blender (couleur 1024, normal map 512 ; spéculaire et occlusion abandonnés)
# 2. filtre du glTF (animations gardées et renommées pour le jeu, morphing retiré)
# 3. gltf-transform : prune, weld, simplify (≈2 700 triangles le raptor, ≈2 200 le tricératops), resample
set -e
R="$1"; TR="$2"; W="$3"
ICI="$(cd "$(dirname "$0")" && pwd)"
JEU="$ICI/../.."
B="${BLENDER:-/c/Program Files/Blender Foundation/Blender 5.3/blender.exe}"
T="npx --yes @gltf-transform/cli@4.1.1"
mkdir -p "$W/tex"

tex() { "$B" --background --python "$ICI/textures_raptor_trice.py" -- "$1" "$W/tex/$2" "$3" | grep TEXTURE; }
tex "$TR/textures/Material_baseColor.png" trice-couleur.jpg 1024
tex "$TR/textures/Material_normal.png" trice-normale.jpg 512
tex "$R/textures/Body_Mat_diffuse.png" raptor-corps.jpg 1024
tex "$R/textures/Body_Mat_normal.png" raptor-normale.jpg 512
tex "$R/textures/Other_Mat_diffuse.png" raptor-autre.jpg 512

SANS_NORMALES=1 TEXTURES="{\"Material_baseColor.png\":\"$W/tex/trice-couleur.jpg\",\"Material_normal.png\":\"$W/tex/trice-normale.jpg\"}" \
  node "$ICI/filtrer_raptor_trice.cjs" "$TR/scene.gltf" "$W/trice.gltf" \
  '{"Armature|Idle":"Idle","Armature|Walk":"Walk","Armature|Roar":"Attack","Armature|Eat":"Eat"}'
TEXTURES="{\"Body_Mat_diffuse.png\":\"$W/tex/raptor-corps.jpg\",\"Body_Mat_normal.png\":\"$W/tex/raptor-normale.jpg\",\"Other_Mat_diffuse.png\":\"$W/tex/raptor-autre.jpg\"}" \
  node "$ICI/filtrer_raptor_trice.cjs" "$R/scene.gltf" "$W/raptor.gltf" \
  '{"Idle_02":"Idle","Walk":"Walk","Sprint":"Run","Roar_01":"Attack","Eat Prey":"Eat"}'

chaine() { # entree.gltf sortie.glb ratio_de_sommets
  $T prune "$1" "$W/e1.glb" >/dev/null
  $T weld "$W/e1.glb" "$W/e2.glb" >/dev/null
  $T simplify "$W/e2.glb" "$W/e3.glb" --ratio "$3" --error 0.05 >/dev/null
  $T resample "$W/e3.glb" "$W/e4.glb" >/dev/null
  $T prune "$W/e4.glb" "$W/e5.glb" >/dev/null
  $T dedup "$W/e5.glb" "$2" >/dev/null
  rm -f "$W"/e?.glb
  ls -la "$2"
}
chaine "$W/trice.gltf" "$JEU/public/dinos/triceratops-lp.glb" 0.25
chaine "$W/raptor.gltf" "$JEU/public/dinos/velociraptor-pbr.glb" 0.18
