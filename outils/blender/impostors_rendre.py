# Blender (sans fenêtre) : photographie un arbre (ou une plante) sous plusieurs angles, fond
# transparent, pour en faire un « imposteur » (une image plate qui se tourne vers la caméra).
#
# blender -b modele.blend --python impostors_rendre.py -- dossier_sortie nom_sprite objet [vues] [hauteur_px] [echantillons] [largeur_px]
#   - objet : nom de l'objet maillage à photographier (les autres sont cachés)
#   - sortie : <nom_sprite>.png (les vues côte à côte, de gauche à droite) et <nom_sprite>.json
# Vue k : la caméra regarde l'arbre depuis l'angle k * 360° / vues autour de lui (vue 0 : depuis
# l'avant, -Y dans Blender = +Z dans three.js), à l'horizontale (la caméra du kart est basse).
# Recette de public/nature/arbres.webp (fichiers .blend 1k de Poly Haven, 8 vues, 1024 px max,
# 64 échantillons, cases de 512 px ; puis impostors_atlas.py, voir son en-tête) :
#   fir_tree_01 -> sapin_a fir_tree_01_a_LOD1 ; sapin_b fir_tree_01_b_LOD1
#   island_tree_01 -> ile_a island_tree_01_LOD1 ; jacaranda_tree -> jacaranda jacaranda_tree_LOD1
#   tree_small_02 -> petit_arbre tree_small_02_LOD1 ; anthurium_botany_01 -> anthurium anthurium_botany_01_a
#   calathea_orbifolia_01 -> calathea calathea_orbifolia_01_a
#   pachira_aquatica_01 -> pachira_c pachira_aquatica_01_bark_c,pachira_aquatica_01_leaves_c
#                          pachira_d pachira_aquatica_01_bark_d,pachira_aquatica_01_leaves_d
# Lumière : ciel neutre + soleil qui tourne avec la caméra (toujours en haut à gauche de la vue),
# pour que l'arbre paraisse éclairé pareil quelle que soit sa rotation dans le jeu.
import sys, os, json, math
import bpy
import numpy as np
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
SORTIE, NOM, OBJET = a[0], a[1], a[2]
VUES = int(a[3]) if len(a) > 3 else 8
HMAX = int(a[4]) if len(a) > 4 else 512
ECH = int(a[5]) if len(a) > 5 else 64
LARGEUR = int(a[6]) if len(a) > 6 else 256  # largeur d'une case (pixels)

scene = bpy.context.scene
cibles = [bpy.data.objects[nom] for nom in OBJET.split(",")]  # plusieurs objets possibles (tronc + feuilles)
for o in list(scene.objects):
    if o.type in ("LIGHT", "CAMERA"):
        bpy.data.objects.remove(o)
        continue
    o.hide_render = o not in cibles
def montrer(lc):  # collections des objets photographiés : rendues
    for enfant in lc.children:
        if any(o in enfant.collection.all_objects.values() for o in cibles):
            enfant.exclude = False
            enfant.collection.hide_render = False
        montrer(enfant)
montrer(bpy.context.view_layer.layer_collection)

# dimensions (sommets des maillages évalués, dans le repère monde)
deps = bpy.context.evaluated_depsgraph_get()
morceaux = []
for cible in cibles:
    ev = cible.evaluated_get(deps)
    me = ev.to_mesh()
    M = cible.matrix_world
    n = len(me.vertices)
    c = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", c)
    morceaux.append(c.reshape(n, 3) @ np.array(M.to_3x3()).T + np.array(M.translation))
    ev.to_mesh_clear()
co = np.concatenate(morceaux)
n = len(co)
zmin, zmax = float(co[:, 2].min()), float(co[:, 2].max())
# axe du tronc : centre des sommets du bas (10 % les plus bas)
bas = co[co[:, 2] < zmin + (zmax - zmin) * 0.1]
ax, ay = float(bas[:, 0].mean()), float(bas[:, 1].mean())
r = np.hypot(co[:, 0] - ax, co[:, 1] - ay)
R = float(np.percentile(r, 99.5))  # quelques feuilles qui dépassent peuvent être coupées
H = zmax - zmin
print("dimensions", NOM, "H", H, "R", R, "sommets", n)

# case : largeur fixe, hauteur selon les proportions (plafonnée)
W = 2 * R * 1.03
Hc = min(HMAX, int(round(LARGEUR * (H * 1.02) / W / 2)) * 2)
Hm = H * 1.02  # hauteur couverte par l'image (1 % de marge en bas et en haut)
Wm = Hm * LARGEUR / Hc  # largeur couverte (>= W)
if Wm < W:  # l'arbre est plus large que haut : c'est la largeur qui commande
    Wm = W
    Hm = Wm * Hc / LARGEUR

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = max(Wm, Hm)
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
centre_z = zmin - 0.01 * H + Hm / 2

soleil_d = bpy.data.lights.new("soleil", "SUN")
soleil_d.energy = 3.2
soleil_d.angle = math.radians(4)
soleil_d.color = (1.0, 0.95, 0.86)
soleil = bpy.data.objects.new("soleil", soleil_d)
scene.collection.objects.link(soleil)

monde = scene.world or bpy.data.worlds.new("monde")
scene.world = monde
monde.use_nodes = True
fond = monde.node_tree.nodes.get("Background") or monde.node_tree.nodes.new("ShaderNodeBackground")
fond.inputs[0].default_value = (0.62, 0.68, 0.78, 1)
fond.inputs[1].default_value = 0.9
sortie_m = next((nd for nd in monde.node_tree.nodes if nd.type == "OUTPUT_WORLD"), None) or monde.node_tree.nodes.new("ShaderNodeOutputWorld")
monde.node_tree.links.new(fond.outputs[0], sortie_m.inputs[0])

scene.render.engine = "CYCLES"
scene.cycles.samples = ECH
scene.cycles.use_denoising = False
scene.cycles.max_bounces = 6
scene.cycles.transparent_max_bounces = 24
try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for typ in ("OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = typ
            prefs.get_devices()
            if any(d.type == typ for d in prefs.devices):
                for d in prefs.devices:
                    d.use = d.type == typ
                scene.cycles.device = "GPU"
                print("GPU", typ)
                break
        except Exception:
            pass
except Exception as e:
    print("pas de GPU", e)
scene.render.film_transparent = True
scene.render.resolution_x = LARGEUR
scene.render.resolution_y = Hc
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"

bande = np.zeros((Hc, LARGEUR * VUES, 4), dtype=np.float32)
tmp = os.path.join(SORTIE, f"_{NOM}_vue.png")
D = 200
# caméra et soleil fixes ; c'est l'arbre qui tourne sur lui-même (éclairage identique pour toutes les vues)
pivot = bpy.data.objects.new("pivot", None)
scene.collection.objects.link(pivot)
pivot.location = (ax, ay, 0)
bpy.context.view_layer.update()
for cible in cibles:
    mw = cible.matrix_world.copy()
    cible.parent = pivot
    cible.matrix_world = mw
cam.location = Vector((ax, ay - D, centre_z))
cam.rotation_euler = Vector((0, 1, 0)).to_track_quat("-Z", "Y").to_euler()
# soleil : 40° sur la gauche de la caméra, 50° de haut
ps, hs = math.radians(40), math.radians(50)
ds = Vector((math.sin(ps) * math.cos(hs), -math.cos(ps) * math.cos(hs), math.sin(hs)))
soleil.rotation_euler = (-ds).to_track_quat("-Z", "Y").to_euler()
for k in range(VUES):
    # vue k : comme si la caméra tournait de k * 360° / VUES autour de l'arbre
    pivot.rotation_euler = (0, 0, -2 * math.pi * k / VUES)
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    p = np.empty(LARGEUR * Hc * 4, dtype=np.float32)
    img.pixels.foreach_get(p)
    bpy.data.images.remove(img)
    bande[:, k * LARGEUR:(k + 1) * LARGEUR] = p.reshape(Hc, LARGEUR, 4)
    print("vue", k, "faite")
os.remove(tmp)

o = bpy.data.images.new(NOM, LARGEUR * VUES, Hc, alpha=True)
o.pixels.foreach_set(bande.ravel())
o.filepath_raw = os.path.join(SORTIE, NOM + ".png")
o.file_format = "PNG"
o.save()
# quad dans le jeu, pour un arbre de hauteur 1 : largeur, hauteur, bas (sous le sol)
json.dump({"nom": NOM, "vues": VUES, "case": [LARGEUR, Hc], "largeur": Wm / H, "hauteur": Hm / H,
           "bas": (centre_z - Hm / 2 - zmin) / H, "rayon": R / H, "hauteurModele": H},
          open(os.path.join(SORTIE, NOM + ".json"), "w"), indent=1)
print("fini", NOM)
