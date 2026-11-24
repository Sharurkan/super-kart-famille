# Blender (sans fenêtre) : rend le volcan plus réaliste, à partir de la sortie de pack_volcan.py.
#  - sommet tronqué et creusé en vrai cratère (bord un peu relevé), maillage subdivisé autour
#  - couleur : roche volcanique sombre (basalte, cendres) au lieu du grès orangé ; les ravines
#    (zones sombres de la texture) deviennent des coulées de lave refroidie presque noires
#
# À lancer UNE fois sur la sortie de pack_volcan.py (le cratère se creuserait encore sinon) :
# blender --background --python volcan_realiste.py -- volcan_pack.glb volcan.glb
import sys
import math
import bpy
import bmesh
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
SOURCE, SORTIE = args[0], args[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
obj = next(o for o in bpy.data.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# ---------- cratère ----------
bm = bmesh.new()
bm.from_mesh(obj.data)
zs = np.array([v.co.z for v in bm.verts])
zmin, zmax = zs.min(), zs.max()
H = zmax - zmin
haut = [v.co for v in bm.verts if v.co.z > zmax - 0.04 * H]
axe = Vector((sum(c.x for c in haut) / len(haut), sum(c.y for c in haut) / len(haut), 0))
BORD = zmax - 0.10 * H  # hauteur du bord du cratère (on coupe le dôme au-dessus)
dessus = sorted(math.hypot(v.co.x - axe.x, v.co.y - axe.y) for v in bm.verts if v.co.z > BORD)
RC = min(max(dessus[int(len(dessus) * 0.9)] if dessus else 5.0, 4.0), 9.0)  # rayon du cratère
print("volcan : H", round(H, 2), "axe", axe.to_tuple(2), "bord", round(BORD, 2), "rayon", round(RC, 2))

# plus de sommets autour du sommet (sinon le cratère est un simple polygone)
for _ in range(2):
    aretes = [e for e in bm.edges if all(math.hypot(v.co.x - axe.x, v.co.y - axe.y) < RC * 1.5 for v in e.verts)]
    bmesh.ops.subdivide_edges(bm, edges=aretes, cuts=1, use_grid_fill=True)
bmesh.ops.triangulate(bm, faces=bm.faces[:])


def smin(a, b, k):
    """minimum adouci (pas d'arête vive au bord de la coupe)"""
    h = max(0.0, min(1.0, 0.5 + 0.5 * (b - a) / k))
    return b + (a - b) * h - k * h * (1 - h)


PROFONDEUR, LEVRE = 0.55 * RC, 0.35  # creux du cratère et bourrelet du bord (unités du modèle)
for v in bm.verts:
    r = math.hypot(v.co.x - axe.x, v.co.y - axe.y)
    if r > RC * 2:
        continue
    u = r / RC
    z = smin(v.co.z, BORD, 0.6)
    if u < 1:
        z -= PROFONDEUR * (1 - u * u) ** 1.5
    z += LEVRE * math.exp(-((u - 1) / 0.22) ** 2)
    v.co.z = z
bm.to_mesh(obj.data)
bm.free()
for p in obj.data.polygons:
    p.use_smooth = True
print("triangles", len(obj.data.polygons))

# ---------- couleur : roche volcanique ----------
coul = next(i for i in bpy.data.images if "diffuse" in i.name.lower())
w, h = coul.size
px = np.empty(w * h * 4, dtype=np.float32)
coul.pixels.foreach_get(px)
r, g, b = px[0::4], px[1::4], px[2::4]
L = 0.3 * r + 0.59 * g + 0.11 * b
lo, hi = np.percentile(L, 3), np.percentile(L, 97)
t = np.clip((L - lo) / (hi - lo), 0, 1)
noir = np.array([0.045, 0.043, 0.048])   # lave refroidie (ravines)
basalte = np.array([0.21, 0.185, 0.17])   # roche
cendre = np.array([0.50, 0.46, 0.42])    # crêtes couvertes de cendres
t1 = np.clip(t / 0.45, 0, 1) ** 1.4
t2 = np.clip((t - 0.45) / 0.55, 0, 1) ** 1.2
for k in range(3):
    c = noir[k] + (basalte[k] - noir[k]) * t1 + (cendre[k] - basalte[k]) * t2
    orig = px[k::4]
    px[k::4] = c * 0.85 + orig * 0.15 * (c / np.maximum(L, 1e-3))  # garde un soupçon de la teinte d'origine
coul.pixels.foreach_set(px)
coul.pack()

bpy.ops.export_scene.gltf(filepath=SORTIE, export_format="GLB", export_image_format="WEBP", export_image_quality=82,
                          export_materials="EXPORT", export_apply=True, export_tangents=False, export_vertex_color="NONE")
print("exporté", SORTIE)
