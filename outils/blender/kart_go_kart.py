# Prépare public/karts/kart.glb à partir de « Cartoonish Go-Kart » (CaptCaviness, CC-BY 4.0)
# https://sketchfab.com/3d-models/cartoonish-go-kart-cb5b6546a26d48cd8c80320c11d24737
#
# Usage :
#   blender --background --python outils/blender/kart_go_kart.py -- <dossier_source> <sortie.glb> [ratio_carrosserie] [ratio_roues]
#
# - fusionne tout, remet à l'échelle (longueur 3 m, posé au sol, centré, avant = -Y Blender = +Z three.js) ;
# - sépare les 4 roues en objets "roue_avg/avd/arg/ard" avec l'origine au centre de la roue ;
# - texture couleur 1024 avec l'occlusion (AO) déjà multipliée dedans ;
# - la peinture bleue devient gris clair (dans la texture) et ses faces passent dans le matériau
#   "peinture" : en jeu, on teinte ce matériau avec la couleur du kart (map × couleur) ;
# - simplification (Decimate) pour rester léger.
import bpy, bmesh, sys, os
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
RATIO_CORPS = float(argv[2]) if len(argv) > 2 else 0.2
RATIO_ROUES = float(argv[3]) if len(argv) > 3 else 0.3
TEX = 1024
LONGUEUR = 3.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, "scene.gltf"))

# ---------- fusion + transformations appliquées ----------
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
kart = bpy.context.view_layer.objects.active
kart.name = "kart"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o.type != "MESH":
        bpy.data.objects.remove(o)

# repère d'origine (avant -Y) : cylindres des roues mesurés sur le modèle source
ROUES_SRC = {
    "roue_arg": ((-0.80, -0.27), (0.144, 0.19), 0.215),
    "roue_ard": ((0.25, 0.79), (0.144, 0.19), 0.215),
    "roue_avg": ((-0.63, -0.19), (-0.822, 0.141), 0.18),
    "roue_avd": ((0.16, 0.62), (-0.822, 0.141), 0.18),
}

me = kart.data
co = np.empty(len(me.vertices) * 3)
me.vertices.foreach_get("co", co)
co = co.reshape(-1, 3)
mn, mx = co.min(0), co.max(0)
s = LONGUEUR / (mx[1] - mn[1])
decal = np.array([-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]])
print("ECHELLE", s, "DECALAGE", decal)


def vers_jeu(p):
    return (np.asarray(p) + decal) * s


co = (co + decal) * s
me.vertices.foreach_set("co", co.ravel())
me.update()
ROUES = {}
for nom, ((x0, x1), (cy, cz), r) in ROUES_SRC.items():
    a = vers_jeu([x0, cy, cz])
    b = vers_jeu([x1, cy, cz])
    ROUES[nom] = ((a[0], b[0]), (a[1], a[2]), r * s)

# ---------- textures : couleur × AO, peinture bleue -> gris ----------
def charger(nom):
    img = bpy.data.images.load(os.path.join(SRC, "textures", nom))
    img.scale(TEX, TEX)
    px = np.empty(TEX * TEX * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(TEX, TEX, 4)


diff = charger("blinn1SG_diffuse.png")  # (ligne 0 = bas de l'image = v 0)
ao = charger("blinn1SG_occlusion.png")[..., 0]
rgb = diff[..., :3]
bleu = (rgb[..., 2] > rgb[..., 0] + 0.25) & (rgb[..., 2] > rgb[..., 1] + 0.25)


def dilater(m, r):
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(m, dy, 0), dx, 1)
    return out


def eroder(m, r):
    return ~dilater(~m, r)


peint = eroder(dilater(bleu, 5), 5)  # bouche les lettres blanches dans le bleu
lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
lum_bleu = float(np.median(lum[bleu]))
gris = np.clip(lum / lum_bleu * 0.82, 0, 1)
aof = 0.45 + 0.55 * ao  # AO adouci
sortie = rgb.copy()
sortie[peint] = gris[peint][:, None]
sortie *= aof[..., None]
img = bpy.data.images.new("kart_couleur", TEX, TEX, alpha=False)
px = np.ones((TEX, TEX, 4), dtype=np.float32)
px[..., :3] = sortie
img.pixels.foreach_set(px.ravel())
img.file_format = "JPEG"
img.filepath_raw = os.path.join(os.path.dirname(OUT), "kart_couleur.jpg")
img.save()
img.pack()

# ---------- matériaux ----------
def materiau(nom):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.55
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    m.use_backface_culling = False
    return m


m_kart, m_peint = materiau("kart"), materiau("peinture")
me.materials.clear()
me.materials.append(m_kart)
me.materials.append(m_peint)

uvl = me.uv_layers.active.data
n_peint = 0
for p in me.polygons:
    uvs = [Vector(uvl[i].uv) for i in p.loop_indices]
    c = sum(uvs, Vector((0, 0))) / len(uvs)
    pts = [c] + [c.lerp(u, 0.6) for u in uvs]
    vote = 0
    for u in pts:
        x = int(min(max(u.x % 1.0, 0), 0.9999) * TEX)
        y = int(min(max(u.y % 1.0, 0), 0.9999) * TEX)
        vote += 1 if peint[y, x] else -1
    p.material_index = 1 if vote > 0 else 0
    n_peint += vote > 0
print("FACES PEINTURE", n_peint, "/", len(me.polygons))

# ---------- séparation des roues (parties détachées entièrement dans le cylindre) ----------
bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
vu = set()
parties = []
for v in bm.verts:
    if v.index in vu:
        continue
    pile, comp = [v], []
    vu.add(v.index)
    while pile:
        x = pile.pop()
        comp.append(x.index)
        for e in x.link_edges:
            y = e.other_vert(x)
            if y.index not in vu:
                vu.add(y.index)
                pile.append(y)
    parties.append(comp)
bm.free()


def dans_roue(idx, roue):
    (x0, x1), (cy, cz), r = roue
    for i in idx:
        p = co[i]
        if not (x0 - 0.01 <= p[0] <= x1 + 0.01):
            return False
        if (p[1] - cy) ** 2 + (p[2] - cz) ** 2 > (r * 1.06) ** 2:
            return False
    return True


for nom, roue in ROUES.items():
    sel = set()
    for comp in parties:
        if dans_roue(comp, roue):
            sel.update(comp)
    print("ROUE", nom, len(sel), "sommets")
    bpy.ops.object.select_all(action="DESELECT")
    kart.select_set(True)
    bpy.context.view_layer.objects.active = kart
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for i in sel:
        me.vertices[i].select = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_linked()
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    nouveau = [o for o in bpy.context.selected_objects if o != kart][0]
    nouveau.name = nom
    # origine au centre de la roue
    vs = np.array([v.co[:] for v in nouveau.data.vertices])
    c = (vs.min(0) + vs.max(0)) / 2
    bpy.context.scene.cursor.location = Vector(c)
    bpy.ops.object.select_all(action="DESELECT")
    nouveau.select_set(True)
    bpy.context.view_layer.objects.active = nouveau
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    print("  centre", c.round(3), "rayon", ((vs.max(0) - vs.min(0))[2] / 2).round(3))
    # co a changé d'indices après separate : on le relit
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    # recalcul des parties détachées sur le maillage restant
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    vu = set()
    parties = []
    for v in bm.verts:
        if v.index in vu:
            continue
        pile, comp = [v], []
        vu.add(v.index)
        while pile:
            x = pile.pop()
            comp.append(x.index)
            for e in x.link_edges:
                y = e.other_vert(x)
                if y.index not in vu:
                    vu.add(y.index)
                    pile.append(y)
        parties.append(comp)
    bm.free()

# ---------- simplification ----------
total = 0
for o in bpy.context.scene.objects:
    if o.type != "MESH":
        continue
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    d = o.modifiers.new("dec", "DECIMATE")
    d.ratio = RATIO_ROUES if o.name.startswith("roue") else RATIO_CORPS
    d.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=d.name)
    bpy.ops.object.shade_smooth_by_angle(angle=0.75)
    n = sum(len(p.vertices) - 2 for p in o.data.polygons)
    total += n
    print("TRIS", o.name, n)
print("TRIS TOTAL", total)

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_image_format="JPEG",
    export_jpeg_quality=88,
    export_tangents=False,
    export_yup=True,
    export_apply=True,
    export_materials="EXPORT",
)
bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(OUT)[0] + "_debug.blend")
