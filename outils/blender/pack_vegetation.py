# Blender (sans fenêtre) : rassemble plusieurs modèles glTF de végétation dans un seul GLB léger.
# - textures réduites (512 px par défaut), cartes de relief (normal maps) retirées
# - chaque modèle devient un objet nommé comme son fichier (ex. "Fern_1")
#
# blender --background --python pack_vegetation.py -- dossier_gltf sortie.glb Modele1,Modele2:300,... [taille_texture] [max_tri]
# "Modele:300" fixe un plafond de triangles pour ce modèle seul (sinon max_tri, 1600 par défaut)
import sys, os
import bpy

args = sys.argv[sys.argv.index("--") + 1:]
DOSSIER, SORTIE = args[0], args[1]
NOMS, PLAFONDS = [], {}
for morceau in args[2].split(","):
    nom, _, plafond = morceau.partition(":")
    NOMS.append(nom)
    if plafond:
        PLAFONDS[nom] = int(plafond)
TAILLE = int(args[3]) if len(args) > 3 else 512

bpy.ops.wm.read_factory_settings(use_empty=True)
racines = []
for nom in NOMS:
    avant = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(DOSSIER, nom + ".gltf"))
    nouveaux = [o for o in bpy.data.objects if o not in avant]
    # un objet vide parent qui porte le nom du modèle
    racine = bpy.data.objects.new(nom, None)
    bpy.context.scene.collection.objects.link(racine)
    for o in nouveaux:
        if o.parent is None:
            o.parent = racine
    racines.append(racine)
    tri = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in nouveaux if o.type == "MESH")
    print("modele", nom, "triangles", tri)

# objets lourds (arbres) : simplifiés jusqu'à ~MAX_TRI triangles par modèle
MAX_TRI = int(args[4]) if len(args) > 4 else 1600
for racine in racines:
    maillages = [o for o in racine.children_recursive if o.type == "MESH"]
    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in maillages)
    plafond = PLAFONDS.get(racine.name.split(".")[0], MAX_TRI)  # Blender a pu ajouter ".001"
    if total > plafond:
        ratio = plafond / total
        for o in maillages:
            mod = o.modifiers.new("simplifier", "DECIMATE")
            mod.ratio = ratio
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=mod.name)
        apres = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in maillages)
        print("simplifié", racine.name, total, "->", apres)

# matériaux : plus de normal map, textures réduites
for mat in bpy.data.materials:
    if not mat.node_tree:
        continue
    for n in list(mat.node_tree.nodes):
        if n.type == "NORMAL_MAP":
            mat.node_tree.nodes.remove(n)
for img in bpy.data.images:
    if img.size[0] > TAILLE:
        img.scale(TAILLE, max(1, int(img.size[1] * TAILLE / img.size[0])))
        img.pack()
# on retire les images de relief devenues inutiles
for img in list(bpy.data.images):
    if "normal" in img.name.lower() and img.users <= 1:
        bpy.data.images.remove(img)

# dimensions (utile pour régler les hauteurs dans vegetation.js)
from mathutils import Vector
for racine in racines:
    coins = [o.matrix_world @ Vector(c) for o in racine.children_recursive if o.type == "MESH" for c in o.bound_box]
    if coins:
        mini = Vector((min(c[i] for c in coins) for i in range(3)))
        maxi = Vector((max(c[i] for c in coins) for i in range(3)))
        d = maxi - mini
        print("dimensions", racine.name, "largeur %.2f profondeur %.2f hauteur %.2f" % (d.x, d.y, d.z))

bpy.ops.export_scene.gltf(filepath=SORTIE, export_format="GLB", export_image_format="AUTO", export_materials="EXPORT", export_apply=True)
print("exporté", SORTIE)
