# Blender (sans fenêtre) : prépare les textures du sol (Poly Haven, CC0) pour le jeu.
# Réduit chaque image, l'enregistre en JPEG et affiche sa couleur moyenne (en linéaire),
# utile pour régler la teinte dans materiauSol() (src/decor.js).
#
# blender --background --python textures_sol.py -- "source.jpg|sortie.jpg|taille|qualite" ...
import sys
import bpy
import numpy as np

scene = bpy.context.scene
scene.view_settings.view_transform = "Standard"  # sinon AgX change les couleurs à l'enregistrement
scene.view_settings.look = "None"
for arg in sys.argv[sys.argv.index("--") + 1:]:
    morceaux = arg.split("|")
    source, sortie, taille = morceaux[0], morceaux[1], int(morceaux[2])
    qualite = int(morceaux[3]) if len(morceaux) > 3 else 82
    img = bpy.data.images.load(source)
    if img.size[0] != taille:
        img.scale(taille, taille)
    p = np.empty(taille * taille * 4, dtype=np.float32)
    img.pixels.foreach_get(p)
    moy = p.reshape(-1, 4)[:, :3].mean(axis=0)
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = qualite
    scene.render.image_settings.color_mode = "RGB"
    img.save_render(sortie, scene=scene)
    print("texture", sortie, taille, "moyenne %.3f %.3f %.3f" % tuple(moy))
