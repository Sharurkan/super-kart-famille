# Blender (mode sans fenêtre) : projette l'image Gemini sur le modèle de tête de T-rex,
# garde les couleurs par zones là où l'image ne voit pas, cuit le tout dans une texture
# et exporte un GLB propre.
#
# blender --background --python texturer.py -- modele.glb image.png sortie.glb [elevation_deg] [taille_texture]
import sys, math
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index("--") + 1:]
MODELE, IMAGE, SORTIE = args[0], args[1], args[2]
ELEV = math.radians(float(args[3]) if len(args) > 3 else 12.0)
TAILLE = int(args[4]) if len(args) > 4 else 1024

# --- scène vide + import
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=MODELE)
obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = obj.data
nom_couleurs = me.color_attributes[0].name if me.color_attributes else None

# --- image : boîte englobante du sujet (fond clair uni)
img = bpy.data.images.load(IMAGE)
W, H = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)  # ligne 0 = bas de l'image
rgb = px[:, :, :3]
lum = rgb.mean(axis=2)
sat = rgb.max(axis=2) - rgb.min(axis=2)
bord = np.concatenate([lum[:6, :].ravel(), lum[-6:, :].ravel(), lum[:, :6].ravel(), lum[:, -6:].ravel()])
fond = float(np.median(bord))
print("fond", round(fond, 3))

def boite_sujet(ecart_lum, seuil_sat):
    """Masque du sujet + sa boîte (lignes r0..r1, colonnes c0..c1)."""
    s = (lum < fond - ecart_lum) | (sat > seuil_sat)
    # on enlève les pixels isolés : il faut au moins 3 % de pixels "sujet" sur la ligne / colonne
    li = np.where(s.mean(axis=1) > 0.03)[0]
    co = np.where(s.mean(axis=0) > 0.03)[0]
    if len(li) == 0 or len(co) == 0:
        return None
    return s, li.min(), li.max(), co.min(), co.max()

# plusieurs réglages possibles (fond uni, sol dégradé...) : on gardera celui dont les proportions
# collent le mieux à la silhouette du modèle (voir plus bas)
REGLAGES_SUJET = [(0.13, 0.13), (0.2, 0.08), (0.25, 0.06), (0.3, 0.1), (1.0, 0.06), (1.0, 0.09)]
sujet, r0, r1, c0, c1 = boite_sujet(*REGLAGES_SUJET[0])

# --- projection : vue de face (caméra du côté +Z de Blender = image d'entrée de Hunyuan),
#     légèrement en surplomb. Blender : Y avant/arrière, Z haut. Le GLB est importé avec Z haut.
# direction de vue (de la caméra vers l'objet)
vue = Vector((0.0, 1.0, 0.0))  # par défaut on suppose que l'image regarde vers +Y
# on choisit l'axe qui donne la silhouette la plus proche de l'image (rapport largeur/hauteur)
verts = np.array([v.co[:] for v in me.vertices])
ratio_img = (c1 - c0) / max(1, (r1 - r0))
candidats = {
    "-Y": (Vector((0, 1, 0)), lambda p: (p[:, 0], p[:, 2])),
    "+Y": (Vector((0, -1, 0)), lambda p: (-p[:, 0], p[:, 2])),
    "-X": (Vector((1, 0, 0)), lambda p: (-p[:, 1], p[:, 2])),
    "+X": (Vector((-1, 0, 0)), lambda p: (p[:, 1], p[:, 2])),
}
def tourner(p, axe_vue):
    # surplomb : on fait pivoter les points autour de l'axe horizontal perpendiculaire à la vue
    perp = axe_vue.cross(Vector((0, 0, 1))).normalized()
    R = np.array(Matrix.Rotation(-ELEV, 3, perp))
    return p @ R.T
meilleur = None
for nom, (axe, proj) in candidats.items():
    u, v = proj(tourner(verts, axe))
    r = (u.max() - u.min()) / max(1e-6, (v.max() - v.min()))
    print("axe", nom, "rapport", round(r, 3), "image", round(ratio_img, 3))
    if meilleur is None or abs(r - ratio_img) < meilleur[0]:
        meilleur = (abs(r - ratio_img), nom)
AXE = args[5] if len(args) > 5 else meilleur[1]
axe_vue, proj = candidats[AXE]
print("axe retenu", AXE)

P = tourner(verts, axe_vue)
U, V = proj(P)

# réglage de détection du sujet dont les proportions collent le mieux au modèle
ratio_modele = (U.max() - U.min()) / max(1e-6, (V.max() - V.min()))
choix = None
for reg in REGLAGES_SUJET:
    b = boite_sujet(*reg)
    if b is None:
        continue
    r = (b[4] - b[3]) / max(1, (b[2] - b[1]))
    if choix is None or abs(r - ratio_modele) < choix[0]:
        choix = (abs(r - ratio_modele), reg, b)
sujet, r0, r1, c0, c1 = choix[2]
print("détection", choix[1], "rapport modèle", round(ratio_modele, 3), "image", round((c1 - c0) / max(1, r1 - r0), 3))
masque = sujet.copy()
for _ in range(5):  # on rogne le bord de 5 pixels
    m = masque.copy()
    m[1:, :] &= masque[:-1, :]
    m[:-1, :] &= masque[1:, :]
    m[:, 1:] &= masque[:, :-1]
    m[:, :-1] &= masque[:, 1:]
    masque = m
# "blancheur" de l'image : clair et peu coloré = dents
blancheur = np.clip((lum - 0.62) / 0.2, 0, 1) * np.clip((0.2 - sat) / 0.12, 0, 1)
print("image", W, H, "sujet lignes", r0, r1, "colonnes", c0, c1)
umin, umax, vmin, vmax = U.min(), U.max(), V.min(), V.max()
def vers_uv(u, v):
    x = c0 + (u - umin) / (umax - umin) * (c1 - c0)
    y = r0 + (v - vmin) / (vmax - vmin) * (r1 - r0)
    return x / W, y / H

# --- visibilité depuis la caméra (face tournée vers la caméra et pas cachée)
bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
bm.faces.ensure_lookup_table()
arbre = BVHTree.FromBMesh(bm)
R = Matrix.Rotation(ELEV, 3, axe_vue.cross(Vector((0, 0, 1))).normalized())
vers_camera = (R @ (-axe_vue)).normalized()
vis = np.zeros(len(me.vertices), dtype=np.float32)
blanc = np.zeros(len(me.vertices), dtype=np.float32)
for i, v in enumerate(bm.verts):
    n = v.normal
    face = max(0.0, n.dot(vers_camera))
    if face <= 0.05:
        continue
    depart = v.co + n * 0.004 + vers_camera * 0.002
    touche = arbre.ray_cast(depart, vers_camera, 10.0)
    if touche[0] is not None:
        continue
    x, y = vers_uv(U[i], V[i])
    xi, yi = min(W - 1, max(0, int(x * W))), min(H - 1, max(0, int(y * H)))
    if not masque[yi, xi]:
        continue
    vis[i] = min(1.0, face * 2.5)
    blanc[i] = blancheur[yi, xi]

# --- UV de projection + attribut de visibilité
uv_proj = me.uv_layers.new(name="projection")
for poly in me.polygons:
    for li in poly.loop_indices:
        vi = me.loops[li].vertex_index
        uv_proj.data[li].uv = vers_uv(U[vi], V[vi])
attr_blanc = me.color_attributes.new(name="blanc", type="FLOAT_COLOR", domain="POINT")
for i in range(len(me.vertices)):
    attr_blanc.data[i].color = (blanc[i], blanc[i], blanc[i], 1.0)
attr_vis = me.color_attributes.new(name="visibilite", type="FLOAT_COLOR", domain="POINT")
for i in range(len(me.vertices)):
    attr_vis.data[i].color = (vis[i], vis[i], vis[i], 1.0)

# --- UV propres pour la texture finale
uv_final = me.uv_layers.new(name="final")
me.uv_layers.active = uv_final
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
bpy.ops.object.mode_set(mode="OBJECT")

# --- matériau de cuisson : image projetée (là où c'est visible) sinon couleurs par zones
cuite = bpy.data.images.new("texture_tete", TAILLE, TAILLE)
mat = bpy.data.materials.new("cuisson")
mat.use_nodes = True
nt = mat.node_tree
nt.nodes.clear()
sortie = nt.nodes.new("ShaderNodeOutputMaterial")
emis = nt.nodes.new("ShaderNodeEmission")
mix = nt.nodes.new("ShaderNodeMix")
mix.data_type = "RGBA"
uvn = nt.nodes.new("ShaderNodeUVMap"); uvn.uv_map = "projection"
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img; tex.extension = "EXTEND"
vis_n = nt.nodes.new("ShaderNodeAttribute"); vis_n.attribute_name = "visibilite"
zones = nt.nodes.new("ShaderNodeAttribute"); zones.attribute_name = nom_couleurs or "Color"
nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
nt.links.new(vis_n.outputs["Fac"], mix.inputs["Factor"])
nt.links.new(zones.outputs["Color"], mix.inputs["A"])
nt.links.new(tex.outputs["Color"], mix.inputs["B"])
mix2 = nt.nodes.new("ShaderNodeMix")
mix2.data_type = "RGBA"
blanc_n = nt.nodes.new("ShaderNodeAttribute"); blanc_n.attribute_name = "blanc"
mix2.inputs["B"].default_value = (0.92, 0.88, 0.78, 1.0)
nt.links.new(blanc_n.outputs["Fac"], mix2.inputs["Factor"])
nt.links.new(mix.outputs["Result"], mix2.inputs["A"])
nt.links.new(mix2.outputs["Result"], emis.inputs["Color"])
nt.links.new(emis.outputs["Emission"], sortie.inputs["Surface"])
cible = nt.nodes.new("ShaderNodeTexImage"); cible.image = cuite
uvf = nt.nodes.new("ShaderNodeUVMap"); uvf.uv_map = "final"
nt.links.new(uvf.outputs["UV"], cible.inputs["Vector"])
nt.nodes.active = cible
obj.data.materials.clear()
obj.data.materials.append(mat)

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = 1
sc.render.bake.margin = 4
me = obj.data
me.uv_layers.active = me.uv_layers["final"]
me.uv_layers["final"].active_render = True
for o in bpy.context.scene.objects:
    o.select_set(o == obj)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.bake(type="EMIT")
print("cuisson terminée")

# --- matériau final simple : la texture cuite
final = bpy.data.materials.new("tete")
final.use_nodes = True
nt2 = final.node_tree
bsdf = nt2.nodes.get("Principled BSDF")
t2 = nt2.nodes.new("ShaderNodeTexImage"); t2.image = cuite
u2 = nt2.nodes.new("ShaderNodeUVMap"); u2.uv_map = "final"
nt2.links.new(u2.outputs["UV"], t2.inputs["Vector"])
nt2.links.new(t2.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.9
obj.data.materials.clear()
obj.data.materials.append(final)
# ménage : on ne garde que les UV finales, plus de couleurs par sommet
for nom in [l.name for l in me.uv_layers if l.name != "final"]:
    me.uv_layers.remove(me.uv_layers[nom])
for nom in [a.name for a in me.color_attributes]:
    me.color_attributes.remove(me.color_attributes[nom])
cuite.file_format = "JPEG"
bpy.ops.export_scene.gltf(filepath=SORTIE, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=88, export_materials="EXPORT")
print("exporté", SORTIE, "visibles", int((vis > 0.2).sum()), "/", len(vis))
