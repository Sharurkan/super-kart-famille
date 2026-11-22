# Rendus d'aperçu (Workbench) d'un modèle glTF/glb : vue de côté, de 3/4, de dessus, de face.
# blender --background --python apercu_sauropode.py -- modele.(gltf|glb) dossier_sortie prefixe [frame|repos]
import bpy, sys, math, mathutils, os
args = sys.argv[sys.argv.index("--") + 1:]
src, out, prefixe = args[0], args[1], args[2]
mode = args[3] if len(args) > 3 else "frame1"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in list(bpy.data.objects):
    if o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o)
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
sc = bpy.context.scene
if arm and mode == "repos":
    arm.data.pose_position = "REST"
elif mode.startswith("f"):
    sc.frame_set(int(mode[1:]) if mode[1:].isdigit() else 1)
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
pts = []
for o in bpy.data.objects:
    if o.type == "MESH":
        e = o.evaluated_get(dg)
        m = e.to_mesh()
        pts += [o.matrix_world @ v.co for v in m.vertices]
        e.to_mesh_clear()
mn = mathutils.Vector([min(p[i] for p in pts) for i in range(3)])
mx = mathutils.Vector([max(p[i] for p in pts) for i in range(3)])
print("BBOX", [round(v, 2) for v in mn], [round(v, 2) for v in mx])
c = (mn + mx) / 2
r = (mx - mn).length / 2
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "TEXTURE"
sc.render.resolution_x, sc.render.resolution_y = 900, 600
cam_d = bpy.data.cameras.new("cam")
cam_d.type = "ORTHO"
cam_d.ortho_scale = r * 2.1
cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
vues = {"cote": (0, -1, 0), "trois4": (-0.7, -0.7, 0.45), "dessus": (0, 0, 1), "face": (-1, 0, 0.15)}
for nom, d in vues.items():
    d = mathutils.Vector(d).normalized()
    cam.location = c + d * r * 3
    cam.rotation_euler = (-d).to_track_quat("-Z", "Z" if nom != "dessus" else "Y").to_euler()
    sc.render.filepath = os.path.join(out, f"{prefixe}_{nom}.png")
    bpy.ops.render.render(write_still=True)
