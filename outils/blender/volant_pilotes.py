# Pilotes au volant : un seul vrai volant 3D pour tous les karts, et les dessins des pilotes
# retouchés pour que leurs poings tombent pile sur son anneau.
#
# Usage (depuis la racine du projet, cœurs 0-3, priorité basse) :
#   blender -b -t 4 --python outils/blender/volant_pilotes.py -- assets/personnages public/karts/volant.glb [kart_entree.glb kart_sortie.glb]
#
# 1) public/karts/volant.glb : volant de kart lissé (anneau, 3 branches, moyeu, bouton rouge) et
#    sa colonne de direction, aux dimensions du jeu (anneau de 0,55 m, même taille que le volant
#    d'origine du « Cartoonish Go-Kart »). karts.js le pose devant le baquet, penché, la colonne
#    descend jusque sous le capot ; le nœud "volant" tourne quand on braque.
# 2) Pour chaque personnage (dessins d'origine <nom>_face.png / <nom>_dos.png) :
#    - recadrage mesuré, identique pour tous : axe du casque (mesuré sur l'alpha) sur x = 256,
#      haut du casque à 8 px, casque de même largeur (215 px) ;
#    - chaque poing (avec l'avant-bras) est déplacé jusqu'à l'anneau : (168, 372) et (344, 372),
#      soit ±0,275 m sur le panneau de 1,6 m. Seul le bras bouge (calque glissé, avant-bras
#      étiré en douceur jusqu'au coude) : visages et combinaisons restent intacts ;
#    Sorties (WebP) :
#    - <nom>_face_assis.webp / <nom>_dos_assis.webp : le pilote dans le kart 3D ;
#    - <nom>_mains.webp : les poings seuls, affichés devant le volant 3D en vue de face ;
#    - <nom>_face_volant.webp : portrait des menus avec ce même volant rendu (Eevee) et le début
#      de la colonne, poings par-dessus l'anneau.
# 3) Optionnel : détache le volant d'origine du kart GLB dans un nœud "volant" (caché en jeu).
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
DOSSIER = os.path.abspath(argv[0])
VOLANT_GLB = os.path.abspath(argv[1])
KART_IN = os.path.abspath(argv[2]) if len(argv) > 3 else None
KART_OUT = os.path.abspath(argv[3]) if len(argv) > 3 else None

TAILLE = 512  # pixels du dessin = 1,6 m dans le jeu
PX = 1.6 / TAILLE
R_ANNEAU = 0.275  # rayon de l'anneau (axe du boudin), mètres
EPAIS = 0.032  # rayon du boudin
INCLINAISON = math.radians(32)  # haut du volant penché vers l'avant du kart
LONG_COLONNE = 0.75
CENTRE = (256, 372)  # milieu des poings sur le dessin final
CIBLES = ((CENTRE[0] - R_ANNEAU / PX, CENTRE[1]), (CENTRE[0] + R_ANNEAU / PX, CENTRE[1]))

# Poings sur les dessins d'origine (pixels, origine en haut à gauche) et rayon d'un poing.
POINGS = {
    "viggo": {"face": [(178, 376), (408, 362)], "dos": [(104, 336), (410, 334)]},
    "harry": {"face": [(116, 328), (302, 384)], "dos": [(148, 328), (366, 322)]},
    "maman": {"face": [(196, 352), (378, 338)], "dos": [(94, 336), (440, 326)]},
    "bryan": {"face": [(164, 376), (352, 376)], "dos": [(92, 316), (420, 312)]},
    "mamy": {"face": [(88, 358), (424, 358)], "dos": [(92, 344), (418, 338)]},
}
RAYON_POING = {"viggo": 34, "harry": 36, "maman": 34, "bryan": 36, "mamy": 36}

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


# ---------------------------------------------------------------------------
# 3) (optionnel) volant d'origine du kart détaché
def detacher_volant_kart():
    bpy.ops.import_scene.gltf(filepath=KART_IN)
    if "volant" in bpy.data.objects:
        print("VOLANT déjà détaché dans", KART_IN)
    else:
        kart = bpy.data.objects["kart"]
        bm = bmesh.new()
        bm.from_mesh(kart.data)
        bm.verts.ensure_lookup_table()
        vus, sel, anneau = set(), set(), []
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
                sel.update(comp)
                anneau.append(co)
            elif mx[0] - mn[0] < 0.06 and mn[1] >= -0.82:  # colonne (tige fine)
                sel.update(comp)
        bm.free()
        anneau = np.concatenate(anneau)
        centre = (anneau.min(0) + anneau.max(0)) / 2
        bpy.context.view_layer.objects.active = kart
        kart.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.object.mode_set(mode="OBJECT")
        for i in sel:
            kart.data.vertices[i].select = True
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.separate(type="SELECTED")
        bpy.ops.object.mode_set(mode="OBJECT")
        v = [o for o in bpy.context.selected_objects if o != kart][0]
        v.name = v.data.name = "volant"
        sc.cursor.location = Vector(centre)
        bpy.ops.object.select_all(action="DESELECT")
        v.select_set(True)
        bpy.context.view_layer.objects.active = v
        bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
        bpy.ops.object.select_all(action="DESELECT")
        bpy.ops.export_scene.gltf(filepath=KART_OUT, export_format="GLB", export_image_format="AUTO",
                                  export_tangents=False, export_yup=True, export_apply=True)
        print("KART EXPORTE", KART_OUT)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)


if KART_IN:
    detacher_volant_kart()


# ---------------------------------------------------------------------------
# 1) le volant 3D
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
m_colonne = principled("colonne", (0.12, 0.12, 0.13), 0.6, 0.4)

# Modélisé à plat dans XY (haut = +Y), axe +Z = vers l'avant du kart (côté colonne),
# bouton côté pilote (-Z) ; puis tourné de 90° autour de X pour l'export (+Y Blender = arrière).
sc.cursor.location = (0, 0, 0)
pieces = []


def ajouter(o, mat, lisse=True):
    o.data.materials.append(mat)
    if lisse:
        for p in o.data.polygons:
            p.use_smooth = True
    pieces.append(o)
    return o


bpy.ops.mesh.primitive_torus_add(major_radius=R_ANNEAU, minor_radius=EPAIS, major_segments=56,
                                 minor_segments=12, location=(0, 0, 0))
ajouter(bpy.context.object, m_caout)
for ang in (0, 180, 270):  # branches à 3 h, 9 h et 6 h
    a = math.radians(ang)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.016, depth=0.2,
                                        location=(math.cos(a) * 0.155, math.sin(a) * 0.155, 0.004),
                                        rotation=(0, math.radians(90), a))
    b = bpy.context.object
    b.scale = (0.55, 1.6, 1.0)  # branche aplatie dans l'épaisseur du volant
    ajouter(b, m_metal)
bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.06, depth=0.045, location=(0, 0, 0))
moyeu = ajouter(bpy.context.object, m_metal)
mod = moyeu.modifiers.new("biseau", "BEVEL")
mod.width, mod.segments = 0.01, 2
bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, radius=0.042, location=(0, 0, -0.024))
bouton = ajouter(bpy.context.object, m_bouton)
bouton.scale = (1, 1, 0.45)

bpy.ops.object.select_all(action="DESELECT")
for o in pieces:
    o.select_set(True)
bpy.context.view_layer.objects.active = pieces[0]
bpy.ops.object.convert(target="MESH")  # applique le biseau
bpy.ops.object.join()
volant = bpy.context.object
volant.name = volant.data.name = "volant"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
volant.data.transform(Matrix.Rotation(math.radians(90), 4, "X"))

# colonne : du moyeu vers l'avant (-Y Blender = +Z jeu), jusque sous le capot
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.02, depth=LONG_COLONNE,
                                    location=(0, -LONG_COLONNE / 2 - 0.02, 0), rotation=(math.radians(90), 0, 0))
colonne = bpy.context.object
colonne.name = colonne.data.name = "colonne"
colonne.data.materials.append(m_colonne)
for p in colonne.data.polygons:
    p.use_smooth = True
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bpy.ops.object.select_all(action="DESELECT")
volant.select_set(True)
colonne.select_set(True)
bpy.ops.export_scene.gltf(filepath=VOLANT_GLB, export_format="GLB", use_selection=True,
                          export_tangents=False, export_yup=True, export_apply=True)
print("VOLANT EXPORTE", VOLANT_GLB, sum(len(p.vertices) - 2 for o in (volant, colonne) for p in o.data.polygons), "triangles")

# ---------------------------------------------------------------------------
# rendu du volant pour les portraits (même géométrie, même inclinaison qu'en jeu)
support = bpy.data.objects.new("support", None)
sc.collection.objects.link(support)
volant.parent = support
colonne.parent = support
support.rotation_euler = (INCLINAISON, 0, 0)  # haut du volant vers l'avant (-Y Blender)

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
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
sc.collection.objects.link(cam)
sc.camera = cam
cam.data.type = "ORTHO"
cam.data.ortho_scale = TAILLE * PX  # 512 px = 1,6 m, comme le dessin
cam.data.clip_end = 30
ELEV = math.radians(12)  # caméra des menus : devant le kart, un peu au-dessus
cam.location = (0, -8 * math.cos(ELEV), 8 * math.sin(ELEV))
cam.rotation_euler = (math.radians(90) - ELEV, 0, 0)
cam.data.shift_y = (CENTRE[1] - TAILLE / 2) / TAILLE  # centre du volant sur le milieu des poings
soleil = bpy.data.objects.new("soleil", bpy.data.lights.new("soleil", "SUN"))
soleil.data.energy = 3.5
soleil.data.angle = math.radians(20)
soleil.rotation_euler = (math.radians(55), 0, math.radians(-35))
sc.collection.objects.link(soleil)
contre = bpy.data.objects.new("contre", bpy.data.lights.new("contre", "SUN"))
contre.data.energy = 1.2
contre.rotation_euler = (math.radians(-120), 0, math.radians(30))
sc.collection.objects.link(contre)
tmp = os.path.join(bpy.app.tempdir, "volant.png")
sc.render.filepath = tmp
bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------------------
# images (numpy, 8 bits sRGB, alpha non prémultiplié, ligne 0 = haut)
def lire(chemin):
    img = bpy.data.images.load(chemin, check_existing=False)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1].copy()
    bpy.data.images.remove(img)
    return px


def ecrire(px, chemin, qualite=90):
    h, w = px.shape[:2]
    img = bpy.data.images.new("sortie", w, h, alpha=True)
    img.pixels[:] = np.clip(px[::-1], 0, 1).ravel()
    img.file_format = "WEBP"
    img.save(filepath=chemin, quality=qualite)
    bpy.data.images.remove(img)
    print("ECRIT", os.path.basename(chemin), os.path.getsize(chemin) // 1024, "Ko")


def flou(m, r):
    if r <= 0:
        return m
    k = np.ones(2 * r + 1, dtype=np.float32) / (2 * r + 1)
    m = np.apply_along_axis(lambda x: np.convolve(x, k, mode="same"), 0, m)
    return np.apply_along_axis(lambda x: np.convolve(x, k, mode="same"), 1, m)


def premult(img):
    p = img.copy()
    p[..., :3] *= p[..., 3:4]
    return p


def depremult(p):
    out = p.copy()
    out[..., :3] /= np.maximum(p[..., 3:4], 1e-6)
    return out


def echantillonner(p, sx, sy):
    """Lecture bilinéaire d'une image prémultipliée ; hors image = transparent."""
    h, w = p.shape[:2]
    x0, y0 = np.floor(sx).astype(int), np.floor(sy).astype(int)
    fx, fy = (sx - x0)[..., None], (sy - y0)[..., None]

    def lu(x, y):
        ok = ((x >= 0) & (x < w) & (y >= 0) & (y < h))[..., None]
        return p[np.clip(y, 0, h - 1), np.clip(x, 0, w - 1)] * ok

    return (lu(x0, y0) * (1 - fx) * (1 - fy) + lu(x0 + 1, y0) * fx * (1 - fy)
            + lu(x0, y0 + 1) * (1 - fx) * fy + lu(x0 + 1, y0 + 1) * fx * fy)


YY, XX = np.mgrid[0:TAILLE, 0:TAILLE].astype(np.float32)


def decaler(img, dx, dy):
    return depremult(echantillonner(premult(img), XX - dx, YY - dy))


def rampe(y, a, b):
    t = np.clip((y - a) / (b - a), 0, 1)
    return 0.5 - 0.5 * np.cos(np.pi * t)


def deplacer_poing(img, P, T, R):
    """Amène le poing P en T sans trou ni coupure dans le dessin.
    - Vers l'extérieur : simple déformation douce (la manche s'étire, le buste à côté du poing
      suit un peu), rien n'est découpé.
    - Vers l'intérieur : le bras glisse comme un calque par-dessus le buste ; du côté extérieur, le
      déplacement s'estompe jusqu'au bord de la manche (elle se resserre), sans bord coupé.
    Verticalement, le déplacement s'estompe au-dessus du poing et jusqu'au coude."""
    s = -1 if P[0] < TAILLE / 2 else 1  # côté gauche / droit du dessin
    dx, dy = T[0] - P[0], T[1] - P[1]
    h0, h1 = P[1] - R * 1.1 - 70, P[1] - R * 1.1  # rampe au-dessus du poing (le poing bouge d'un bloc)
    b0, b1 = P[1] + R, P[1] + R + 90  # rampe jusqu'au coude
    t = rampe(YY, h0, h1) * (1 - rampe(YY, b0, b1))
    # distance (vers l'extérieur du dessin) à la position d'ARRIVÉE du poing : la déformation est
    # lue depuis l'image finale (pour chaque pixel final, on va chercher son pixel d'origine)
    o = (XX - T[0]) * s
    exterieur = 1 - rampe(o, R, R + abs(dx) + 60)
    vers_dehors = dx * s
    pm = premult(img)
    if vers_dehors > 0:
        interieur = rampe(o, -R - max(40, 2.5 * vers_dehors), -R)
        k = t * exterieur * interieur
        return depremult(echantillonner(pm, XX - dx * k, YY - dy * k))
    # côté extérieur : la manche suit le poing puis le déplacement s'estompe en douceur (bord du
    # bras décalé sans coupure ni étirement baveux, jamais replié sur lui-même)
    exterieur = 1 - rampe(o, R, R + abs(dx) + 120)
    k = t * exterieur
    sx, sy = XX - dx * k, YY - dy * k
    # limite entre bras (qui glisse) et buste (qui reste) : bord intérieur du poing à sa hauteur,
    # puis elle s'écarte en biais au-dessus et au-dessous (épaule, coude et hanche restent en place,
    # pas de bord vertical tranché dans le buste)
    def xb(y):
        return P[0] - s * (R + 8) + s * 2 * np.maximum(0, np.abs(y - P[1]) - R)

    def zone(x, y):
        cote = np.clip((x - xb(y)) * s / 10 + 0.5, 0, 1)
        return cote * ((y > h0) & (y < b1))

    L = echantillonner(pm, sx, sy) * zone(sx, sy)[..., None]
    W = zone(XX, YY)
    a = img[..., 3]
    aB = a * (1 - W) / np.maximum(1 - a * W, 1e-6)  # l'original là où rien ne bouge
    B = np.concatenate([img[..., :3] * aB[..., None], aB[..., None]], -1)
    return depremult(L + B * (1 - L[..., 3:4]))


def masque_poing(sprite, centre, rayon):
    """Poing ganté : croissance de région depuis le centre, sur les couleurs du cœur du poing."""
    cx, cy = centre
    dist = np.hypot(XX - cx, YY - cy)
    rgb = sprite[..., :3]
    coeur = rgb[(dist < rayon * 0.55) & (sprite[..., 3] > 0.5)]
    k = 4
    graines = coeur[np.linspace(0, len(coeur) - 1, k).astype(int)].copy()
    for _ in range(8):
        lab = np.argmin(((coeur[:, None] - graines[None]) ** 2).sum(-1), 1)
        for j in range(k):
            if (lab == j).any():
                graines[j] = coeur[lab == j].mean(0)
    dmin = np.sqrt(((rgb[..., None, :] - graines[None, None]) ** 2).sum(-1)).min(-1)
    proche = (dmin < 0.16) & (sprite[..., 3] > 0.5) & (dist < rayon * 1.45)
    m = np.zeros(proche.shape, bool)
    pile = [(int(cy), int(cx))]
    while pile:
        y, x = pile.pop()
        if y < 0 or y >= TAILLE or x < 0 or x >= TAILLE or m[y, x] or not proche[y, x]:
            continue
        m[y, x] = True
        pile.extend(((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)))
    f = flou(m.astype(np.float32), 2) > 0.35
    f = flou(f.astype(np.float32), 2) > 0.6
    f |= dist < rayon * 0.55
    return np.clip(flou(f.astype(np.float32), 1), 0, 1)


def sur(haut, bas):
    a1, a2 = haut[..., 3:4], bas[..., 3:4]
    a = a1 + a2 * (1 - a1)
    rgb = (haut[..., :3] * a1 + bas[..., :3] * a2 * (1 - a1)) / np.maximum(a, 1e-6)
    return np.concatenate([rgb, a], -1)


# Recadrage mesuré (le même pour tous les dessins) : le casque sert de repère, car il ne dépend ni
# de la pose des bras (harry tend un bras) ni des cheveux (boucles de maman, plus bas).
LARGEUR_CASQUE = 199  # px, mesurée 50 px sous le haut du casque
# Échelle bornée : bryan a un petit casque pour un grand buste ; l'agrandir davantage mettrait
# ses poings trop bas sous le volant.
ECHELLE_MIN, ECHELLE_MAX = 0.95, 1.08
# Poses tournées : maman a le buste de trois quarts, ses poings sont loin à droite de sa tête.
# Son axe est pris entre la tête et les mains (milieu du buste) ; les autres : axe du casque.
POIDS_MAINS = {}
HAUT_CASQUE = 8  # px
# De dos, les mains sont naturellement cachées devant le buste : on rapproche seulement un peu
# les poings levés sur les côtés (au plus 35 px, moins pour maman dont les boucles tombent sur
# les bras), sans les faire passer sur le dos.
MAX_DOS = {"viggo": 35, "harry": 25, "maman": 14, "bryan": 35, "mamy": 35}


def mesurer_casque(img):
    """(axe x, haut y, largeur) du casque : dôme = lignes 10 à 70 px sous le haut du dessin."""
    a = img[..., 3] > 0.5
    haut = int(np.where(a.any(1))[0][0])
    milieux = []
    for dy in range(10, 71, 4):
        xs = np.where(a[haut + dy])[0]
        milieux.append((xs[0] + xs[-1]) / 2)
    xs = np.where(a[haut + 50])[0]
    return float(np.mean(milieux)), haut, float(xs[-1] - xs[0])


def normaliser(img, echelle, axe, haut):
    """Mise à l'échelle autour du haut du casque, axe du casque sur x = 256, haut à HAUT_CASQUE."""
    sx = axe + (XX - TAILLE / 2) / echelle
    sy = haut + (YY - HAUT_CASQUE) / echelle
    return depremult(echantillonner(premult(img), sx, sy))


def preparer(nom, cote, echelle=None):
    """Recadre le dessin puis amène chaque poing sur l'anneau (de face) ou vers lui (de dos)."""
    img = lire(os.path.join(DOSSIER, f"{nom}_{cote}.png"))
    axe, haut, largeur = mesurer_casque(img)
    if echelle is None:
        echelle = min(ECHELLE_MAX, max(ECHELLE_MIN, LARGEUR_CASQUE / largeur))
    if cote == "face":
        milieu_mains = sum(p[0] for p in POINGS[nom]["face"]) / 2
        axe += POIDS_MAINS.get(nom, 0) * (milieu_mains - axe)
    else:
        axe += POIDS_MAINS.get(nom, 0) * (sum(p[0] for p in POINGS[nom]["dos"]) / 2 - axe)
    img = normaliser(img, echelle, axe, haut)
    vers = lambda p: (TAILLE / 2 + (p[0] - axe) * echelle, HAUT_CASQUE + (p[1] - haut) * echelle)
    poings = sorted(vers(p) for p in POINGS[nom][cote])
    for P, cible in zip(poings, CIBLES):
        if cote == "dos":
            dx = max(-MAX_DOS[nom], min(MAX_DOS[nom], cible[0] - P[0]))
            cible = (P[0] + dx, P[1])  # de dos : même hauteur, rapprochement limité
        if math.dist(P, cible) <= 3:
            continue
        img = deplacer_poing(img, P, cible, RAYON_POING[nom] * echelle)
        if os.environ.get("DEBUG_POINGS"):
            ecrire(img, os.path.join(DOSSIER, f"debug_{nom}_{cote}_{round(P[0])}.webp"))
    print("PREPARE", nom, cote, "axe", round(axe, 1), "largeur", round(largeur), "echelle", round(echelle, 3),
          "poings", [tuple(round(v) for v in p) for p in poings])
    return img, echelle


anneau = lire(tmp)
for nom in POINGS:
    face, echelle = preparer(nom, "face")
    # de dos : même échelle et même haut de casque (la tête ne saute pas quand il se retourne)
    dos, _ = preparer(nom, "dos", echelle)
    ecrire(face, os.path.join(DOSSIER, f"{nom}_face_assis.webp"))
    ecrire(dos, os.path.join(DOSSIER, f"{nom}_dos_assis.webp"))

    mains = np.zeros((TAILLE, TAILLE), np.float32)
    for c in CIBLES:
        mains = np.maximum(mains, masque_poing(face, c, RAYON_POING[nom]))
    calque = face.copy()
    calque[..., 3] *= mains
    ecrire(calque, os.path.join(DOSSIER, f"{nom}_mains.webp"))

    # portrait des menus : volant par-dessus le corps, poings par-dessus le volant
    v = anneau.copy()
    ao = flou(mains, 5)  # l'anneau fonce en entrant dans la main
    v[..., :3] *= (1 - 0.45 * ao)[..., None]
    v[..., 3] *= 1 - mains
    ombre = flou(decaler(v, 4, 9)[..., 3], 5) * 0.35 * (1 - mains)  # ombre douce sur la combinaison
    corps = face.copy()
    corps[..., :3] *= (1 - ombre * (face[..., 3] > 0))[..., None]
    portrait = sur(v, corps)
    # bas du portrait fondu (sous le volant : hanches et bras retouchés, inutiles sur une carte)
    portrait[..., 3] *= 1 - rampe(YY, 452, 505)
    ecrire(portrait, os.path.join(DOSSIER, f"{nom}_face_volant.webp"))
