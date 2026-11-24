# Blender (sans fenêtre) : prépare le volcan ("Volcano" par santhu48, CC-BY 4.0, Sketchfab).
# ANCIEN MODÈLE : le jeu utilise maintenant "Zheltovsky volcano" (pack_zheltovsky.py). Gardé comme
# exemple générique (AO multipliée dans la couleur, textures réduites, simplification).
#  - l'occlusion ambiante (AO) est multipliée dans la couleur (une texture de moins)
#  - textures ramenées à 1024 px (couleur) et TAILLE_RELIEF (normal map), export WebP
#
# blender --background --python pack_volcan.py -- scene.gltf sortie.glb [taille_relief] [max_tri]
import sys
import bpy
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
SOURCE, SORTIE = args[0], args[1]
TAILLE_RELIEF = int(args[2]) if len(args) > 2 else 1024
MAX_TRI = int(args[3]) if len(args) > 3 else 100000

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)

maillages = [o for o in bpy.data.objects if o.type == "MESH"]
for o in maillages:
    t = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if t > MAX_TRI:
        mod = o.modifiers.new("simplifier", "DECIMATE")
        mod.ratio = MAX_TRI / t
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=mod.name)
    print("volcan triangles", t, "->", sum(len(p.vertices) - 2 for p in o.data.polygons))


def image(mot):
    return next((i for i in bpy.data.images if mot in i.name.lower()), None)


coul, ao, relief = image("diffuse"), image("occlusion"), image("normal")
if coul.size[0] > 1024:
    coul.scale(1024, 1024)
w, h = coul.size
if ao:
    ao.scale(w, h)
    pc = np.empty(w * h * 4, dtype=np.float32); coul.pixels.foreach_get(pc)
    pa = np.empty(w * h * 4, dtype=np.float32); ao.pixels.foreach_get(pa)
    occ = 0.35 + 0.65 * pa[0::4]  # AO adouci (le jeu a déjà ses propres ombres de lumière)
    for k in range(3):
        pc[k::4] *= occ
    coul.pixels.foreach_set(pc)
    coul.pack()
if relief and relief.size[0] > TAILLE_RELIEF:
    relief.scale(TAILLE_RELIEF, TAILLE_RELIEF)
    relief.pack()

# matériau : couleur + relief seulement (on débranche l'AO et le reste)
for mat in bpy.data.materials:
    if not mat.node_tree:
        continue
    for n in list(mat.node_tree.nodes):
        if n.type == "TEX_IMAGE" and n.image == ao:
            mat.node_tree.nodes.remove(n)
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        for e in ("Metallic", "Roughness", "Specular IOR Level"):
            for l in list(bsdf.inputs[e].links):
                mat.node_tree.links.remove(l)
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 0.95
if ao:
    bpy.data.images.remove(ao)

bpy.ops.export_scene.gltf(filepath=SORTIE, export_format="GLB", export_image_format="WEBP", export_image_quality=82,
                          export_materials="EXPORT", export_apply=True, export_tangents=False, export_vertex_color="NONE")
print("exporté", SORTIE)
