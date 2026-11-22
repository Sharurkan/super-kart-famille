# Blender (sans fenêtre) : rassemble des modèles "réalistes" (scans Poly Haven, plantes Sketchfab)
# dans un seul GLB léger pour vegetation.js.
#  - chaque modèle devient un objet vide nommé (ex. "Rocher_Mousse_A") qui porte ses maillages
#  - maillages simplifiés (Decimate, les UV sont gardées : la normal map d'origine marche encore)
#  - textures réduites, cartes métal/rugosité retirées (le jeu n'utilise que couleur + relief)
#  - "alpha" : image de transparence (feuilles) copiée dans le canal alpha de la couleur
#  - images exportées en WebP (EXT_texture_webp, lu par le GLTFLoader de three.js)
#
# blender --background --python pack_realiste.py -- config.json
# config.json : { "sortie": "x.glb", "taille": 512, "qualite": 80, "modeles": [
#   { "fichier": "rock.gltf", "objets": { "nom_du_maillage": ["Rocher_A", 400] }, "alpha": "a.png", "relief": true } ] }
import sys, os, json
import bpy, bmesh

ARGS = sys.argv[sys.argv.index("--") + 1:]
cfg = json.load(open(ARGS[0], encoding="utf8"))
TAILLE = cfg.get("taille", 512)
# chemins : "TELECHARGEMENTS" = 2e argument ; les chemins relatifs partent du dossier du fichier de configuration
BASE = os.path.dirname(os.path.abspath(ARGS[0]))
def chemin(p):
    if len(ARGS) > 1:
        p = p.replace("TELECHARGEMENTS", ARGS[1])
    return p if os.path.isabs(p) else os.path.normpath(os.path.join(BASE, p))
cfg["sortie"] = chemin(cfg["sortie"])
for m in cfg["modeles"]:
    m["fichier"] = chemin(m["fichier"])
    if m.get("alpha"):
        m["alpha"] = chemin(m["alpha"])

bpy.ops.wm.read_factory_settings(use_empty=True)


def triangles(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def simplifier(o, plafond):
    t = triangles(o)
    if t <= plafond:
        return t
    mod = o.modifiers.new("simplifier", "DECIMATE")
    mod.ratio = plafond / t
    mod.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return triangles(o)


def materiaux(o):
    return [s.material for s in o.material_slots if s.material]


racines = []
for m in cfg["modeles"]:
    avant = set(bpy.data.objects)
    # sommets fusionnés : sinon chaque îlot d'UV est séparé et la simplification ouvre des trous
    bpy.ops.import_scene.gltf(filepath=m["fichier"], merge_vertices=True)
    nouveaux = [o for o in bpy.data.objects if o not in avant]
    maillages = [o for o in nouveaux if o.type == "MESH"]
    gardes = []
    # source : nom du maillage glTF ("*" = tous les maillages du fichier) ; valeur [nom, plafond]
    # ou liste de [nom, plafond] pour tirer plusieurs modèles (ex. un rocher et un caillou) du même maillage
    demandes = []
    for source, v in m["objets"].items():
        for nom, plafond in (v if isinstance(v[0], list) else [v]):
            demandes.append((source, nom, plafond))
    pris = set()
    for source, nom, plafond in demandes:
        choisis = maillages if source == "*" else [o for o in maillages if source in (o.data.name, o.name)]
        if not choisis:
            print("INTROUVABLE", source, [o.data.name for o in maillages])
            continue
        if any(o in pris for o in choisis):
            # déjà utilisé : on travaille sur une copie (déjà simplifiée : mettre le plus gros plafond en premier)
            copies = []
            for o in choisis:
                c = o.copy()
                c.data = o.data.copy()
                c.parent = None
                bpy.context.scene.collection.objects.link(c)
                c.matrix_world = o.matrix_world.copy()  # les racines sont à l'origine : monde inchangé
                copies.append(c)
            choisis = copies
        pris.update(choisis)
        racine = bpy.data.objects.new(nom, None)
        bpy.context.scene.collection.objects.link(racine)
        total = sum(triangles(o) for o in choisis)
        for o in choisis:
            mw = o.matrix_world.copy()
            o.parent = racine
            o.matrix_world = mw
            # chaque pièce reçoit sa part du plafond
            apres = simplifier(o, max(12, int(plafond * triangles(o) / total)))
        print("modele", nom, "triangles", total, "->", sum(triangles(o) for o in choisis))
        gardes += choisis
        racines.append(racine)
    # le reste du fichier (autres rochers du lot, objets vides) est supprimé
    for o in nouveaux:
        if o.type == "MESH" and o not in gardes:
            bpy.data.objects.remove(o, do_unlink=True)

    # matériaux : couleur (+ alpha des feuilles) et relief seulement
    for mat in {mt for o in gardes for mt in materiaux(o)}:
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        for entree in ("Metallic", "Roughness", "Specular IOR Level", "Specular Tint"):
            for l in list(bsdf.inputs[entree].links if entree in bsdf.inputs else []):
                nt.links.remove(l)
        bsdf.inputs["Metallic"].default_value = 0.0
        bsdf.inputs["Roughness"].default_value = 0.9
        if not m.get("relief", True):
            for l in list(bsdf.inputs["Normal"].links):
                nt.links.remove(l)
        if m.get("alpha"):
            lien = bsdf.inputs["Base Color"].links
            tex = lien[0].from_node if lien else None
            while tex is not None and tex.type != "TEX_IMAGE" and tex.inputs and tex.inputs[0].links:
                tex = tex.inputs[0].links[0].from_node
            if tex is not None and tex.type == "TEX_IMAGE":
                coul = tex.image
                alpha = bpy.data.images.load(m["alpha"])
                import numpy as np
                w, h = coul.size
                if tuple(alpha.size) != (w, h):
                    alpha.scale(w, h)
                pc = np.empty(w * h * 4, dtype=np.float32); coul.pixels.foreach_get(pc)
                pa = np.empty(w * h * 4, dtype=np.float32); alpha.pixels.foreach_get(pa)
                pc[3::4] = pa[0::4]
                neuf = bpy.data.images.new(coul.name + "_alpha", w, h, alpha=True)
                neuf.colorspace_settings.name = coul.colorspace_settings.name
                neuf.pixels.foreach_set(pc)
                neuf.pack()
                tex.image = neuf
                nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
                bpy.data.images.remove(alpha)
        # feuilles : coupure nette (alphaMode MASK) plutôt que transparence
        if bsdf.inputs["Alpha"].links:
            src = bsdf.inputs["Alpha"].links[0].from_socket
            if not (src.node.type == "MATH" and src.node.operation == "ROUND"):
                rond = nt.nodes.new("ShaderNodeMath")
                rond.operation = "ROUND"
                nt.links.new(src, rond.inputs[0])
                nt.links.new(rond.outputs[0], bsdf.inputs["Alpha"])

# nettoyage : objets vides orphelins, images inutilisées
encore = True
while encore:
    encore = False
    for o in list(bpy.data.objects):
        if o.type == "EMPTY" and o not in racines and not o.children:
            bpy.data.objects.remove(o, do_unlink=True)
            encore = True
bpy.ops.outliner.orphans_purge(do_recursive=True)
for img in bpy.data.images:
    if img.size[0] > TAILLE:
        img.scale(TAILLE, max(1, int(img.size[1] * TAILLE / img.size[0])))
        img.pack()

from mathutils import Vector
for racine in racines:
    coins = [o.matrix_world @ Vector(c) for o in racine.children_recursive if o.type == "MESH" for c in o.bound_box]
    if coins:
        d = Vector((max(c[i] for c in coins) - min(c[i] for c in coins) for i in range(3)))
        print("dimensions", racine.name, "largeur %.2f profondeur %.2f hauteur %.2f" % (d.x, d.y, d.z))
print("images", [(i.name, tuple(i.size)) for i in bpy.data.images if i.users])

bpy.ops.export_scene.gltf(filepath=cfg["sortie"], export_format="GLB", export_image_format="WEBP",
                          export_image_quality=cfg.get("qualite", 80), export_materials="EXPORT",
                          export_apply=True, export_texcoords=True, export_normals=True,
                          export_tangents=False, export_attributes=False, export_vertex_color="NONE")
print("exporté", cfg["sortie"])
