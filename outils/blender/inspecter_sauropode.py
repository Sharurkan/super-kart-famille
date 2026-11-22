# Inspecte le modèle de sauropode (glTF) : objets, os, animation.
# blender --background --python inspecter_sauropode.py -- chemin/scene.gltf
import bpy, sys, mathutils
args = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args[0])
for o in bpy.data.objects:
    print("OBJ", o.name, o.type, tuple(round(v, 3) for v in o.location), tuple(round(v, 3) for v in o.rotation_euler), tuple(round(v, 3) for v in o.scale), "parent", o.parent.name if o.parent else None)
    if o.type == "MESH":
        ws = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
        print("  bbox monde", [round(min(w[i] for w in ws), 2) for i in range(3)], [round(max(w[i] for w in ws), 2) for i in range(3)], "faces", len(o.data.polygons), "vgroups", len(o.vertex_groups))
for a in bpy.data.actions:
    print("ACTION", a.name, a.frame_range)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for b in arm.pose.bones:
    h = arm.matrix_world @ b.head
    t = arm.matrix_world @ b.tail
    print("BONE", b.name, "parent", b.parent.name if b.parent else None, "head", tuple(round(v, 2) for v in h), "tail", tuple(round(v, 2) for v in t))
