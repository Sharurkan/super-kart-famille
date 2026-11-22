# Réduit des textures et les enregistre en JPEG (pour les dinosaures Sketchfab).
# blender --background --python textures_raptor_trice.py -- entree.png sortie.jpg taille [qualite]
import sys
import bpy

args = sys.argv[sys.argv.index("--") + 1:]
entree, sortie, taille = args[0], args[1], int(args[2])
qualite = int(args[3]) if len(args) > 3 else 82
img = bpy.data.images.load(entree)
img.colorspace_settings.name = "Non-Color"  # pas de conversion de couleurs : les pixels restent tels quels
if max(img.size) > taille:
    k = taille / max(img.size)
    img.scale(int(img.size[0] * k), int(img.size[1] * k))
scene = bpy.context.scene
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = qualite
scene.render.image_settings.color_management = "OVERRIDE"
scene.view_settings.view_transform = "Standard"
img.save_render(sortie, scene=scene)
print("TEXTURE", sortie, tuple(img.size))
