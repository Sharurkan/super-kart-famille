# Pilotes « au volant » : le volant 3D du kart est rendu dans Blender et inséré dans les dessins.
#
# Usage (depuis la racine du projet, cœurs 0-3, priorité basse) :
#   blender -b -t 4 --python outils/blender/volant_pilotes.py -- public/karts/kart.glb <kart_sortie.glb | -> assets/personnages
#
# 1) Le volant du « Cartoonish Go-Kart » (anneau, branches, moyeu et colonne) est détaché du
#    maillage du kart dans un nœud "volant" (origine au centre de l'anneau). Le jeu le cache quand
#    un pilote est assis : c'est le volant dessiné dans le sprite qui le remplace, toujours pile
#    dans les mains quel que soit l'angle de vue (le pilote est un panneau 2D face à la caméra).
# 2) Pour chaque personnage, l'anneau (lissé) est rendu en orthographique avec Eevee, vu de devant
#    (sprite de face) et de derrière (sprite de dos), placé et mis à l'échelle pour passer dans les
#    poings du dessin :
#    - de face : volant devant le corps, les poings redessinés PAR-DESSUS l'anneau (les doigts le
#      serrent), petite ombre portée de l'anneau sur la combinaison ;
#    - de dos : volant derrière le corps, visible seulement à côté du buste et des bras.
#    Sorties : <nom>_face_volant.png et <nom>_dos_volant.png (512 x 512, mêmes cadrages que
#    les sprites d'origine, dessins intacts en dehors du volant).
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
KART_IN, KART_OUT, DOSSIER = argv[0], argv[1], argv[2]
TAILLE = 512

# Poings dessinés (pixels, origine en haut à gauche) et rayon approximatif d'un poing.
# dos = None : le dessin de dos montre déjà un volant (harry).
POINGS = {
    "viggo": {"face": [(178, 376), (408, 362)], "dos": [(104, 336), (410, 334)]},
    "harry": {"face": [(116, 328), (302, 384)], "dos": None},
    "maman": {"face": [(196, 352), (378, 338)], "dos": [(94, 336), (440, 326)]},
    "bryan": {"face": [(164, 376), (352, 376)], "dos": [(92, 316), (420, 312)]},
    "mamy": {"face": [(88, 358), (424, 358)], "dos": [(92, 344), (418, 338)]},
}
RAYON_POING = {"viggo": 34, "harry": 36, "maman": 34, "bryan": 36, "mamy": 36}
ANGLE_POINGS = math.radians(62)  # poings vers « 10 h 10 » : angle depuis le haut du volant
# mamy tient ses poings très écartés : mains vers « 9 h 15 », sinon le volant serait immense
ANGLE_PERSO = {"mamy": math.radians(80)}


# ---------------------------------------------------------------------------
DOSSIER = os.path.abspath(DOSSIER)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(KART_IN))


def detacher_volant():
    """Îlots de sommets du kart dans la zone devant le baquet -> objet "volant"."""
    kart = bpy.data.objects["kart"]
    bm = bmesh.new()
    bm.from_mesh(kart.data)
    bm.verts.ensure_lookup_table()
    vus, volant_v, anneau = set(), set(), []
    for v in bm.verts:
        if v.index in vus:
            continue
        pile, comp = [v], []
        vus.add(v.index)
        while pile:
            a = pile.pop()
            comp.append(a.index)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in vus:
                    vus.add(b.index)
                    pile.append(b)
        co = np.array([bm.verts[i].co[:] for i in comp])
        mn, mx = co.min(0), co.max(0)
        if not (-0.27 <= mn[0] and mx[0] <= 0.27 and 0.55 <= mn[2] and mx[2] <= 1.05 and mx[1] <= -0.15):
            continue
        if mn[1] >= -0.42:  # anneau, branches, moyeu
            volant_v.update(comp)
            anneau.append(co)
        elif mx[0] - mn[0] < 0.06 and mn[1] >= -0.82:  # colonne de direction (tige fine)
            volant_v.update(comp)
    bm.free()
    anneau = np.concatenate(anneau)
    centre = (anneau.min(0) + anneau.max(0)) / 2
    print("VOLANT sommets", len(volant_v), "centre", centre.round(3))

    bpy.ops.object.select_all(action="DESELECT")
    kart.select_set(True)
    bpy.context.view_layer.objects.active = kart
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for i in volant_v:
        kart.data.vertices[i].select = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="VERT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    volant = [o for o in bpy.context.selected_objects if o != kart][0]
    volant.name = volant.data.name = "volant"
    # origine au centre de l'anneau
    bpy.context.scene.cursor.location = Vector(centre)
    bpy.ops.object.select_all(action="DESELECT")
    volant.select_set(True)
    bpy.context.view_layer.objects.active = volant
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")


# --- 1) volant détaché (sauf si le GLB d'entrée l'a déjà) ---
if "volant" not in bpy.data.objects:
    detacher_volant()
    if KART_OUT != "-":
        bpy.ops.object.select_all(action="DESELECT")
        bpy.ops.export_scene.gltf(
            filepath=os.path.abspath(KART_OUT),
            export_format="GLB",
            export_image_format="AUTO",  # garde le JPEG d'origine
            export_jpeg_quality=88,
            export_tangents=False,
            export_yup=True,
            export_apply=True,
            export_materials="EXPORT",
        )
        print("KART EXPORTE", KART_OUT)
else:
    print("VOLANT déjà détaché dans", KART_IN)
# --- 2) volant pour les sprites ---
# Le volant du GLB est trop simplifié (71 sommets) pour être vu en gros plan : on modélise ici
# un volant de kart propre aux mêmes proportions (anneau, 3 branches en T, moyeu), lissé,
# dans le plan XY (normale +Z), rayon de l'anneau = 1 (axe du boudin).
for o in list(bpy.context.scene.objects):
    o.hide_render = True


def principled(nom, couleur, metal, rugo, vernis=0.0):
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*couleur, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rugo
    b.inputs["Coat Weight"].default_value = vernis
    return m


m_caout = principled("caoutchouc", (0.03, 0.03, 0.035), 0.0, 0.38, 0.35)
m_metal = principled("metal", (0.7, 0.72, 0.76), 0.9, 0.28)
m_bouton = principled("bouton", (0.75, 0.06, 0.05), 0.0, 0.3, 0.6)

EPAIS = 0.13  # rayon du boudin de l'anneau
pieces = []
bpy.context.scene.cursor.location = (0, 0, 0)
bpy.ops.mesh.primitive_torus_add(major_radius=1.0, minor_radius=EPAIS, major_segments=96, minor_segments=24, location=(0, 0, 0))
pieces.append(bpy.context.object)
pieces[-1].data.materials.append(m_caout)
for ang in (0, 180, 270):  # branches à 3 h, 9 h et 6 h
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.07, depth=0.8)
    b = bpy.context.object
    b.scale = (1.6, 0.6, 1.0)  # branche aplatie
    b.rotation_euler = (0, math.radians(90), math.radians(ang))
    a = math.radians(ang)
    b.location = (math.cos(a) * 0.55, math.sin(a) * 0.55, -0.02)
    b.data.materials.append(m_metal)
    bev = b.modifiers.new("biseau", "BEVEL")
    bev.width, bev.segments = 0.02, 3
    pieces.append(b)
bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.24, depth=0.16, location=(0, 0, 0))
moyeu = bpy.context.object
moyeu.data.materials.append(m_metal)
bev = moyeu.modifiers.new("biseau", "BEVEL")
bev.width, bev.segments = 0.04, 4
pieces.append(moyeu)
bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.15, location=(0, 0, 0.06))
bouton = bpy.context.object
bouton.scale = (1, 1, 0.45)
bouton.data.materials.append(m_bouton)
pieces.append(bouton)
for o in pieces:
    for p in o.data.polygons:
        p.use_smooth = True
    o.hide_render = False
roue = bpy.data.objects.new("roue_volant", None)
bpy.context.scene.collection.objects.link(roue)
for o in pieces:
    o.parent = roue

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x = sc.render.resolution_y = TAILLE
sc.render.film_transparent = True
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"
sc.view_settings.view_transform = "Standard"
sc.world = bpy.data.worlds.new("monde")
sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.62, 0.66, 0.75, 1)
sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.55

# caméra orthographique sur l'axe -Y qui regarde vers +Y (haut de l'image = +Z)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = "ORTHO"
cam.location = (0, -6, 0)
cam.rotation_euler = (math.radians(90), 0, 0)
cam.data.clip_end = 20
# lumière principale en haut à gauche, devant (comme sur les dessins), plus un contre-jour doux
soleil = bpy.data.objects.new("soleil", bpy.data.lights.new("soleil", "SUN"))
soleil.data.energy = 3.5
soleil.data.angle = math.radians(20)
soleil.rotation_euler = (math.radians(55), 0, math.radians(-35))
sc.collection.objects.link(soleil)
contre = bpy.data.objects.new("contre", bpy.data.lights.new("contre", "SUN"))
contre.data.energy = 1.2
contre.rotation_euler = (math.radians(-120), 0, math.radians(30))
sc.collection.objects.link(contre)

# Inclinaison apparente de l'anneau (angle entre sa normale et la caméra) : de face, le volant
# penché vers le pilote est vu en ellipse aplatie devant le ventre ; de dos encore plus à plat,
# seuls ses côtés dépassent du buste.
INCLINAISON = {"face": math.radians(56), "dos": math.radians(62)}


def centre_ellipse(p1, p2, a, b):
    """Centre de l'ellipse (demi-axes a, b en px) passant par les deux poings, sous les poings."""
    u1, u2 = np.array([p1[0] / a, p1[1] / b]), np.array([p2[0] / a, p2[1] / b])
    m, d = (u1 + u2) / 2, u2 - u1
    l = np.linalg.norm(d)
    h = math.sqrt(max(0.0, 1 - (l / 2) ** 2))
    n = np.array([-d[1], d[0]]) / l
    if n[1] < 0:
        n = -n  # centre plus bas que les poings (y image vers le bas)
    c = m + n * h
    return c[0] * a, c[1] * b


def rendre_anneau(nom, cote, p1, p2, chemin):
    alpha = INCLINAISON[cote]
    R = math.dist(p1, p2) / 2 / math.sin(ANGLE_PERSO.get(nom, ANGLE_POINGS))  # rayon de l'anneau en pixels
    # de dos, seul l'anneau dépasse du buste : branches et moyeu cachés (évite des barres grises)
    for o in pieces[1:]:
        o.hide_render = cote == "dos"
    cx, cy = centre_ellipse(p1, p2, R, R * math.cos(alpha))
    # braquage : si la ligne des poings penche, le volant tourne autour de son axe
    pente = math.atan2(p2[1] - p1[1], p2[0] - p1[0])
    # face : on voit le côté moyeu (+Z vers la caméra) ; haut du volant penché loin de la caméra
    roue.matrix_world = Matrix.Rotation(math.radians(90) - alpha, 4, "X") @ Matrix.Rotation(-pente, 4, "Z")
    cam.data.ortho_scale = TAILLE / R
    # décalage du cadre : le centre du volant (origine) doit tomber sur (cx, cy) dans l'image
    cam.data.shift_x = -(cx - TAILLE / 2) / TAILLE
    cam.data.shift_y = (cy - TAILLE / 2) / TAILLE
    sc.render.filepath = chemin
    bpy.ops.render.render(write_still=True)
    return cx, cy, R



# ---------------------------------------------------------------------------
# Composition en numpy (images 8 bits sRGB, alpha non prémultiplié)
def lire(chemin):
    img = bpy.data.images.load(chemin, check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()  # ligne 0 = haut
    bpy.data.images.remove(img)
    return px


def ecrire(px, chemin):
    h, w = px.shape[:2]
    img = bpy.data.images.new("sortie", w, h, alpha=True)
    img.pixels[:] = np.clip(px[::-1], 0, 1).ravel()
    img.filepath_raw = chemin
    img.file_format = "PNG"
    sc.render.image_settings.compression = 100
    img.save()
    bpy.data.images.remove(img)


def flou(m, r):
    """Flou boîte séparable (r pixels)."""
    if r <= 0:
        return m
    k = np.ones(2 * r + 1, dtype=np.float32) / (2 * r + 1)
    m = np.apply_along_axis(lambda x: np.convolve(x, k, mode="same"), 0, m)
    return np.apply_along_axis(lambda x: np.convolve(x, k, mode="same"), 1, m)


def decaler(m, dx, dy):
    out = np.zeros_like(m)
    h, w = m.shape
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = m[ys, xs]
    return out


def masque_poing(sprite, centre, rayon):
    """Poing ganté : croissance de région depuis le centre, sur les couleurs du cœur du poing."""
    h, w = sprite.shape[:2]
    cx, cy = centre
    yy, xx = np.mgrid[0:h, 0:w]
    dist = np.hypot(xx - cx, yy - cy)
    rgb = sprite[..., :3]
    coeur = rgb[(dist < rayon * 0.55) & (sprite[..., 3] > 0.5)]
    # palette du poing : quelques couleurs représentatives (k-moyennes rapides)
    k = 4
    graines = coeur[np.linspace(0, len(coeur) - 1, k).astype(int)]
    for _ in range(8):
        lab = np.argmin(((coeur[:, None] - graines[None]) ** 2).sum(-1), 1)
        for j in range(k):
            if (lab == j).any():
                graines[j] = coeur[lab == j].mean(0)
    dmin = np.sqrt(((rgb[..., None, :] - graines[None, None]) ** 2).sum(-1)).min(-1)
    proche = (dmin < 0.16) & (sprite[..., 3] > 0.5) & (dist < rayon * 1.45)
    # composante connexe qui contient le centre
    m = np.zeros((h, w), bool)
    pile = [(int(cy), int(cx))]
    while pile:
        y, x = pile.pop()
        if y < 0 or y >= h or x < 0 or x >= w or m[y, x] or not proche[y, x]:
            continue
        m[y, x] = True
        pile.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
    # fermeture (bouche les reflets) puis bords adoucis
    f = flou(m.astype(np.float32), 2) > 0.35
    f = flou(f.astype(np.float32), 2) > 0.6
    f |= dist < rayon * 0.55
    return np.clip(flou(f.astype(np.float32), 1), 0, 1)


def sur(haut, bas):
    """haut par-dessus bas (alpha non prémultiplié)."""
    a1, a2 = haut[..., 3:4], bas[..., 3:4]
    a = a1 + a2 * (1 - a1)
    rgb = (haut[..., :3] * a1 + bas[..., :3] * a2 * (1 - a1)) / np.maximum(a, 1e-6)
    return np.concatenate([rgb, a], -1)


tmp = os.path.join(bpy.app.tempdir, "anneau.png")
for nom, cotes in POINGS.items():
    for cote in ("face", "dos"):
        sprite = lire(os.path.join(DOSSIER, f"{nom}_{cote}.png"))
        sortie = os.path.join(DOSSIER, f"{nom}_{cote}_volant.png")
        poings = cotes[cote]
        if poings is None:
            ecrire(sprite, sortie)  # volant déjà dessiné
            print("COPIE", sortie)
            continue
        cx, cy, R = rendre_anneau(nom, cote, *poings, tmp)
        anneau = lire(tmp)
        if cote == "face":
            mains = np.zeros(sprite.shape[:2], np.float32)
            for p in poings:
                mains = np.maximum(mains, masque_poing(sprite, p, RAYON_POING[nom]))
            # l'anneau s'assombrit en entrant dans le poing (occlusion), puis disparaît sous les doigts
            ao = flou(mains, 5)
            anneau[..., :3] *= (1 - 0.45 * ao)[..., None]
            anneau[..., 3] *= 1 - mains
            # ombre douce de l'anneau sur la combinaison (lumière en haut à gauche)
            ombre = flou(decaler(anneau[..., 3], 4, 9), 5) * 0.38 * (1 - mains)
            corps = sprite.copy()
            corps[..., :3] *= (1 - ombre * (sprite[..., 3] > 0))[..., None]
            out = sur(anneau, corps)
        else:
            # de dos, le volant est devant le pilote donc derrière le dessin
            out = sur(sprite, anneau)
        ecrire(out, sortie)
        print("SPRITE", sortie, "centre", round(cx), round(cy), "R", round(R))
