# Blender (mode sans fenêtre) : peint le diplodocus couché avec une peau "réaliste" de
# sauropode (gris-vert / olive, dos plus foncé, ventre clair poussiéreux, marbrures, petites
# écailles, plis du cou, œil sombre un peu brillant, ligne de la bouche), refait ses UV et
# cuit le tout dans une texture.
#
# blender --background --python repeindre_diplodocus.py -- entree.glb sortie.glb [taille_texture]
#
# entree.glb : le modèle nettoyé (sortie de nettoyer_diplodocus.py, gardé dans
# outils/blender/diplodocus-base.glb), couché le long de X (tête vers -X), Z en haut dans
# Blender, posé sur z = 0. La forme n'est pas modifiée : le jeu l'agrandit presque
# uniformément (voir DIPLO dans src/decors-themes.js).
import sys, math
import bpy, bmesh
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
ENTREE, SORTIE = args[0], args[1]
TAILLE = int(args[2]) if len(args) > 2 else 1024
METRES = 54.0  # mètres par unité du modèle une fois dans le jeu (environ), pour régler les bruits

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=ENTREE)
obj = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = obj.data

# faces retournées du modèle généré : on remet toutes les normales vers l'extérieur
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")

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
zc = lisser(zc, 3); yc = lisser(yc, 9); dl = lisser(dl, 5)
grille = (np.arange(NB) + 0.5) / NB
prof = lambda a, u: np.interp(u, grille, a)

def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

# --- l'œil : sur le côté de la tête, aux 2/3 de sa hauteur, un peu en arrière du milieu
U_OEIL = 0.052
tranche = co[np.abs(U - U_OEIL) < 0.006]
zt = tranche[:, 2].max()
haut = tranche[np.abs(tranche[:, 2] - zt * 0.66) < zt * 0.12]
yct = prof(yc, U_OEIL)
OEILS = []
for cote in (-1, 1):
    c = haut[np.argmax((haut[:, 1] - yct) * cote)]
    OEILS.append((c, cote))
print("yeux", [tuple(np.round(c, 4)) for c, _ in OEILS], "hauteur tête", round(zt, 4))
H_TETE = zt

# --- nouvelles UV : la tête reçoit plus de place dans la texture (œil, bouche plus fins)
copie = co.copy()
copie[:, 2] *= 0.88
grossir = 1 + 1.6 * (1 - smooth(0.10, 0.17, U))
centre = np.array([x0, 0, 0])
copie = centre + (copie - centre) * grossir[:, None]
for v, p in zip(me.vertices, copie):
    v.co = p
for nom in [l.name for l in me.uv_layers]:
    me.uv_layers.remove(me.uv_layers[nom])
uvl = me.uv_layers.new(name="UVMap")
me.uv_layers.active = uvl
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003)
bpy.ops.object.mode_set(mode="OBJECT")
for v, p in zip(me.vertices, co):
    v.co = p

# --- bruits (en mètres, une fois le modèle agrandi)
def hacher(ix, iy, iz, graine):
    h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (graine * 2654435761)
    h &= 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    h ^= h >> 16
    return (h & 0xFFFFFF) / float(0xFFFFFF)

def bruit_valeur(p, graine=0):
    i = np.floor(p).astype(np.int64)
    f = p - i
    f = f * f * (3 - 2 * f)
    r = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                r = r + w * hacher(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, graine)
    return r * 2 - 1  # -1 .. 1

def fbm(p, octaves, graine=0):
    r, a, tot = 0, 1.0, 0
    for o in range(octaves):
        r = r + a * bruit_valeur(p * (2 ** o) + o * 17.3, graine + o)
        tot += a
        a *= 0.5
    return r / tot

def cellules(p, graine=0):
    """Distance au bord de la cellule (écailles) : petit au bord, grand au centre."""
    i = np.floor(p).astype(np.int64)
    f1 = np.full(len(p), 9.0); f2 = np.full(len(p), 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = i + np.array([dx, dy, dz])
                pt = c + np.stack([hacher(c[:, 0], c[:, 1], c[:, 2], graine + k) for k in range(3)], 1)
                d = np.sqrt(((p - pt) ** 2).sum(1))
                f2 = np.where(d < f1, f1, np.minimum(f2, d))
                f1 = np.minimum(f1, d)
    return f2 - f1

C = lambda h: np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
DOS = C("5a6436")          # dos : olive brun foncé
DOS_VERT = C("56643a")
FLANC = C("949560")        # flancs : olive gris-vert
FLANC_BRUN = C("9a8a5d")
VENTRE = C("d2c29c")       # ventre : beige poussiéreux
TERRE = C("8e7858")        # poussière / boue près du sol
TACHE = C("444d2c")        # marbrures sombres
BOUCHE = C("2b231b")
PAUPIERE = C("4a4232")
OEIL = C("17110c")
IRIS = C("4a2c12")

def mix(a, b, t):
    return a + (b - a) * t[:, None]

def couleur(P, Nn):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    u = (x - x0) / (x1 - x0)
    zcu = np.maximum(prof(zc, u), 1e-3)
    ycu = prof(yc, u)
    r = z / zcu  # 0 au sol, 1 sur la crête
    Pm = np.stack([x, y, z * 0.88], 1) * METRES
    n = len(P)
    # grandes zones : un peu plus vert ou plus brun, plus clair ou plus foncé (taille ~6 m)
    g1 = fbm(Pm / 7.0, 3, 1)
    g2 = fbm(Pm / 3.0, 3, 7)
    flanc = mix(np.broadcast_to(FLANC, (n, 3)).copy(), FLANC_BRUN, smooth(-0.3, 0.5, g1))
    dos = mix(np.broadcast_to(DOS, (n, 3)).copy(), DOS_VERT, smooth(-0.4, 0.4, g2))
    # contre-ombrage : dos foncé, flancs gris-vert, dessous clair poussiéreux
    vers_haut = np.clip(Nn[:, 2], -1, 1)
    dorsal = smooth(0.5, 0.92, r + 0.10 * g2 + 0.08 * vers_haut)
    c = mix(flanc, dos, dorsal)
    ventre = (1 - smooth(0.12, 0.42, r + 0.08 * g1)) * smooth(0.0, 0.5, -vers_haut + 0.6)
    c = mix(c, VENTRE, ventre * 0.85)
    # marbrures sombres sur le dos et le haut des flancs (comme l'image de référence)
    m = fbm(Pm / 1.6, 4, 23)
    c = mix(c, TACHE, smooth(0.18, 0.45, m) * smooth(0.3, 0.7, r) * 0.55)
    # petites taches claires sur les flancs
    t2 = fbm(Pm / 0.9, 3, 41)
    c = mix(c, VENTRE, smooth(0.35, 0.6, t2) * smooth(0.2, 0.45, r) * (1 - smooth(0.6, 0.85, r)) * 0.35)
    # poussière et terre près du sol
    c = mix(c, TERRE, (1 - smooth(0.4, 1.4, z * METRES * 0.88 + 0.6 * g1)) * 0.75)
    # plis du cou (en travers, plus marqués en bas)
    cou = smooth(0.08, 0.12, u) * (1 - smooth(0.26, 0.31, u))
    phase = u * (x1 - x0) * METRES / 0.9 + 0.8 * g2
    pli = smooth(0.82, 0.97, np.abs(np.sin(phase * math.pi)))
    c *= (1 - 0.07 * pli * cou * (1 - smooth(0.4, 0.9, r)))[:, None]
    # écailles : petites cellules (~25 cm) au bord plus foncé, et grain fin
    e = cellules(Pm / 0.26, 59)
    c *= (0.90 + 0.10 * smooth(0.0, 0.25, e))[:, None]
    c *= (1 + 0.06 * fbm(Pm / 0.08, 2, 77))[:, None]

    # --- tête : ligne de la bouche, yeux
    tete = u < 0.13
    if tete.any():
        cote = y - ycu
        # bouche : trait fin et discret le long du bas de la tête
        zb = H_TETE * (0.37 - 0.03 * smooth(0.02, 0.045, u))  # presque droite, descend un peu au coin
        dist = np.abs(z - zb)
        bouche = tete & (u < 0.043) & (dist < H_TETE * 0.011 * (1 - 0.5 * smooth(0.03, 0.043, u))) & ((np.abs(Nn[:, 1]) > 0.35) | (u < 0.012))
        levre = tete & (u < 0.045) & (dist < H_TETE * 0.035) & ((np.abs(Nn[:, 1]) > 0.3) | (u < 0.012))
        c[levre] *= 0.86
        c[bouche] = c[bouche] * 0.45 + BOUCHE * 0.55
        # yeux : paupière plus foncée, œil presque noir (iris brun), petit reflet mouillé
        R = 0.0056  # unités du modèle (~0,3 m)
        for centre, s in OEILS:
            d = np.sqrt((((P - centre) * np.array([1, 1, 1.25])) ** 2).sum(1)) / R
            face = Nn[:, 1] * s > 0.2
            pp = tete & face & (d < 1.75)
            c[pp] = mix(c[pp], PAUPIERE, (1 - smooth(1.2, 1.75, d[pp])) * 0.55)
            oe = tete & face & (d < 1.0)
            c[oe] = mix(np.broadcast_to(IRIS, (oe.sum(), 3)).copy(), OEIL, smooth(0.15, 0.65, d[oe]))
            c[oe] = mix(c[oe], OEIL, smooth(0.9, 1.0, d[oe]))
            # reflet : en haut, vers l'avant (le soleil)
            rp = centre + np.array([-0.35 * R, 0, 0.42 * R])
            dr = np.sqrt(((P - rp) ** 2).sum(1)) / (R * 0.24)
            ref = tete & face & (dr < 1)
            c[ref] = mix(c[ref], np.array([0.93, 0.93, 0.9]), 1 - smooth(0.5, 1.0, dr[ref]))
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
    nrm = np.array(tri.normal[:])
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
    listeP.append(P); listeN.append(np.broadcast_to(nrm, P.shape)); listeI.append(gy[m] * TAILLE + gx[m])
P = np.concatenate(listeP); Nn = np.concatenate(listeN); I = np.concatenate(listeI)
cols = np.concatenate([couleur(P[k:k + 150000], Nn[k:k + 150000]) for k in range(0, len(P), 150000)])
plat = img.reshape(-1, 3)
plat[I] = cols
rempli.reshape(-1)[I] = True
# bords des îlots : on étale les couleurs sur quelques texels (pas de coutures noires)
for _ in range(8):
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
rgba[..., :3] = img  # image 8 bits en sRGB : les pixels sont lus/écrits tels quels (pas de conversion)
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

print("triangles diplodocus", sum(len(p.vertices) - 2 for p in me.polygons))
bpy.ops.export_scene.gltf(filepath=SORTIE, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=90,
                          export_normals=False, export_materials="EXPORT", use_selection=False)
