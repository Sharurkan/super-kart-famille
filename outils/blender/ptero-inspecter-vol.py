# Échantillonne l'animation "flying" : hauteur du bout d'aile et position des pattes.
import bpy, sys
src = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
arm.animation_data.action = bpy.data.actions["flying"]
sc = bpy.context.scene
for b in arm.data.bones:
    if "thigh" in b.name.lower() or "knee" in b.name.lower() or "hip" in b.name.lower() or "pelvis" in b.name.lower() or "Root" in b.name:
        print("B", b.name, b.parent.name if b.parent else None)
def P(n, tail=False):
    pb = arm.pose.bones[n]
    return arm.matrix_world @ (pb.tail if tail else pb.head)
for f in range(0, 258, 4):
    sc.frame_set(f)
    c = P("chest.9_9"); w = P("Lwing03.37_37", True); a = P("Lankle.94_94"); h = P("head.15_15")
    print(f"F{f:3d} aile z {w.z - c.z:+.3f} x {w.x:+.3f} | cheville {a.x:+.3f} {a.y:+.3f} {a.z:+.3f} | torse {c.x:+.3f} {c.y:+.3f} {c.z:+.3f} | tete {h.y:+.3f} {h.z:+.3f}")
