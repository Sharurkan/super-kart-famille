# Gros plan de la tête du diplodocus couché (glb exporté) : face, 3/4 et profil.
# blender --background --python apercu_tete_sauropode.py -- diplodocus.glb dossier prefixe
import bpy, sys, os, mathutils
args = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args[0])
sc = bpy.context.scene
pts = [o.matrix_world @ v.co for o in bpy.data.objects if o.type == "MESH" for v in o.data.vertices]
xmin = min(p.x for p in pts)
tete = [p for p in pts if p.x < xmin + 2.0]
c = sum(tete, mathutils.Vector()) / len(tete)
print("TETE centre", [round(v, 2) for v in c], "z", round(min(p.z for p in tete), 2), round(max(p.z for p in tete), 2), "y", round(min(p.y for p in tete), 2), round(max(p.y for p in tete), 2))
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "TEXTURE"
sc.render.resolution_x, sc.render.resolution_y = 800, 600
cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 35
cam = bpy.data.objects.new("cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
for nom, d in {"face": (-1, 0, 0.12), "trois4": (-0.7, -0.6, 0.3), "profil": (0, -1, 0.1)}.items():
    d = mathutils.Vector(d).normalized()
    cam.location = c + d * 4.0
    cam.rotation_euler = (-d).to_track_quat("-Z", "Z").to_euler()
    sc.render.filepath = os.path.join(args[1], f"{args[2]}_{nom}.png")
    bpy.ops.render.render(write_still=True)
