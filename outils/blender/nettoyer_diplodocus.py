# Blender (mode sans fenêtre) : enlève le "socle" plat que le générateur IA a ajouté autour du
# diplodocus couché (une plaque fine posée au sol), et pose l'animal sur le sol (y = 0).
#
# blender --background --python nettoyer_diplodocus.py -- entree.glb sortie.glb
#
# Le modèle est couché le long de X (tête vers -X, queue vers +X), Z en haut dans Blender.
# La plaque a son dessous à ~zmin + 0,01 et son dessus à ~zmin + 0,024 : on supprime toutes
# les faces entièrement sous zmin + COUPE, puis les petits morceaux restés isolés. Le bas de
# l'animal (ouvert) se retrouve juste sous le sol.
import sys
import bpy, bmesh

args = sys.argv[sys.argv.index("--") + 1:]
ENTREE, SORTIE = args[0], args[1]
COUPE = 0.028  # au-dessus du dessus de la plaque (0,024)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=ENTREE)
obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bm = bmesh.new()
bm.from_mesh(obj.data)
avant = len(bm.faces)
# le modèle généré a chaque triangle séparé : on soude (les UV restent par coin de face)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
zmin = min(v.co.z for v in bm.verts)
coupe = zmin + COUPE

# 1. la plaque : toutes les faces dont tous les sommets sont sous la coupe
plaque = [f for f in bm.faces if max(v.co.z for v in f.verts) < coupe]
bmesh.ops.delete(bm, geom=plaque, context="FACES")

# 2. petits morceaux isolés (bouts de plaque, miettes) : on garde les gros morceaux
bm.faces.ensure_lookup_table()
vus, morceaux = set(), []
for f in bm.faces:
    if f.index in vus:
        continue
    pile, m = [f], []
    vus.add(f.index)
    while pile:
        a = pile.pop()
        m.append(a)
        for e in a.edges:
            for b in e.link_faces:
                if b.index not in vus:
                    vus.add(b.index)
                    pile.append(b)
    morceaux.append(m)
morceaux.sort(key=len, reverse=True)
miettes = [f for m in morceaux if len(m) < 200 for f in m]
bmesh.ops.delete(bm, geom=miettes, context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")

# 3. posé sur le sol : la coupe à z = 0
for v in bm.verts:
    v.co.z -= coupe
bm.to_mesh(obj.data)
print("faces", avant, "->", len(obj.data.polygons), "| morceaux", [len(m) for m in morceaux[:6]], "| plaque", len(plaque), "miettes", len(miettes))
xs = [v.co.x for v in obj.data.vertices]
ys = [v.co.y for v in obj.data.vertices]
zs = [v.co.z for v in obj.data.vertices]
print("boite x", min(xs), max(xs), "y", min(ys), max(ys), "z", min(zs), max(zs))

bpy.ops.export_scene.gltf(filepath=SORTIE, export_format="GLB", export_image_format="AUTO", export_normals=False, export_materials="EXPORT")
