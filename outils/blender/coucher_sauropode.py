# Diplodocus couché pour le circuit des dinosaures (public/dinos/diplodocus.glb).
#
# Source : "Brachiosaurus_AR card" de Zinaida.Kovrova (Sketchfab, CC-BY 4.0),
# https://sketchfab.com/3d-models/brachiosaurus-ar-card-751b32784e1a4ddd9c95aa88d7640ab7
# (glTF avec squelette 3ds Max Biped et une animation de broutage).
#
# On prend la pose de la 1re image de l'animation, puis on oriente les os un par un (direction
# voulue dans le monde) : ventre au sol, pattes repliées (avant en sphinx, arrière repliées sur
# le côté), cou tendu vers l'avant qui descend jusqu'à la tête posée au sol (menton par terre,
# bouche fermée), le bout du cou en S pour que la tête repose à côté de la rampe, tournée vers
# les karts ; queue droite qui redescend jusqu'au sol. Cou, tête et queue sont un peu épaissis
# (on roule dessus). La pose est ensuite "cuite" dans le maillage, le squelette enlevé, le
# maillage simplifié (8 000 triangles, textures JPEG 512 px) et exporté en glb.
#
# Aperçus : apercu_sauropode.py (vues générales) et apercu_tete_sauropode.py (gros plans).
#
# blender --background --python coucher_sauropode.py -- scene.gltf sortie.glb [apercus/]
import bpy, sys, math, os
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = args[0], args[1]
APERCUS = args[2] if len(args) > 2 else None
TRIANGLES = 8000

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
for o in list(bpy.data.objects):
    if o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o)
sc = bpy.context.scene
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.data.objects if o.type == "MESH"]

# 1. pose de départ : 1re image de l'animation, puis plus d'animation
sc.frame_set(1)
bases = {pb.name: pb.matrix_basis.copy() for pb in arm.pose.bones}
for o in bpy.data.objects:
    o.animation_data_clear()
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"
    pb.matrix_basis = bases[pb.name]
bpy.context.view_layer.update()

MW = arm.matrix_world
MWi = MW.inverted()


def os_(nom_debut):
    return next(pb for pb in arm.pose.bones if pb.name.startswith(nom_debut + "_"))


def tete(pb):
    return MW @ pb.head


def queue(pb):
    return MW @ pb.tail


def orienter(pb, d_monde):
    """Tourne l'os (autour de sa tête) pour que sa direction dans le monde soit d_monde."""
    bpy.context.view_layer.update()
    cur = (queue(pb) - tete(pb)).normalized()
    q = cur.rotation_difference(Vector(d_monde).normalized())
    # rotation monde -> espace de l'armature
    R = (MWi.to_3x3() @ q.to_matrix() @ MW.to_3x3()).to_4x4()
    h = pb.head.copy()
    M = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ pb.matrix
    pb.matrix = M
    bpy.context.view_layer.update()


def dir_pitch(deg, y=0.0, avant=-1.0):
    """Direction dans le plan (X, Z) : avant = -1 vers la tête (-X), +1 vers la queue ; deg > 0 : descend."""
    a = math.radians(deg)
    return Vector((avant * math.cos(a), y, -math.sin(a)))


# 2. mesures : le dessous du ventre (sol) sur la pose de départ
dg = bpy.context.evaluated_depsgraph_get()


def points_monde():
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in meshes:
        e = o.evaluated_get(dg)
        m = e.to_mesh()
        pts += [o.matrix_world @ v.co for v in m.vertices]
        e.to_mesh_clear()
    return pts


# 3. pattes repliées
for cote, s in (("L", -1), ("R", 1)):
    # avant : en sphinx, coude en arrière, avant-bras posé vers l'avant sur le côté du cou
    orienter(os_(f"Bip001 {cote} UpperArm"), (0.5, s * 0.5, -0.68))
    orienter(os_(f"Bip001 {cote} Forearm"), (-0.97, s * 0.2, 0.05))
    orienter(os_(f"Bip001 {cote} Hand"), (-0.95, s * 0.1, -0.25))
    # arrière : genou vers l'avant et vers l'extérieur, jambe repliée vers l'arrière, pied à plat
    orienter(os_(f"Bip001 {cote} Thigh"), (-0.55, s * 0.55, -0.62))
    orienter(os_(f"Bip001 {cote} Calf"), (0.93, s * 0.2, -0.3))
    orienter(os_(f"Bip001 {cote} Foot"), (0.5, s * 0.1, -0.86))

# 4. queue : droite, elle descend des hanches jusqu'au sol puis reste posée (courbe en S douce)
QUEUE = [f"Bip001 Tail{n}" if n else "Bip001 Tail" for n in range(10)]
PROFIL_QUEUE = [9, 14, 17, 18, 18, 17, 15, 11, 8, 7]
for nom, deg in zip(QUEUE, PROFIL_QUEUE):
    orienter(os_(nom), dir_pitch(deg, avant=1.0))

# le sol : dessous du ventre (tronc seul, entre les pattes)
pts = points_monde()
YC = (tete(os_("Bip001 Spine1")).y + tete(os_("Bip001 Tail")).y + tete(os_("Bip001 Neck1")).y) / 3  # axe du corps
ventre = [p for p in pts if 0.0 < p.x < 2.5 and abs(p.y - YC) < 0.45]
SOL = min(p.z for p in ventre)
print("SOL (dessous du ventre)", round(SOL, 3), "axe y", round(YC, 3))
for pb in arm.pose.bones:
    if any(k in pb.name for k in ("Forearm", "Hand", "Calf", "Foot", "Tail9", "Tail7")):
        print("  os", pb.name.split("_")[0], "bout à", round(queue(pb).z - SOL, 2), "au-dessus du sol, x", round(queue(pb).x, 2), "y", round(queue(pb).y, 2))
lo_pts = sorted(pts, key=lambda p: p.z)[:5]
print("  points les plus bas", [(round(p.x, 1), round(p.y, 1), round(p.z - SOL, 2)) for p in lo_pts])


# 5. cou, tête et queue un peu plus épais (on roule dessus : le vrai cou est très fin à cette
# échelle). Chaque os grossit seul en travers (pas d'héritage d'échelle), la longueur ne change pas.
COU = [f"Bip001 Neck{n}" for n in range(1, 10)]
EPAIS_COU = (1.3, 1.5)  # Neck1 (épaules) -> Neck9 (près de la tête)
EPAIS_TETE = 1.45
EPAIS_QUEUE = (1.15, 1.8)  # Tail -> Tail9
for n, nom in enumerate(COU):
    f = EPAIS_COU[0] + (EPAIS_COU[1] - EPAIS_COU[0]) * n / (len(COU) - 1)
    pb = os_(nom)
    arm.data.bones[pb.name].inherit_scale = "NONE"
    pb.scale = (f, 1.0, f)
pb = os_("Bip001 Head")
arm.data.bones[pb.name].inherit_scale = "NONE"
pb.scale = (EPAIS_TETE,) * 3
for n, nom in enumerate(QUEUE):
    f = EPAIS_QUEUE[0] + (EPAIS_QUEUE[1] - EPAIS_QUEUE[0]) * n / (len(QUEUE) - 1)
    pb = os_(nom)
    arm.data.bones[pb.name].inherit_scale = "NONE"
    pb.scale = (f, 1.0, f)
bpy.context.view_layer.update()


def tourner(pb, axe_monde, deg):
    """Tourne l'os autour de sa tête, d'un angle autour d'un axe du monde."""
    q = Matrix.Rotation(math.radians(deg), 3, Vector(axe_monde))
    R = (MWi.to_3x3() @ q @ MW.to_3x3()).to_4x4()
    h = pb.head.copy()
    pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ pb.matrix
    bpy.context.view_layer.update()


# 6. cou tendu vers l'avant, qui descend jusqu'à la tête posée au sol (menton par terre)
COU_FORME = float(os.environ.get("COU_FORME", "1.5"))  # cou qui descend vite près des épaules puis repose au sol
TETE_PITCH = float(os.environ.get("TETE_PITCH", "-4"))  # direction de l'os de la tête (< 0 : museau relevé)
MACHOIRE = float(os.environ.get("MACHOIRE", "25"))  # rotation de la mâchoire (bouche fermée)
noms_tete = {os_("Bip001 Head").name} | {pb.name for pb in arm.pose.bones if pb.name.startswith("Bone0") and int(pb.name[4:7]) in (1, 18, 19, 20, 21, 22, 23)}


def bas_de_la_tete():
    """Point le plus bas de la tête (sommets pesés surtout sur les os de la tête)."""
    dg = bpy.context.evaluated_depsgraph_get()
    zmin = 1e9
    for o in meshes:
        idx = {g.index for g in o.vertex_groups if g.name in noms_tete}
        e = o.evaluated_get(dg)
        m = e.to_mesh()
        src = o.data.vertices
        for v, vs in zip(m.vertices, src):
            if sum(g.weight for g in vs.groups if g.group in idx) > 0.5:
                zmin = min(zmin, (o.matrix_world @ v.co).z)
        e.to_mesh_clear()
    return zmin


def poser_cou(k):
    # descend plus fort près des épaules, puis presque à plat avant la tête
    for n, nom in enumerate(COU):
        t = n / (len(COU) - 1)
        deg = k * (1.0 - t) ** COU_FORME
        orienter(os_(nom), dir_pitch(deg))
    orienter(os_("Bip001 Head"), dir_pitch(TETE_PITCH))


if MACHOIRE:
    tourner(os_("Bone001"), (0, 1, 0), MACHOIRE)
lo, hi = -10.0, 40.0
for _ in range(16):
    k = (lo + hi) / 2
    poser_cou(k)
    if bas_de_la_tete() > SOL + 0.03:
        lo = k
    else:
        hi = k
print("cou : angle", round(k, 2), "bas de la tête à", round(bas_de_la_tete() - SOL, 3), "au-dessus du sol")

# 6b. le bout du cou fait un S sur le côté : la tête se pose à côté de la rampe, tournée vers les
# karts qui arrivent (on voit bien son visage) ; le reste du cou reste dans l'axe de la route.
# (rotations autour de la verticale : les hauteurs ne changent pas)
VIRAGE_COU = [float(a) for a in os.environ.get("VIRAGE_COU", "0,0,0,8,12,12,-4,-14,-14").split(",")]  # Neck1..Neck9, cumulé
VIRAGE_TETE = float(os.environ.get("VIRAGE_TETE", "-6"))
for nom, deg in zip(COU, VIRAGE_COU):
    if deg:
        tourner(os_(nom), (0, 0, 1), deg)
if VIRAGE_TETE:
    tourner(os_("Bip001 Head"), (0, 0, 1), VIRAGE_TETE)
print("tête : y", round(tete(os_("Bip001 Head")).y, 2), "x", round(tete(os_("Bip001 Head")).x, 2))

# 7. on cuit la pose dans le maillage, on enlève le squelette
dg = bpy.context.evaluated_depsgraph_get()
cuits = []
for o in meshes:
    e = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(e, preserve_all_data_layers=True, depsgraph=dg)
    me.transform(o.matrix_world)
    n = bpy.data.objects.new(o.name + "_cuit", me)
    sc.collection.objects.link(n)
    cuits.append(n)
for o in list(bpy.data.objects):
    if o not in cuits:
        bpy.data.objects.remove(o)
bpy.ops.object.select_all(action="DESELECT")
for o in cuits:
    o.select_set(True)
bpy.context.view_layer.objects.active = cuits[0]
if len(cuits) > 1:
    bpy.ops.object.join()
dino = bpy.context.view_layer.objects.active
dino.name = "diplodocus"
dino.vertex_groups.clear()
me = dino.data

# 8. recentré : ventre sur z = 0, ligne du dos sur y = 0, tête vers -X
me.transform(Matrix.Translation((0, -YC, -SOL)))

# 9. nettoyage (une seule couche d'UV, sommets soudés, normales lisses) puis simplification
while len(me.uv_layers) > 1:
    me.uv_layers.remove(me.uv_layers[-1])
for a in [a.name for a in me.color_attributes]:
    me.color_attributes.remove(me.color_attributes[a])
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=0.0005)
bpy.ops.object.mode_set(mode="OBJECT")
try:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
except Exception as e:
    print("normales", e)
mod = dino.modifiers.new("dec", "DECIMATE")
nb_tri = sum(len(p.vertices) - 2 for p in me.polygons)
mod.ratio = min(1.0, TRIANGLES / nb_tri)
bpy.ops.object.modifier_apply(modifier="dec")
for p in me.polygons:
    p.use_smooth = True
print("triangles", nb_tri, "->", sum(len(p.vertices) - 2 for p in me.polygons))
xs = [v.co.x for v in me.vertices]
zs = [v.co.z for v in me.vertices]
print("BOITE x", round(min(xs), 2), round(max(xs), 2), "z", round(min(zs), 2), round(max(zs), 2))

# profil du dessus le long du corps (pour régler la pente)
NB = 40
x0, x1 = min(xs), max(xs)
haut = [-9.0] * NB
for v in me.vertices:
    if abs(v.co.y) < 0.35:
        i = min(NB - 1, int((v.co.x - x0) / (x1 - x0) * NB))
        haut[i] = max(haut[i], v.co.z)
print("PROFIL", [round(h, 2) for h in haut])
larg = [0.0] * NB
for v in me.vertices:
    i = min(NB - 1, int((v.co.x - x0) / (x1 - x0) * NB))
    if v.co.z > haut[i] - 0.25:
        larg[i] = max(larg[i], abs(v.co.y))
print("DEMI-LARGEUR DU DESSUS", [round(h, 2) for h in larg])

# 10. export (textures en JPEG, 512 px comme la source)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=False, export_image_format="JPEG",
                          export_jpeg_quality=88, export_animations=False, export_skins=False, export_morph=False,
                          export_apply=True, export_yup=True)
print("EXPORT", OUT, os.path.getsize(OUT))

if APERCUS:
    blend = os.path.join(APERCUS, "couche.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend)
