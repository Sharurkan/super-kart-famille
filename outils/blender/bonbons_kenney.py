# Prépare public/bonbons/bonbons.glb à partir du "Food Kit" de Kenney (CC0, https://kenney.nl/assets/food-kit).
#
#   blender --background --python outils/blender/bonbons_kenney.py -- <dossier "Models/GLB format"> <sortie.glb>
#
# Pour chaque friandise : la couleur de la texture "colormap" est recopiée dans les couleurs de
# sommets (plus de texture), puis le modèle est coupé en deux objets :
#   <nom>_teinte : les parties colorées (bonbon, papier, glaçage) en gris clair -> le jeu les
#                  colore bonbon par bonbon (rose, jaune, bleu...) ;
#   <nom>_fixe   : le reste (bâton, chocolat, pâte, vermicelles, cerise) garde ses couleurs.
# Chaque friandise est centrée, debout face à la route, et mesure 1 (plus grande dimension).
import bpy, bmesh, sys
from mathutils import Vector, Matrix
from math import radians

args = sys.argv[sys.argv.index("--") + 1:]
DOSSIER, SORTIE = args[0], args[1]

# nom dans le jeu, fichier Kenney, rotation autour de x (degrés) pour le mettre debout,
# double face (le dessus glacé recopié en miroir dessous : il tourne sur lui-même, on voit les deux côtés)
MODELES = [
    ("sucette", "lollypop", 0, False),
    ("chocolat", "chocolate-wrapper", 90, False),
    ("beignet", "donut-sprinkles", 90, True),
    ("cupcake", "cupcake", 0, False),
]


def lineaire(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def luminance(c):
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def a_teinter(c):
    r, g, b = c
    rose = r > 0.8 and b > 0.75 and g < 0.7  # sucette, glaçage, rayures du cupcake
    violet = b > 0.7 and r < 0.6 and g < 0.45  # papier du chocolat
    return rose or violet


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
resultats = []
for nom, fichier, rot, double in MODELES:
    avant = set(scene.objects)
    bpy.ops.import_scene.gltf(filepath=f"{DOSSIER}/{fichier}.glb")
    objets = [o for o in scene.objects if o not in avant and o.type == "MESH"]
    img = bpy.data.images["colormap"]
    W, H = img.size
    px = list(img.pixels)

    # une seule géométrie, transformations appliquées
    me = bpy.data.meshes.new(nom)
    bm = bmesh.new()
    for o in objets:
        m = o.data.copy()
        m.transform(o.matrix_world)
        bm.from_mesh(m)
        bpy.data.meshes.remove(m)
    if double:
        zs = [v.co.z for v in bm.verts]
        zmil = (min(zs) + max(zs)) / 2
        # on garde le dessus, puis on le recopie retourné dessous (faces inversées pour rester visibles)
        dessous = [f for f in bm.faces if f.calc_center_median().z < zmil]
        bmesh.ops.delete(bm, geom=dessous, context="FACES")
        copie = bmesh.ops.duplicate(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:])
        vs = [e for e in copie["geom"] if isinstance(e, bmesh.types.BMVert)]
        fs = [e for e in copie["geom"] if isinstance(e, bmesh.types.BMFace)]
        for v in vs:
            v.co.z = 2 * zmil - v.co.z
        bmesh.ops.reverse_faces(bm, faces=fs)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
        bm.normal_update()
    # couleur de chaque face (échantillon au centre de ses UV)
    uvl = bm.loops.layers.uv.active
    couleurs = []
    for f in bm.faces:
        u = sum(l[uvl].uv[0] for l in f.loops) / len(f.loops)
        v = sum(l[uvl].uv[1] for l in f.loops) / len(f.loops)
        x, y = min(W - 1, int(u * W)), min(H - 1, int(v * H))
        k = (y * W + x) * 4
        couleurs.append(tuple(px[k:k + 3]))
    teinte = [a_teinter(c) for c in couleurs]
    ref = max([luminance(c) for c, t in zip(couleurs, teinte) if t] or [1])
    bm.to_mesh(me)
    bm.free()
    for o in objets:
        bpy.data.objects.remove(o)
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    me.materials.clear()

    # debout, centré, plus grande dimension = 1
    me.transform(Matrix.Rotation(radians(rot), 4, "X"))
    xs = [v.co for v in me.vertices]
    mn = Vector((min(c.x for c in xs), min(c.y for c in xs), min(c.z for c in xs)))
    mx = Vector((max(c.x for c in xs), max(c.y for c in xs), max(c.z for c in xs)))
    taille = max(mx - mn)
    me.transform(Matrix.Scale(1 / taille, 4) @ Matrix.Translation(-(mn + mx) / 2))

    # deux objets : parties à teinter / parties fixes
    for partie, garder in (("teinte", True), ("fixe", False)):
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        retirer = [f for f in bm.faces if teinte[f.index] != garder]
        cols = {f.index: couleurs[f.index] for f in bm.faces}
        coul = bm.loops.layers.float_color.new("Col")
        for f in bm.faces:
            c = cols[f.index]
            if garder:
                g = min(1.0, luminance(c) / ref)
                c = (g, g, g)
            lin = (lineaire(c[0]), lineaire(c[1]), lineaire(c[2]), 1.0)
            for l in f.loops:
                l[coul] = lin
        bmesh.ops.delete(bm, geom=retirer, context="FACES")
        if not bm.faces:
            bm.free()
            continue
        m2 = bpy.data.meshes.new(f"{nom}_{partie}")
        bm.to_mesh(m2)
        if m2.has_custom_normals:  # normales recalculées (faces plates, comme le style Kenney)
            m2.normals_split_custom_set([(0, 0, 0)] * len(m2.loops))
        for p in m2.polygons:
            p.use_smooth = False
        m2.color_attributes.active_color_index = 0
        m2.color_attributes.render_color_index = 0
        bm.free()
        ob = bpy.data.objects.new(f"{nom}_{partie}", m2)
        scene.collection.objects.link(ob)
        m2.calc_loop_triangles()
        resultats.append((ob.name, len(m2.loop_triangles)))
    bpy.data.meshes.remove(me)

for o in scene.objects:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=SORTIE, export_format="GLB", export_materials="NONE", export_texcoords=False,
                          export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_yup=True)
for n, t in resultats:
    print("objet", n, "triangles", t)
print("exporté", SORTIE)
