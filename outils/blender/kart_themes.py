# Carrosseries à thème des karts -> public/karts/themes.glb
#
# Usage :
#   blender --background --python outils/blender/kart_themes.py -- <sortie.glb> [dossier_apercus]
#
# Le châssis commun (roues, siège, volant) est public/karts/kart.glb ; ce script construit, pour
# chaque type de kart, les pièces qui le rendent reconnaissable (fusée, pompiers, licorne, dino,
# baignoire, classique). Un nœud racine "theme_<type>" par kart, à l'origine du kart.
#
# Toutes les cotes sont données dans le repère du jeu (three.js) : x = côté, y = haut, z = avant,
# en mètres, kart de 3 m de long posé au sol. Repères utiles du châssis :
#   siège (creux) (0, 0.48, -0.25) ; dossier z = -0.6, haut y = 0.96 ; volant z ~ 0.3, haut y ~ 1.04 ;
#   capot z 0.6..1.4, haut y ~ 0.9 ; pots d'échappement (±0.47, ~1.05, -1.55) dirigés vers l'arrière-haut.
# ⚠️ Toit ouvert : rien au-dessus du siège (le pilote est un dessin 2D posé dedans).
#
# Matériaux (le jeu les remplace par du plastique brillant de la même couleur) :
#   "peinture_*" -> couleur du kart (COULEURS_KARTS) ; "flamme*" -> flamme sans éclairage ;
#   "gyro_*" -> gyrophares qui clignotent ; "phare" -> sans éclairage.
# Objets animés en jeu (nom) : "anim_flamme*" (s'étire le long de son axe Y local),
#   "anim_queue*" (balance autour de l'axe vertical), "anim_bulle*" (flotte de haut en bas).
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
APERCUS = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = scene.collection

# ---------------------------------------------------------------- matériaux
MATS = {}


def lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def M(nom, hexa):
    if nom in MATS:
        return MATS[nom]
    r, g, b = (lin(int(hexa[i:i + 2], 16) / 255) for i in (0, 2, 4))
    m = bpy.data.materials.new(nom)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (r, g, b, 1)
    bsdf.inputs["Roughness"].default_value = 0.45
    m.diffuse_color = (r, g, b, 1)
    MATS[nom] = m
    return m


BLANC, NOIR, ROUGE, JAUNE = M("blanc", "f8f9fa"), M("noir", "2b2b2b"), M("rouge", "e8322f"), M("jaune", "ffd43b")
GRIS, OR, ORANGE, VERRE = M("gris", "adb5bd"), M("or", "ffc933"), M("orange", "ff922b"), M("verre", "8fd3ff")
ARC = [M("arc_rouge", "ff6b6b"), M("arc_orange", "ffa94d"), M("arc_jaune", "ffd43b"),
       M("arc_vert", "69db7c"), M("arc_bleu", "74c0fc"), M("arc_violet", "b197fc")]

# ---------------------------------------------------------------- construction
# Chaque thème est construit sous un parent temporaire tourné de 90° : ses enfants sont
# donc exprimés directement dans le repère du jeu (y haut, z avant).
THEMES = {}
cur = None
tmp = None


def theme(nom):
    global cur, tmp
    cur = nom
    tmp = bpy.data.objects.new("tmp_" + nom, None)
    col.objects.link(tmp)
    tmp.rotation_euler = (math.radians(90), 0, 0)
    THEMES[nom] = {"tmp": tmp, "objs": []}


def objet(bm, nom, mats, pos=(0, 0, 0), rot=(0, 0, 0), ech=(1, 1, 1), anim=None, biseau=0, segs=2, lisse=40):
    me = bpy.data.meshes.new(nom)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(nom, me)
    col.objects.link(o)
    for m in mats if isinstance(mats, (list, tuple)) else [mats]:
        me.materials.append(m)
    o.parent = tmp
    o.location = pos
    o.rotation_mode = "ZYX"  # même convention que three.js (ordre XYZ)
    o.rotation_euler = rot
    o.scale = ech
    if biseau:
        b = o.modifiers.new("biseau", "BEVEL")
        b.width = biseau
        b.segments = segs
        b.limit_method = "ANGLE"
    o["anim"] = anim or ""
    o["lisse"] = lisse
    THEMES[cur]["objs"].append(o)
    return o


def cone(r_bas, r_haut, h, seg, mat, pos, rot=(0, 0, 0), ech=(1, 1, 1), base=False, **k):
    """Cône/cylindre le long de l'axe local Z (= avant du jeu ; rot=(-pi/2,0,0) pour vers le haut).
    base=True : l'origine est à la base au lieu du centre."""
    bm = bmesh.new()
    mat_ = Matrix.Translation((0, 0, h / 2)) if base else Matrix()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r_bas, radius2=r_haut, depth=h, matrix=mat_)
    return objet(bm, "cone", mat, pos, rot, ech, **k)


def boule(r, mat, pos, ech=(1, 1, 1), rot=(0, 0, 0), u=10, v=6, **k):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
    return objet(bm, "boule", mat, pos, rot, ech, **k)


def boite3(l, h, p, mat, pos, rot=(0, 0, 0), biseau=0.0, segs=2, **k):
    """Boîte de largeur l (x), hauteur h (y du jeu), profondeur p (z du jeu)."""
    bm = bmesh.new()
    # local Z de l'objet = avant du jeu, local Y = haut du jeu
    bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Diagonal((l, h, p, 1)))
    return objet(bm, "boite", mat, pos, rot, biseau=biseau, segs=segs, **k)


def tour(profil, seg, mats, pos, rot=(0, 0, 0), ech=(1, 1, 1), **k):
    """Solide de révolution autour de l'axe local Z. profil = [(rayon, z, indice_matériau)], l'indice
    vaut pour la bande qui va de ce point au suivant. Un rayon 0 ferme la forme sur l'axe."""
    bm = bmesh.new()
    anneaux = []
    for r, z, _ in profil:
        if r < 1e-5:
            anneaux.append([bm.verts.new((0, 0, z))])
        else:
            anneaux.append([bm.verts.new((r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)])
    for n in range(len(anneaux) - 1):
        a, b, im = anneaux[n], anneaux[n + 1], profil[n][2]
        for i in range(seg):
            j = (i + 1) % seg
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                f = bm.faces.new((a[0], b[j], b[i]))
            elif len(b) == 1:
                f = bm.faces.new((a[i], a[j], b[0]))
            else:
                f = bm.faces.new((a[i], a[j], b[j], b[i]))
            f.material_index = im
    return objet(bm, "tour", mats, pos, rot, ech, **k)


def anneaux(liste, mats, pos=(0, 0, 0), fermer_bas=None, **k):
    """Surface passant par des anneaux de points (même nombre de points), dans le repère du jeu.
    liste = [(points, indice_matériau)] ; fermer_bas = point central pour boucher le premier anneau."""
    bm = bmesh.new()
    vs = [[bm.verts.new(p) for p in pts] for pts, _ in liste]
    n = len(vs[0])
    if fermer_bas is not None:
        c = bm.verts.new(fermer_bas)
        for i in range(n):
            bm.faces.new((c, vs[0][(i + 1) % n], vs[0][i])).material_index = liste[0][1]
    for a in range(len(vs) - 1):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((vs[a][i], vs[a][j], vs[a + 1][j], vs[a + 1][i])).material_index = liste[a][1]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return objet(bm, "anneaux", mats, pos, **k)


def plaque(points, ep, mat, pos, rot=(0, 0, 0), biseau=0.0, **k):
    """Plaque découpée : points (z, y) dans le plan du kart vu de côté, épaisseur ep selon x."""
    bm = bmesh.new()
    vs = [bm.verts.new((-ep / 2, y, z)) for z, y in points]
    f = bm.faces.new(vs)
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    nv = [e for e in r["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=nv, vec=(ep, 0, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return objet(bm, "plaque", mat, pos, rot, biseau=biseau, segs=1, **k)


def texte(txt, taille, ep, mat, pos, rot=(0, 0, 0)):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = txt
    cu.size = taille
    cu.extrude = ep
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.resolution_u = 3
    ob = bpy.data.objects.new("txt", cu)
    col.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    # texte dans le plan local XY, épaisseur selon Z : face avant vers +Z
    return objet(bm, "texte", mat, pos, rot, lisse=10)


def superellipse(hx, hz, y, zc=0.0, n=4, pts=28, monte=None):
    res = []
    for i in range(pts):
        a = 2 * math.pi * i / pts
        c, s = math.cos(a), math.sin(a)
        x = hx * math.copysign(abs(c) ** (2 / n), c)
        z = zc + hz * math.copysign(abs(s) ** (2 / n), s)
        res.append((x, y + (monte(z) if monte else 0), z))
    return res


PI = math.pi

# ================================================================= FUSÉE
theme("fusee")
P = M("peinture_fusee", "5b8def")
# fuselage blanc sur le capot, bague bleue, nez rouge (ogive)
tour([(0, 0.40, 2), (0.30, 0.40, 2), (0.43, 0.50, 0), (0.43, 0.92, 2), (0.437, 1.0, 0), (0.43, 1.22, 1),
      (0.40, 1.40, 1), (0.33, 1.56, 1), (0.21, 1.70, 1), (0.08, 1.79, 1), (0, 1.82, 1)],
     18, [BLANC, ROUGE, P], (0, 0.74, 0))
# hublots sur les côtés (cadre gris + vitre)
for s in (1, -1):
    cone(0.135, 0.135, 0.05, 14, GRIS, (s * 0.415, 0.82, 0.76), (0, s * PI / 2, 0))
    cone(0.10, 0.10, 0.05, 14, VERRE, (s * 0.44, 0.82, 0.76), (0, s * PI / 2, 0))
    # petits ailerons rouges à l'arrière du fuselage
    plaque([(0.40, 0), (0.78, 0), (0.55, -0.26), (0.38, -0.26)], 0.05, ROUGE, (s * 0.38, 0.62, 0), (0, 0, s * 0.9), biseau=0.012)
# grands ailerons à l'arrière, inclinés vers l'extérieur
for s in (1, -1):
    plaque([(-1.05, 0.44), (-1.45, 0.95), (-1.82, 1.22), (-1.78, 0.42)], 0.07, ROUGE, (s * 0.80, 0, 0), (0, 0, -s * 0.32), biseau=0.02)
# tuyères autour des pots d'échappement (axe vers l'arrière et un peu vers le haut)
AXE = PI + 0.45
DIR = Vector((0, math.sin(0.45), -math.cos(0.45)))
for s in (1, -1):
    c = Vector((s * 0.47, 1.0, -1.52))
    tour([(0, -0.16, 3), (0.13, -0.16, 1), (0.13, -0.08, 0), (0.15, 0.0, 0), (0.21, 0.12, 0), (0.25, 0.22, 0),
          (0.255, 0.25, 3), (0.20, 0.25, 3), (0, 0.18, 3)],
         16, [GRIS, ROUGE, BLANC, NOIR], tuple(c), (AXE, 0, 0))
    sortie = c + DIR * 0.2
    cone(0.20, 0.0, 0.75, 12, M("flamme", "ffa94d"), tuple(sortie), (AXE, 0, 0), base=True, anim="flamme", lisse=60)
    cone(0.11, 0.0, 0.45, 10, M("flamme_coeur", "fff3bf"), tuple(sortie + DIR * 0.02), (AXE, 0, 0), base=True, anim="flamme", lisse=60)

# ================================================================= POMPIERS
theme("pompier")
P = M("peinture_pompier", "d62828")
# caisse arrière du camion (haute), bandes jaune et blanche
boite3(1.24, 0.69, 0.84, P, (0, 0.795, -1.14), biseau=0.08)
boite3(1.27, 0.09, 0.87, JAUNE, (0, 0.82, -1.14), biseau=0.02, segs=1)
boite3(1.27, 0.04, 0.87, BLANC, (0, 0.67, -1.14), biseau=0.01, segs=1)
# grande échelle blanche posée sur la caisse, relevée vers l'arrière
A_ECH = 0.175
D_ECH = Vector((0, math.sin(A_ECH), -math.cos(A_ECH)))  # de l'avant vers l'arrière
O_ECH = Vector((0, 1.22, -0.72))
for s in (1, -1):
    c = O_ECH + D_ECH * 0.67
    boite3(0.065, 0.065, 1.34, BLANC, (s * 0.27, c.y, c.z), (A_ECH, 0, 0), biseau=0.015, segs=1)
for kk in range(7):
    c = O_ECH + D_ECH * (0.1 + kk * 0.19)
    cone(0.024, 0.024, 0.54, 6, BLANC, (0, c.y, c.z), (0, PI / 2, 0))
for s in (1, -1):
    boite3(0.08, 0.1, 0.1, GRIS, (s * 0.27, 1.17, -0.85), segs=1)
    boite3(0.08, 0.14, 0.1, GRIS, (s * 0.27, 1.19, -1.45), segs=1)
# enrouleur de tuyau sur le côté droit
cone(0.22, 0.22, 0.05, 18, GRIS, (0.65, 0.79, -1.14), (0, PI / 2, 0))
cone(0.19, 0.19, 0.14, 18, M("tuyau", "f1e3c6"), (0.72, 0.79, -1.14), (0, PI / 2, 0))
cone(0.22, 0.22, 0.04, 18, GRIS, (0.80, 0.79, -1.14), (0, PI / 2, 0))
cone(0.07, 0.07, 0.06, 10, JAUNE, (0.83, 0.79, -1.14), (0, PI / 2, 0))
# gyrophares : grande rampe sur le capot + deux sur la caisse
GB, GR = M("gyro_bleu", "339af0"), M("gyro_rouge", "ff3b3b")
boite3(0.80, 0.08, 0.2, NOIR, (0, 0.95, 0.80), biseau=0.02, segs=1)
boule(0.13, GB, (-0.22, 1.02, 0.80), ech=(1, 0.8, 1), u=12, v=6)
boule(0.13, GR, (0.22, 1.02, 0.80), ech=(1, 0.8, 1), u=12, v=6)
boule(0.11, GR, (-0.47, 1.2, -1.45), u=10, v=6)
boule(0.11, GB, (0.47, 1.2, -1.45), u=10, v=6)
# phares
for s in (1, -1):
    boule(0.075, M("phare", "fff3bf"), (s * 0.36, 0.64, 1.27), ech=(1, 1, 0.6), u=10, v=6)
# cloche dorée sur le côté gauche du capot
tour([(0, 0.0, 0), (0.05, 0.0, 0), (0.075, -0.05, 0), (0.11, -0.13, 0), (0.0, -0.13, 0)], 12, [OR], (-0.52, 0.83, 0.95), (-PI / 2, 0, 0))

# ================================================================= LICORNE
theme("licorne")
P = M("peinture_licorne", "f783ac")
BL = M("licorne_blanc", "fff5fa")
ROSE = M("rose_clair", "ffc2d9")
# cou + tête blanche en figure de proue
cone(0.17, 0.13, 0.46, 12, BL, (0, 0.92, 1.18), (-0.75, 0, 0))
boule(1, BL, (0, 1.13, 1.40), ech=(0.20, 0.19, 0.25), rot=(0.25, 0, 0), u=14, v=8)
boule(1, ROSE, (0, 1.04, 1.61), ech=(0.155, 0.13, 0.15), u=12, v=7)
for s in (1, -1):
    boule(0.025, M("rose_fonce", "e64980"), (s * 0.06, 1.07, 1.745), u=6, v=4)
    boule(0.046, NOIR, (s * 0.145, 1.18, 1.50), u=8, v=6)
    boule(0.016, BLANC, (s * 0.165, 1.20, 1.535), u=6, v=4)
    boule(0.035, ROSE, (s * 0.165, 1.08, 1.56), ech=(0.5, 1, 1), u=6, v=4)
    cone(0.055, 0.0, 0.16, 6, BL, (s * 0.1, 1.29, 1.31), (-PI / 2 + 0.2, s * 0.35, 0), base=True)

# corne dorée torsadée
def corne(pos):
    bm = bmesh.new()
    seg, nr, h, r0 = 8, 8, 0.44, 0.065
    rings = []
    for k in range(nr + 1):
        t = k / nr
        r = r0 * (1 - t) + 0.004
        ring = []
        for i in range(seg):
            a = 2 * PI * i / seg + t * 3.5
            rr = r * (1.0 if i % 2 == 0 else 0.72)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), h * t)))
        rings.append(ring)
    for k in range(nr):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return objet(bm, "corne", OR, pos, (-1.0, 0, 0), lisse=70)


corne((0, 1.27, 1.48))
# crinière arc-en-ciel le long de la nuque
for kk, m in enumerate(ARC):
    t = kk / (len(ARC) - 1)
    boule(1, m, (0, 1.30 - t * 0.42, 1.30 - t * 0.30), ech=(0.075, 0.11, 0.10), rot=(0.6, 0, 0), u=8, v=5)
# queue arc-en-ciel (bouge en course)
for kk, m in enumerate(ARC):
    boule(1, m, (0, 1.19 - kk * 0.055, -1.63 - kk * 0.02), ech=(0.065, 0.05, 0.30), rot=(0.35 - kk * 0.1, 0, 0), u=8, v=5, anim="queue_part")
# ailes lavande derrière le siège
AILE = M("aile", "e5dbff")
for s in (1, -1):
    plaque([(0, 0), (-0.08, 0.22), (-0.25, 0.40), (-0.5, 0.46), (-0.45, 0.34), (-0.6, 0.30), (-0.5, 0.18), (-0.58, 0.10), (-0.4, 0.03), (-0.25, -0.06)],
           0.05, AILE, (s * 0.52, 0.74, -0.62), (0, -s * 0.25, -s * 0.75), biseau=0.015)

# ================================================================= DINO
theme("dino")
P = M("peinture_dino", "40c057")
FONCE = M("vert_fonce", "2b8a3e")
cone(0.21, 0.17, 0.42, 12, P, (0, 0.92, 1.12), (-0.55, 0, 0))
boite3(0.48, 0.38, 0.50, P, (0, 1.10, 1.33), biseau=0.12, segs=2)
boite3(0.42, 0.20, 0.42, P, (0, 1.07, 1.66), biseau=0.08, segs=2)
boite3(0.34, 0.08, 0.38, M("bouche", "ff8787"), (0, 0.95, 1.62))
boite3(0.38, 0.10, 0.44, FONCE, (0, 0.87, 1.58), (0.12, 0, 0), biseau=0.04, segs=2)
for s in (1, -1):
    for kk in range(4):
        cone(0.03, 0.0, 0.08, 5, BLANC, (s * 0.15, 0.97, 1.52 + kk * 0.1), (PI / 2, 0, 0), base=True)
    boule(0.095, BLANC, (s * 0.15, 1.30, 1.42), u=10, v=6)
    boule(0.052, NOIR, (s * 0.17, 1.32, 1.495), u=8, v=5)
    boule(0.018, BLANC, (s * 0.18, 1.345, 1.535), u=6, v=4)
    boule(0.025, FONCE, (s * 0.08, 1.15, 1.865), u=6, v=4)
    # petits bras
    cone(0.05, 0.04, 0.2, 6, P, (s * 0.24, 0.84, 1.18), (0.9, 0, 0))
    for d in (-1, 1):
        cone(0.02, 0.0, 0.06, 4, BLANC, (s * 0.24 + d * 0.025, 0.77, 1.27), (PI / 2 - 0.6, 0, 0), base=True)
# pics orange : tête, puis le long du dos
PIC = ORANGE
for z, y, h in ((1.24, 1.27, 0.14), (1.06, 1.12, 0.16)):
    cone(0.08, 0.0, h, 4, PIC, (0, y, z), (-PI / 2, 0, 0), ech=(0.5, 1, 1), base=True)
for kk, (z, h) in enumerate(((-0.82, 0.28), (-1.06, 0.34), (-1.30, 0.30))):
    cone(0.13, 0.0, h, 4, PIC, (0, 0.88, z), (-PI / 2, 0, 0), ech=(0.45, 1, 1), base=True)
# queue (bouge en course) : anneaux le long d'une courbe
def queue_dino(base):
    bm = bmesh.new()
    seg, n = 10, 9
    rings = []
    for k in range(n + 1):
        t = k / n
        cx, cy, cz = 0.12 * t * t, -0.30 * t + 0.10 * t * t, -1.1 * t
        r = 0.24 * (1 - t) ** 0.9 + 0.025
        rings.append([bm.verts.new((cx + r * math.cos(2 * PI * i / seg), cy + r * math.sin(2 * PI * i / seg) * 0.9, cz)) for i in range(seg)])
    for k in range(n):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return objet(bm, "queue", P, base, anim="queue_part", lisse=70)


queue_dino((0, 0.80, -1.3))
for t, h in ((0.25, 0.2), (0.5, 0.16), (0.72, 0.11)):
    cx, cy, cz = 0.12 * t * t, -0.30 * t + 0.10 * t * t, -1.1 * t
    r = 0.24 * (1 - t) ** 0.9 + 0.025
    cone(0.09, 0.0, h, 4, PIC, (cx, 0.80 + cy + r * 0.8, -1.3 + cz), (-PI / 2, 0, 0), ech=(0.45, 1, 1), base=True, anim="queue_part")

# ================================================================= BAIGNOIRE
theme("baignoire")
P = M("peinture_baignoire", "74c0fc")
EMAIL = M("email", "ffffff")


def monte(z):  # le dossier de la baignoire remonte à l'arrière
    t = max(0.0, min(1.0, (-z - 0.85) / 0.7))
    return 0.16 * t * t


ZC = -0.05
EAU = 0.76
anneaux([
    (superellipse(0.80, 1.30, 0.50, ZC), 0),
    (superellipse(0.91, 1.42, 0.62, ZC), 0),
    (superellipse(0.98, 1.52, 0.86, ZC, monte=monte), 0),
    (superellipse(1.01, 1.555, 0.94, ZC, monte=monte), 0),
    (superellipse(0.96, 1.505, 0.975, ZC, monte=monte), 0),
    (superellipse(0.91, 1.455, 0.88, ZC, monte=lambda z: monte(z) * 0.6), 0),
    (superellipse(0.89, 1.435, EAU, ZC), 0),
], [EMAIL], fermer_bas=(0, 0.5, ZC), lisse=60)
# eau bleue
bm = bmesh.new()
pts = superellipse(0.895, 1.44, EAU + 0.005, ZC)
vs = [bm.verts.new(p) for p in pts]
c = bm.verts.new((0, EAU + 0.005, ZC))
for i in range(len(vs)):
    bm.faces.new((c, vs[i], vs[(i + 1) % len(vs)]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
objet(bm, "eau", M("eau", "74c0fc"), lisse=0)
# mousse : gros paquets devant (cache le capot) et derrière le siège
MOUSSE = M("mousse", "ffffff")
for x, y, z, r in ((0.0, 0.86, 1.05, 0.22), (0.30, 0.82, 0.80, 0.18), (-0.32, 0.83, 0.85, 0.19),
                   (0.0, 0.84, 0.52, 0.16), (0.55, 0.80, 0.25, 0.14), (-0.55, 0.80, 0.15, 0.15), (0.5, 0.82, -0.85, 0.17),
                   (-0.45, 0.83, -1.0, 0.19), (0.0, 0.90, -1.15, 0.2)):
    boule(r, MOUSSE, (x, y, z), ech=(1, 0.75, 1), u=8, v=4)
# pieds griffus dorés
for sx in (1, -1):
    for z in (1.12, -1.25):
        cone(0.05, 0.08, 0.32, 6, OR, (sx * 0.62, 0.36, z), (-PI / 2, 0, 0))
        boule(1, OR, (sx * 0.64, 0.17, z + 0.03), ech=(0.08, 0.06, 0.11), u=8, v=5)
# robinet doré + poignées rouge / bleue
cone(0.04, 0.04, 0.34, 10, OR, (0, 1.10, 1.40), (-PI / 2, 0, 0))
cone(0.035, 0.035, 0.22, 10, OR, (0, 1.25, 1.31), (0, 0, 0))
cone(0.035, 0.045, 0.08, 10, OR, (0, 1.21, 1.2), (PI / 2, 0, 0))
boule(0.055, ROUGE, (0.15, 1.08, 1.43), u=8, v=5)
boule(0.055, M("bleu", "339af0"), (-0.15, 1.08, 1.43), u=8, v=5)
# canard en plastique sur le rebord
CANARD = M("canard", "ffd43b")
boule(1, CANARD, (0.66, 1.07, 1.12), ech=(0.12, 0.10, 0.15), u=10, v=6)
boule(0.085, CANARD, (0.66, 1.22, 1.19), u=10, v=6)
boule(1, ORANGE, (0.66, 1.205, 1.29), ech=(0.05, 0.022, 0.06), u=8, v=4)
for s in (1, -1):
    boule(0.016, NOIR, (0.66 + s * 0.055, 1.25, 1.255), u=6, v=4)
cone(0.05, 0.0, 0.08, 6, CANARD, (0.66, 1.12, 0.98), (PI + 0.6, 0, 0), base=True)
# bulles de savon qui flottent (sur les côtés, jamais devant le visage)
BULLE = M("bulle", "d0ebff")
for x, y, z, r in ((-1.0, 1.15, 0.35, 0.08), (1.0, 1.25, -0.6, 0.07), (-0.95, 1.3, -1.2, 0.06)):
    boule(r, BULLE, (x, y, z), u=7, v=4, anim="bulle")

# ================================================================= CLASSIQUE
theme("classique")
P = M("peinture_classique", "ffc72c")
# aileron arrière : lame peinte + deux bandes blanches + dérives noires + mâts
boite3(1.72, 0.06, 0.36, P, (0, 1.28, -1.62), biseau=0.025, segs=2)
for s in (1, -1):
    boite3(0.13, 0.012, 0.365, BLANC, (s * 0.11, 1.313, -1.62))
    boite3(0.05, 0.30, 0.46, NOIR, (s * 0.87, 1.21, -1.62), biseau=0.02, segs=1)
    boite3(0.05, 0.28, 0.08, NOIR, (s * 0.30, 1.12, -1.55), segs=1)
# plaque numéro sous l'aileron, vers l'arrière
cone(0.15, 0.15, 0.03, 18, BLANC, (0, 1.06, -1.6), (PI, 0, 0))
texte("1", 0.22, 0.012, NOIR, (0, 1.06, -1.62), (0, PI, 0))
# aileron avant noir, dérives peintes, bandes blanches
boite3(1.5, 0.05, 0.26, NOIR, (0, 0.22, 1.36), biseau=0.02, segs=1)
for s in (1, -1):
    boite3(0.05, 0.18, 0.32, P, (s * 0.76, 0.27, 1.36), biseau=0.02, segs=1)
    boite3(0.12, 0.012, 0.265, BLANC, (s * 0.11, 0.248, 1.36))
# numéro sur le capot et sur les flancs
cone(0.17, 0.17, 0.03, 18, BLANC, (0, 0.905, 0.95), (-PI / 2 + 0.15, 0, 0))
texte("1", 0.25, 0.012, NOIR, (0, 0.925, 0.95), (-PI / 2 + 0.15, 0, 0))
for s in (1, -1):
    cone(0.15, 0.15, 0.03, 18, BLANC, (s * 1.02, 0.42, -0.2), (0, s * PI / 2, 0))
    texte("1", 0.22, 0.012, NOIR, (s * 1.035, 0.42, -0.2), (0, s * PI / 2, 0))
# petit drapeau à damier sur un mât, à l'arrière gauche
cone(0.015, 0.015, 0.9, 6, GRIS, (-0.62, 1.35, -1.42), (-PI / 2, 0, 0))
bm = bmesh.new()
cases = []
for i in range(4):
    for j in range(3):
        z0, z1 = -i * 0.1, -(i + 1) * 0.1
        y0, y1 = 0.24 - j * 0.08, 0.24 - (j + 1) * 0.08
        xo = lambda z: 0.03 * math.sin(-z * 18)
        vs = [bm.verts.new((xo(z0), y0, z0)), bm.verts.new((xo(z1), y0, z1)), bm.verts.new((xo(z1), y1, z1)), bm.verts.new((xo(z0), y1, z0))]
        f = bm.faces.new(vs)
        f.material_index = (i + j) % 2
objet(bm, "drapeau", [BLANC, NOIR], (-0.62, 1.56, -1.44), lisse=0)

# ================================================================= finitions + export
dg = bpy.context.evaluated_depsgraph_get()
racines = []
for nom, th in THEMES.items():
    bpy.context.view_layer.update()
    racine = bpy.data.objects.new("theme_" + nom, None)
    col.objects.link(racine)
    racines.append(racine)
    statiques = []
    groupes_anim = {}
    for o in th["objs"]:
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        mw = o.matrix_world.copy()
        anim = o["anim"]
        lisse = o["lisse"]
        for p in me.polygons:
            p.use_smooth = lisse > 0
        if lisse > 0:
            me.set_sharp_from_angle(angle=math.radians(lisse))
        nouv = bpy.data.objects.new(o.name, me)
        col.objects.link(nouv)
        bpy.data.objects.remove(o)
        if anim == "flamme":
            nouv.matrix_world = mw  # garde son axe (local Z Blender = axe Y du jeu)
            nouv.name = "anim_flamme"
            nouv.parent = racine
            continue
        me.transform(mw)
        nouv.matrix_world = Matrix()
        if anim == "bulle":
            # chaque bulle à part, origine en son centre (elle flotte à son rythme)
            c = sum((v.co for v in me.vertices), Vector()) / len(me.vertices)
            me.transform(Matrix.Translation(-c))
            nouv.matrix_world = Matrix.Translation(c)
            nouv.name = "anim_bulle"
            nouv.parent = racine
        elif anim:
            groupes_anim.setdefault(anim, []).append(nouv)
        else:
            statiques.append(nouv)
    bpy.data.objects.remove(th["tmp"])

    def joindre(objs, nom_obj):
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        o = bpy.context.view_layer.objects.active
        o.name = nom_obj
        return o

    corps = joindre(statiques, "corps_" + nom)
    corps.parent = racine
    for anim, objs in groupes_anim.items():
        o = joindre(objs, "anim_queue_" + nom)
        # origine = pivot (début de la queue)
        piv = {"licorne": Vector((0, 1.05, -1.38)), "dino": Vector((0, 0.80, -1.3))}[nom]
        piv_bl = Vector((piv.x, -piv.z, piv.y))
        o.data.transform(Matrix.Translation(-piv_bl))
        o.matrix_world = Matrix.Translation(piv_bl)
        o.parent = racine

# bilan des triangles
for r in racines:
    t = 0
    for o in r.children_recursive:
        if o.type == "MESH":
            t += sum(len(p.vertices) - 2 for p in o.data.polygons)
    print("TRIS", r.name, t)

bpy.ops.object.select_all(action="DESELECT")
for r in racines:
    r.select_set(True)
    for o in r.children_recursive:
        o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                          export_texcoords=False, export_normals=True, export_materials="EXPORT", export_extras=False)
print("EXPORT", OUT)

# ---------------------------------------------------------------- aperçus (facultatif)
if APERCUS:
    os.makedirs(APERCUS, exist_ok=True)
    kart_glb = os.path.join(os.path.dirname(OUT), "kart.glb")
    bpy.ops.import_scene.gltf(filepath=kart_glb)
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 400, 300
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    col.objects.link(cam)
    scene.camera = cam
    cible = bpy.data.objects.new("cible", None)
    col.objects.link(cible)
    cible.location = (0, 0, 0.8)
    tr = cam.constraints.new("TRACK_TO")
    tr.target = cible
    vues = {"av": (3.5, -5.5, 2.6), "ar": (0.0, 7.2, 3.1), "cote": (6.0, 0.0, 1.5)}  # (Blender : -Y = avant)
    for r in racines:
        for r2 in racines:
            for o in [r2] + list(r2.children_recursive):
                o.hide_render = r2 is not r
        for v, p in vues.items():
            cam.location = p
            scene.render.filepath = os.path.join(APERCUS, f"{r.name}_{v}.png")
            bpy.ops.render.render(write_still=True)
    # planche : une ligne par kart, une colonne par vue
    import numpy as np
    W, H = scene.render.resolution_x, scene.render.resolution_y
    planche = np.ones((H * len(racines), W * len(vues), 4), dtype=np.float32)
    for i, r in enumerate(racines):
        for j, v in enumerate(vues):
            im = bpy.data.images.load(os.path.join(APERCUS, f"{r.name}_{v}.png"))
            px = np.array(im.pixels[:], dtype=np.float32).reshape(H, W, 4)
            y0 = (len(racines) - 1 - i) * H
            planche[y0:y0 + H, j * W:(j + 1) * W] = px
    out = bpy.data.images.new("planche", W * len(vues), H * len(racines), alpha=True)
    out.pixels = planche.ravel()
    out.filepath_raw = os.path.join(APERCUS, "planche.png")
    out.file_format = "PNG"
    out.save()
