# Blender 5.3 (sans fenêtre) : prépare le volcan du circuit Dinosaures.
# Modèle : "Zheltovsky volcano" par SebastianSosnowski (Sketchfab, CC-BY 4.0)
#   https://sketchfab.com/3d-models/zheltovsky-volcano-fbe039ada6544e1da210f38381d78e9a
#
# Le modèle d'origine est un carré de terrain (200 × 200 unités) avec le volcan un peu décentré,
# une jupe noire sur les côtés et des textures 4096 px (66 Mo). Ce script :
#  - supprime la jupe noire (deuxième maillage) ;
#  - recentre le sommet sur l'origine, pose le terrain sur y = 0 ;
#  - abaisse doucement le terrain loin du sommet (le pied s'enfonce sous le sol du jeu : plus de
#    bord carré ni de crêtes au bord du carré) et supprime les coins du carré (disque) ;
#  - creuse un cratère peu profond au sommet (le modèle a un sommet en dôme) : la lueur, la
#    fumée et les projections de volcan.js partent de là ;
#  - garde la photo d'origine (couleur) en 2048 px, le relief (normal map) en 1024 px, et
#    supprime la texture metallic/roughness (inutile avec le matériau Lambert du jeu) ;
#  - exporte en GLB (textures WebP).
#
# blender --background --factory-startup --python pack_zheltovsky.py -- scene.gltf public/nature/volcan.glb
import sys
import math
import bpy
import bmesh
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
SOURCE, SORTIE = args[0], args[1]
TAILLE_COULEUR = 2048
TAILLE_RELIEF = 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)

maillages = [o for o in bpy.data.objects if o.type == "MESH"]
# la jupe : maillage au matériau noir uni (sans texture)
terrain = max(maillages, key=lambda o: len(o.data.polygons))
for o in maillages:
    if o is not terrain:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.update()
monde = terrain.matrix_world.copy()
terrain.parent = None
terrain.matrix_world = monde  # le maillage garde sa transformation monde
for o in list(bpy.data.objects):
    if o.type == "EMPTY":
        bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.objects.active = terrain
terrain.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bm = bmesh.new()
bm.from_mesh(terrain.data)
P = np.array([v.co[:] for v in bm.verts])
zmax = P[:, 2].max()
# axe du volcan : centre des sommets les plus hauts
haut = P[P[:, 2] > zmax - 3.0]
cx, cy = haut[:, 0].mean(), haut[:, 1].mean()
# plus grand disque contenu dans le carré, centré sur le sommet
RMAX = min(P[:, 0].max() - cx, cx - P[:, 0].min(), P[:, 1].max() - cy, cy - P[:, 1].min()) - 1.0
print("zheltovsky : sommet", round(cx, 2), round(cy, 2), round(zmax, 2), "disque", round(RMAX, 2))


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def smin(a, b, k):
    """minimum adouci (pas d'arête vive au bord de la coupe)"""
    h = max(0.0, min(1.0, 0.5 + 0.5 * (b - a) / k))
    return b + (a - b) * h - k * h * (1 - h)


# ---------- disque : on enlève les coins du carré ----------
coins = [f for f in bm.faces if all(math.hypot(v.co.x - cx, v.co.y - cy) > RMAX for v in f.verts)]
bmesh.ops.delete(bm, geom=coins, context="FACES")
seuls = [v for v in bm.verts if not v.link_faces]
bmesh.ops.delete(bm, geom=seuls, context="VERTS")
print("triangles (disque)", sum(len(f.verts) - 2 for f in bm.faces))

# ---------- cratère ----------
RC = 7.0                       # rayon du cratère (unités du modèle)
BORD = zmax - 2.2              # hauteur du bord : le haut du dôme est coupé
PROFONDEUR, LEVRE = 3.6, 0.5   # creux du cratère et bourrelet du bord
for _ in range(1):  # plus de sommets autour du sommet (sinon le cratère est un simple polygone)
    aretes = [e for e in bm.edges if all(math.hypot(v.co.x - cx, v.co.y - cy) < RC * 1.8 for v in e.verts)]
    bmesh.ops.subdivide_edges(bm, edges=aretes, cuts=1, use_grid_fill=True)
bmesh.ops.triangulate(bm, faces=bm.faces[:])

ZBAS = -6.0  # le bord du disque descend sous le sol du jeu
for v in bm.verts:
    r = math.hypot(v.co.x - cx, v.co.y - cy)
    z = v.co.z
    if r < RC * 2:
        u = r / RC
        z = smin(z, BORD, 0.8)
        if u < 1:
            z -= PROFONDEUR * (1 - u * u) ** 1.5
        z += LEVRE * math.exp(-((u - 1) / 0.25) ** 2)
    # pied : le terrain plonge doucement sous le sol loin du sommet
    s = smoothstep(RMAX * 0.55, RMAX, r)
    z = z * (1 - s) + ZBAS * s
    v.co.x -= cx
    v.co.y -= cy
    v.co.z = z
bm.to_mesh(terrain.data)
bm.free()
for p in terrain.data.polygons:
    p.use_smooth = True
print("triangles", len(terrain.data.polygons))

# ---------- textures ----------
def image(mot):
    return next((i for i in bpy.data.images if mot in i.name.lower()), None)


coul, relief, mr = image("basecolor"), image("normal"), image("metallic")
if coul.size[0] > TAILLE_COULEUR:
    coul.scale(TAILLE_COULEUR, TAILLE_COULEUR)
    coul.pack()
if relief and relief.size[0] > TAILLE_RELIEF:
    relief.scale(TAILLE_RELIEF, TAILLE_RELIEF)
    relief.pack()

for mat in bpy.data.materials:
    if not mat.node_tree:
        continue
    for n in list(mat.node_tree.nodes):
        if n.type == "TEX_IMAGE" and n.image == mr:
            mat.node_tree.nodes.remove(n)
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        for e in ("Metallic", "Roughness", "Specular IOR Level"):
            for l in list(bsdf.inputs[e].links):
                mat.node_tree.links.remove(l)
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 0.95
if mr:
    bpy.data.images.remove(mr)

bpy.ops.export_scene.gltf(filepath=SORTIE, export_format="GLB", export_image_format="WEBP", export_image_quality=85,
                          export_materials="EXPORT", export_apply=True, export_tangents=False, export_vertex_color="NONE")
print("exporté", SORTIE)
