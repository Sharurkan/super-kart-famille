# Réduit une texture et l'enregistre en JPEG ; peut y multiplier une carte d'occlusion (AO « cuite »
# dans la couleur, puisque le jeu n'utilise pas les cartes d'occlusion).
# blender --background --python textures_dinos3.py -- entree sortie.jpg taille [qualite] [occlusion] [force_ao]
import sys
import bpy
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
entree, sortie, taille = args[0], args[1], int(args[2])
qualite = int(args[3]) if len(args) > 3 else 82
occlusion = args[4] if len(args) > 4 and args[4] != "-" else None
force = float(args[5]) if len(args) > 5 else 0.8


def charger(chemin, t):
    im = bpy.data.images.load(chemin)
    im.colorspace_settings.name = "Non-Color"  # pas de conversion : les pixels restent tels quels
    if max(im.size) > t:
        k = t / max(im.size)
        im.scale(int(im.size[0] * k), int(im.size[1] * k))
    return im


img = charger(entree, taille)
print("TAILLE_ORIGINE", entree, tuple(img.size))
if occlusion:
    ao = charger(occlusion, taille)
    if tuple(ao.size) != tuple(img.size):
        ao.scale(img.size[0], img.size[1])
    p = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    q = np.empty_like(p)
    img.pixels.foreach_get(p)
    ao.pixels.foreach_get(q)
    p = p.reshape(-1, 4)
    a = q.reshape(-1, 4)[:, :1]
    p[:, :3] *= 1 - force + force * a
    img.pixels.foreach_set(p.ravel())
scene = bpy.context.scene
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = qualite
scene.render.image_settings.color_management = "OVERRIDE"
scene.view_settings.view_transform = "Standard"
img.save_render(sortie, scene=scene)
print("TEXTURE", sortie, tuple(img.size))
