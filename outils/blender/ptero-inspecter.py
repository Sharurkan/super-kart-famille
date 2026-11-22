# Inspection du modèle Pteranodon (Sketchfab) : objets, os, animations.
# blender --background --python ptero-inspecter.py -- chemin/scene.gltf
import bpy, sys
from mathutils import Vector
src = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in bpy.data.objects:
    print("OBJ", o.type, o.name, tuple(round(v, 3) for v in o.dimensions), "parent", o.parent.name if o.parent else None)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
me = next(o for o in bpy.data.objects if o.type == "MESH")
print("UV", [u.name for u in me.data.uv_layers], "tris", sum(len(p.vertices) - 2 for p in me.data.polygons))
for b in arm.data.bones:
    if b.parent is None or len(b.children) != 1 or b.name.lower().count("wing") or b.name.lower().count("foot") or b.name.lower().count("head"):
        print("BONE", b.name, "<-", b.parent.name if b.parent else None, tuple(round(v, 3) for v in (arm.matrix_world @ b.head_local)))
for a in bpy.data.actions:
    print("ACTION", a.name, tuple(a.frame_range))
# bornes du maillage en monde, à la pose de repos
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ev = me.evaluated_get(dg)
pts = [ev.matrix_world @ v.co for v in ev.data.vertices]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
print("BBOX", tuple(round(v, 3) for v in mn), tuple(round(v, 3) for v in mx))
print("FPS", bpy.context.scene.render.fps)
