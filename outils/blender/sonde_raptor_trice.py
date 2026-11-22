# Sonde : affiche la structure d'un glTF importé (objets, os racines, actions, mouvement de racine).
# blender --background --python sonde_raptor_trice.py -- fichier.gltf
import sys
import bpy

fichier = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=fichier)

for o in bpy.data.objects:
    print("OBJ", o.name, o.type, "parent", o.parent.name if o.parent else None,
          "loc", tuple(round(v, 3) for v in o.location), "rot", tuple(round(v, 3) for v in o.rotation_euler),
          "scale", tuple(round(v, 3) for v in o.scale))
    if o.type == "MESH":
        print("   tris", sum(len(p.vertices) - 2 for p in o.data.polygons), "mats", [m.name for m in o.data.materials])
    if o.type == "ARMATURE":
        racines = [b for b in o.data.bones if b.parent is None]
        for b in racines:
            print("   ROOT BONE", b.name, "head", tuple(round(v, 3) for v in b.head_local), "enfants", [c.name for c in b.children])
            for c in b.children:
                print("      ", c.name, [cc.name for cc in c.children][:6])
        tete = [b for b in o.data.bones if "head" in b.name.lower()]
        for b in tete[:3]:
            print("   HEAD", b.name, tuple(round(v, 3) for v in (o.matrix_world @ b.head_local)))
        queue = [b for b in o.data.bones if "tail" in b.name.lower()]
        for b in queue[:2]:
            print("   TAIL", b.name, tuple(round(v, 3) for v in (o.matrix_world @ b.head_local)))
        if o.animation_data:
            print("   active", o.animation_data.action.name if o.animation_data.action else None,
                  "nla", [(t.name, [s.action.name for s in t.strips]) for t in o.animation_data.nla_tracks])

for a in bpy.data.actions:
    ligne = f"ACT {a.name} range {tuple(a.frame_range)}"
    # mouvement des os racines (location)
    try:
        courbes = list(a.fcurves)
    except AttributeError:
        courbes = []
        for layer in a.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    courbes += list(cb.fcurves)
    for fc in courbes:
        if fc.data_path.endswith("location"):
            vals = [k.co[1] for k in fc.keyframe_points]
            if vals and max(vals) - min(vals) > 0.05:
                ligne += f"\n    {fc.data_path}[{fc.array_index}] {min(vals):.2f}..{max(vals):.2f}"
    print(ligne)
