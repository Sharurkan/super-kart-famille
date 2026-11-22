# Prépare le ptéranodon (Sketchfab "Pteranodon (Animated)", oscar.lopez.riviello, CC-BY 4.0)
# pour le jeu : maillage allégé, une seule texture 1024 px, deux animations de vol.
#   blender --background --python ptero-preparer.py -- scene.gltf sortie.glb [ratio]
# Animations exportées (pistes NLA) découpées dans "flying" (24 i/s) :
#   "battement" : un battement d'ailes complet (images 52 → 88), à boucler ;
#   "plane"     : vol plané avec de petits mouvements (images 176 → 256).
import bpy, sys
args = sys.argv[sys.argv.index("--") + 1:]
src, dst = args[0], args[1]
ratio = float(args[2]) if len(args) > 2 else 0.33

bpy.ops.wm.read_factory_settings(use_empty=True)
avant = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=src)
for o in list(avant):
    bpy.data.objects.remove(o, do_unlink=True)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
me = next(o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm)

# --- maillage : on enlève les UV en trop puis on décime (les groupes de sommets suivent) ---
while len(me.data.uv_layers) > 1:
    me.data.uv_layers.remove(me.data.uv_layers[-1])
avantTris = sum(len(p.vertices) - 2 for p in me.data.polygons)
bpy.context.view_layer.objects.active = me
for o in bpy.context.selected_objects:
    o.select_set(False)
me.select_set(True)
mod = me.modifiers.new("allege", "DECIMATE")
mod.ratio = ratio
mod.use_collapse_triangulate = True
while me.modifiers[0] != mod:
    bpy.ops.object.modifier_move_up(modifier=mod.name)
bpy.ops.object.modifier_apply(modifier=mod.name)
print("TRIS", avantTris, "->", sum(len(p.vertices) - 2 for p in me.data.polygons))

# --- matériau : seulement la couleur (texture réduite à 1024 px) ---
ancien = me.data.materials[0]
image = None
for n in ancien.node_tree.nodes:
    if n.type == "TEX_IMAGE" and n.image and "diffuse" in n.image.name.lower():
        image = n.image
if image is None:
    image = next(i for i in bpy.data.images if "diffuse" in i.name.lower())
image.scale(1024, 1024)
mat = bpy.data.materials.new("ptero")
mat.use_nodes = True
mat.use_backface_culling = False
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = image
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.85
bsdf.inputs["Metallic"].default_value = 0.0
me.data.materials.clear()
me.data.materials.append(mat)

# --- animations : deux pistes NLA découpées dans "flying" ---
vol = bpy.data.actions["flying"]
for a in list(bpy.data.actions):
    if a != vol:
        bpy.data.actions.remove(a)
ad = arm.animation_data or arm.animation_data_create()
ad.action = None
for p in list(ad.nla_tracks):
    ad.nla_tracks.remove(p)
for nom, debut, fin in [("battement", 52, 88), ("plane", 176, 256)]:
    piste = ad.nla_tracks.new()
    piste.name = nom
    st = piste.strips.new(nom, 0, vol)
    st.action_frame_start = debut
    st.action_frame_end = fin
    st.frame_start = 0
    st.frame_end = fin - debut
    st.name = nom
    try:
        st.action_slot = vol.slots[0]
    except Exception as e:
        print("slot", e)
    piste.mute = False

for o in bpy.context.selected_objects:
    o.select_set(False)
arm.select_set(True)
me.select_set(True)
opts = dict(
    filepath=dst, export_format="GLB", use_selection=True,
    export_texcoords=True, export_normals=True, export_tangents=False,
    export_image_format="JPEG", export_jpeg_quality=82,
    export_skins=True, export_animations=True, export_animation_mode="NLA_TRACKS",
    export_frame_step=2, export_optimize_animation_size=True,
    export_morph=False, export_cameras=False, export_lights=False,
)
try:
    bpy.ops.export_scene.gltf(**opts)
except TypeError as e:
    print("option refusée", e)
    raise
print("OK", dst)
