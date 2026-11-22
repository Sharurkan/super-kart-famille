# Blender (mode sans fenêtre) : repeint le diplodocus couché pour qu'on le "lise" bien depuis
# le kart (dos foncé rayé, ventre clair, bouche, narines, joues), refait ses UV et ajoute un
# œil de dessin animé (objet séparé "oeil", couleurs par sommet) que le jeu pose deux fois.
#
# blender --background --python repeindre_diplodocus.py -- entree.glb sortie.glb [taille_texture]
#
# entree.glb : le modèle nettoyé (sortie de nettoyer_diplodocus.py), couché le long de X
# (tête vers -X), Z en haut dans Blender, posé sur z = 0.
#
# Le jeu étire ensuite le modèle de façon non uniforme (beaucoup plus large au cou et à la
# queue, voir diplodocus() dans src/decors-themes.js) : les UV sont refaites sur une copie
# étirée pareil, pour que la texture ait la même finesse partout une fois en place.
import sys, math
import bpy, bmesh
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
ENTREE, SORTIE = args[0], args[1]
TAILLE = int(args[2]) if len(args) > 2 else 1024

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=ENTREE)
obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = obj.data

co = np.array([v.co[:] for v in me.vertices])
x0, x1 = co[:, 0].min(), co[:, 0].max()
U = (co[:, 0] - x0) / (x1 - x0)  # 0 = bout du museau, 1 = bout de la queue

# --- profils le long du corps : hauteur de la crête, latéral de la crête, demi-largeur
NB = 120
def lisser(a, k):
    noyau = np.ones(k) / k
    return np.convolve(np.pad(a, k, mode="edge"), noyau, mode="same")[k:-k]
bins = np.clip((U * NB).astype(int), 0, NB - 1)
zc = np.zeros(NB); yc = np.zeros(NB); dl = np.zeros(NB)
for b in range(NB):
    s = co[bins == b]
    if len(s) == 0:
        zc[b] = zc[b - 1]; yc[b] = yc[b - 1]; dl[b] = dl[b - 1]; continue
    k = np.argmax(s[:, 2])
    zc[b] = s[k, 2]
    yc[b] = s[s[:, 2] > s[k, 2] * 0.85, 1].mean()
    dl[b] = (s[:, 1].max() - s[:, 1].min()) / 2
zc = lisser(zc, 5); yc = lisser(yc, 9); dl = lisser(dl, 5)
grille = (np.arange(NB) + 0.5) / NB
prof = lambda a, u: np.interp(u, grille, a)

# --- étirement approximatif du jeu (mêmes chiffres que DIPLO dans decors-themes.js)
LONGUEUR, HAUTEUR = 118.0, 12.0
def lat_jeu(u):
    return np.interp(u, [0, 0.09, 0.27, 0.34, 0.58, 0.68, 0.85, 1.0], [80, 85, 85, 52, 52, 80, 120, 150])
def haut_jeu(u):
    t = np.clip((u - 0.02) / 0.14, 0, 1)
    return HAUTEUR / zc.max() * (0.75 + 0.25 * t * t * (3 - 2 * t))

# --- nouvelles UV, calculées sur une copie étirée comme dans le jeu
etire = co.copy()
etire[:, 0] = U * LONGUEUR
etire[:, 1] = (co[:, 1] - prof(yc, U)) * lat_jeu(U)
etire[:, 2] = co[:, 2] * haut_jeu(U)
for v, p in zip(me.vertices, etire):
    v.co = p
for nom in [l.name for l in me.uv_layers]:
    me.uv_layers.remove(me.uv_layers[nom])
uvl = me.uv_layers.new(name="UVMap")
me.uv_layers.active = uvl
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")
for v, p in zip(me.vertices, co):
    v.co = p

# --- couleurs : une fonction de la position (modèle) et de la normale
def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
def mix(a, b, t):
    return a + (b - a) * t[:, None]
def bruit(x, y, z):
    # petites taches irrégulières (somme de sinus, pas de motif répété visible)
    return (np.sin(x * 61 + np.sin(z * 37) * 2) * np.sin(y * 53 + x * 13) + np.sin(z * 71 + x * 29) * 0.6 + np.sin(x * 23 - y * 31) * 0.5) / 2.1

C = lambda h: np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
DOS_TETE, DOS_CORPS, DOS_QUEUE = C("3fb39a"), C("5cb848"), C("86b83a")
RAYURE = C("2e6b34")
VENTRE = C("f7df8c")
FLANC_TACHE = C("a8d36b")
BOUCHE, NARINE, JOUE = C("3b1d1d"), C("2a1a14"), C("ff8fa3")

def couleur(P, Nn):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    u = (x - x0) / (x1 - x0)
    zcu = np.maximum(prof(zc, u), 1e-3)
    ycu = prof(yc, u)
    dlu = np.maximum(prof(dl, u), 1e-3)
    r = z / zcu  # 0 au sol, 1 sur la crête
    cote = (y - ycu) / dlu  # -1 .. 1 en travers
    # dos : couleur qui glisse doucement de la tête (vert d'eau) à la queue (vert olive)
    t1 = smooth(0.05, 0.35, u)[:, None]; t2 = smooth(0.55, 0.95, u)[:, None]
    dos = DOS_TETE * (1 - t1) + DOS_CORPS * t1
    dos = dos * (1 - t2) + DOS_QUEUE * t2
    dorsal = smooth(0.42, 0.72, r + 0.08 * bruit(x, y, z))
    c = mix(np.broadcast_to(VENTRE, P.shape).copy(), dos, dorsal)
    # rayures en travers du dos (toutes les ~4 m une fois en place), bords un peu ondulés
    phase = u * 27 + 0.12 * np.sin(cote * 5) + 0.05 * bruit(x, y, z)
    f = phase - np.floor(phase)
    bande = smooth(0.08, 0.15, f) * (1 - smooth(0.42, 0.49, f))
    bande *= smooth(0.13, 0.18, u) * (1 - smooth(0.9, 0.97, u)) * smooth(0.55, 0.8, r)
    c = mix(c, RAYURE, bande * 0.9)
    # taches claires sur les flancs
    tache = smooth(0.55, 0.75, bruit(x * 0.7, y * 0.7, z * 0.7)) * smooth(0.25, 0.4, r) * (1 - smooth(0.55, 0.7, r)) * smooth(0.25, 0.32, u) * (1 - smooth(0.62, 0.7, u))
    c = mix(c, FLANC_TACHE, tache * 0.8)
    # petites variations de peau
    c *= (1 + 0.07 * bruit(x * 2.3, y * 2.3, z * 2.3))[:, None]

    # --- tête : bouche (trait foncé qui remonte en sourire), narines, joues roses
    tete = u < 0.12
    if tete.any():
        uh = u
        zb = 0.30 + 0.3 * smooth(0.035, 0.07, uh)  # hauteur relative de la bouche (remonte en sourire au bout)
        epais = 0.06 + 0.03 * smooth(0.06, 0.075, uh)
        # sur les côtés, et devant le museau la bouche fait le tour
        bouche = (np.abs(r - zb) < epais) & (uh < 0.075) & ((np.abs(cote) > 0.3) | (uh < 0.014))
        c[bouche & tete] = BOUCHE
        nar = np.zeros(len(u), bool)
        for s in (-1, 1):
            d = np.hypot((u - 0.014) / 0.0055, (cote - s * 0.3) / 0.09)
            nar |= (d < 1) & (r > 0.55)
        c[nar & tete] = NARINE
        joue = np.hypot((u - 0.06) / 0.016, (r - 0.5) / 0.14) < 1
        joue &= np.abs(cote) > 0.55
        c[joue & tete] = c[joue & tete] * 0.35 + JOUE * 0.65
    return np.clip(c, 0, 1)

# --- on "peint" chaque triangle dans la texture (rastérisation en UV)
me.calc_loop_triangles()
uvs = np.array([d.uv[:] for d in uvl.data])
img = np.zeros((TAILLE, TAILLE, 3), np.float32)
rempli = np.zeros((TAILLE, TAILLE), bool)
listeP, listeN, listeI = [], [], []
for tri in me.loop_triangles:
    L = list(tri.loops)
    V = [me.loops[l].vertex_index for l in L]
    t = uvs[L] * TAILLE - 0.5
    p = co[V]
    n = np.array(tri.normal[:])
    u0, v0 = np.floor(t.min(0)).astype(int) - 1
    u1, v1 = np.ceil(t.max(0)).astype(int) + 1
    gx, gy = np.meshgrid(np.arange(max(0, u0), min(TAILLE, u1 + 1)), np.arange(max(0, v0), min(TAILLE, v1 + 1)))
    gx = gx.ravel(); gy = gy.ravel()
    det = (t[1, 0] - t[0, 0]) * (t[2, 1] - t[0, 1]) - (t[2, 0] - t[0, 0]) * (t[1, 1] - t[0, 1])
    if abs(det) < 1e-12:
        continue
    w1 = ((gx - t[0, 0]) * (t[2, 1] - t[0, 1]) - (t[2, 0] - t[0, 0]) * (gy - t[0, 1])) / det
    w2 = ((t[1, 0] - t[0, 0]) * (gy - t[0, 1]) - (gx - t[0, 0]) * (t[1, 1] - t[0, 1])) / det
    w0 = 1 - w1 - w2
    e = -0.6 / max(1.0, math.sqrt(abs(det)))  # un demi-texel de marge
    m = (w0 > e) & (w1 > e) & (w2 > e)
    if not m.any():
        continue
    P = p[0] * w0[m, None] + p[1] * w1[m, None] + p[2] * w2[m, None]
    listeP.append(P); listeN.append(np.broadcast_to(n, P.shape)); listeI.append(gy[m] * TAILLE + gx[m])
P = np.concatenate(listeP); Nn = np.concatenate(listeN); I = np.concatenate(listeI)
cols = couleur(P, Nn)
plat = img.reshape(-1, 3)
plat[I] = cols
rempli.reshape(-1)[I] = True
# bords des îlots : on étale les couleurs sur quelques texels (pas de coutures noires)
for _ in range(6):
    vide = ~rempli
    acc = np.zeros_like(img); nb = np.zeros((TAILLE, TAILLE), np.float32)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        acc += np.roll(np.roll(img * rempli[..., None], dx, 1), dy, 0)
        nb += np.roll(np.roll(rempli.astype(np.float32), dx, 1), dy, 0)
    neuf = vide & (nb > 0)
    img[neuf] = acc[neuf] / nb[neuf, None]
    rempli |= neuf
print("texels peints", int(rempli.sum()), "/", TAILLE * TAILLE)

# --- image + matériau (couleur de base, non métallique)
im = bpy.data.images.new("peau_diplodocus", TAILLE, TAILLE)
rgba = np.ones((TAILLE, TAILLE, 4), np.float32)
lin = np.where(img <= 0.04045, img / 12.92, ((img + 0.055) / 1.055) ** 2.4)  # sRGB -> linéaire (Blender stocke en linéaire)
rgba[..., :3] = lin
im.pixels.foreach_set(rgba.ravel())
im.pack()
mat = bpy.data.materials.new("peau")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
bsdf.inputs["Roughness"].default_value = 1.0
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = im
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
me.materials.clear()
me.materials.append(mat)
obj.name = me.name = "diplodocus"

# --- œil de dessin animé : blanc, grosse pupille noire, reflet (rayon 1, regarde vers -X)
def boule(rayon, centre, echelle, coul, seg=14, anneaux=9):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=anneaux, radius=rayon)
    for v in bm.verts:
        v.co.x = v.co.x * echelle[0] + centre[0]
        v.co.y = v.co.y * echelle[1] + centre[1]
        v.co.z = v.co.z * echelle[2] + centre[2]
    m = bpy.data.meshes.new("b"); bm.to_mesh(m); bm.free()
    o = bpy.data.objects.new("b", m); bpy.context.scene.collection.objects.link(o)
    ca = m.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    for d in ca.data:
        d.color = (*coul, 1.0)
    return o
lin1 = lambda c: tuple(float(np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)) for v in c)
parties = [
    boule(1.0, (0, 0, 0), (1, 1, 1), lin1((1, 1, 1)), 16, 10),
    boule(1.0, (-0.62, 0, 0.05), (0.42, 0.62, 0.66), lin1((0.07, 0.06, 0.08)), 14, 9),
    boule(1.0, (-0.93, 0.18, 0.28), (0.1, 0.17, 0.17), lin1((1, 1, 1)), 8, 6),
]
bpy.ops.object.select_all(action="DESELECT")
for o in parties:
    o.select_set(True)
bpy.context.view_layer.objects.active = parties[0]
bpy.ops.object.join()
oeil = parties[0]
oeil.name = oeil.data.name = "oeil"
moeil = bpy.data.materials.new("oeil"); moeil.use_nodes = True
ca = moeil.node_tree.nodes.new("ShaderNodeVertexColor"); ca.layer_name = "Col"
moeil.node_tree.links.new(ca.outputs["Color"], moeil.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
oeil.data.materials.append(moeil)
oeil.location = (x0 - 5, 0, 0)  # rangé à côté (le jeu le place lui-même)

print("triangles diplodocus", sum(len(p.vertices) - 2 for p in me.polygons), "oeil", sum(len(p.vertices) - 2 for p in oeil.data.polygons))
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=SORTIE, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=90,
                          export_normals=False, export_materials="EXPORT", export_vertex_color="ACTIVE")
