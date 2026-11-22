# Blender (sans fenêtre) : rassemble les vues des imposteurs (rendues par impostors_rendre.py)
# dans un seul atlas WebP + un fichier JSON lu par src/vegetation.js.
#
# blender -b --python impostors_atlas.py -- dossier_rendus sortie_sans_extension cote nom:hauteur_px nom:hauteur_px ...
#   - cote : taille de l'atlas (carré, ex. 2048)
#   - nom:hauteur_px : hauteur voulue d'une case pour ce sprite (réduite au besoin pour tout faire tenir)
# Atlas du jeu : 2048 sapin_a:512 sapin_b:448 ile_a:256 jacaranda:240 petit_arbre:208 pachira_d:320 pachira_c:160 calathea:128 anthurium:96
# Les cases sont rangées en étagères (des plus hautes aux plus basses) ; chaque vue a son propre
# rectangle dans le JSON, le jeu n'a pas besoin qu'elles se suivent.
# Le bord des feuilles est « étalé » dans le transparent (couleur voisine) pour que les mipmaps
# ne fassent pas de liseré sombre ou blanc autour des arbres.
import sys, os, json
import bpy
import numpy as np

a = sys.argv[sys.argv.index("--") + 1:]
DOSSIER, SORTIE, COTE = a[0], a[1], int(a[2])
DEMANDES = [(s.split(":")[0], int(s.split(":")[1])) for s in a[3:]]
PAD = 2

sprites = []
for nom, h in DEMANDES:
    info = json.load(open(os.path.join(DOSSIER, nom + ".json")))
    img = bpy.data.images.load(os.path.join(DOSSIER, nom + ".png"))
    w0, h0 = img.size
    p = np.empty(w0 * h0 * 4, dtype=np.float32)
    img.pixels.foreach_get(p)
    p = p.reshape(h0, w0, 4)[::-1]  # ligne 0 = haut de l'image
    info["pixels"] = p
    info["demande"] = h
    sprites.append(info)


def ranger(echelle):
    """Étagères : renvoie [(sprite, vue, x, y, w, h)] ou None si ça ne tient pas."""
    cases = []
    for s in sprites:
        cw, ch = s["case"]
        h = max(16, int(s["demande"] * echelle))
        w = max(8, int(round(h * cw / ch)))
        for k in range(s["vues"]):
            cases.append((s, k, w, h))
    cases.sort(key=lambda c: -c[3])
    res, x, y, hs = [], 0, 0, 0
    for s, k, w, h in cases:
        if x + w > COTE:
            x, y, hs = 0, y + hs + PAD, 0
        if hs == 0:
            hs = h
        if y + h > COTE:
            return None
        res.append((s, k, x, y, w, h))
        x += w + PAD
    return res


echelle = 1.0
while (rang := ranger(echelle)) is None:
    echelle *= 0.98
print("échelle des cases", round(echelle, 3))


def reduire(img, w, h):
    """Réduction de qualité (moyenne de zones), en couleurs prémultipliées."""
    H0, W0 = img.shape[:2]
    pm = img.copy()
    pm[..., :3] *= pm[..., 3:4]
    ys = (np.arange(h + 1) * H0 / h).astype(int)
    xs = (np.arange(w + 1) * W0 / w).astype(int)
    c = np.cumsum(np.cumsum(np.pad(pm, ((1, 0), (1, 0), (0, 0))), 0), 1)
    tot = c[ys[1:]][:, xs[1:]] - c[ys[:-1]][:, xs[1:]] - c[ys[1:]][:, xs[:-1]] + c[ys[:-1]][:, xs[:-1]]
    aire = ((ys[1:] - ys[:-1])[:, None] * (xs[1:] - xs[:-1])[None, :])[..., None]
    out = tot / np.maximum(aire, 1)
    al = out[..., 3:4]
    out[..., :3] = np.where(al > 1e-4, out[..., :3] / np.maximum(al, 1e-4), 0)
    return out


def etaler(img, tours=24):
    """Couleur des pixels transparents = moyenne des voisins colorés (alpha inchangé)."""
    rgb = img[..., :3].copy()
    connu = (img[..., 3] > 0.05).astype(np.float32)
    for _ in range(tours):
        s = np.zeros_like(rgb)
        n = np.zeros_like(connu)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            s += np.roll(rgb * connu[..., None], (dy, dx), (0, 1))
            n += np.roll(connu, (dy, dx), (0, 1))
        nouveau = (connu == 0) & (n > 0)
        rgb[nouveau] = s[nouveau] / n[nouveau][:, None]
        connu[nouveau] = 1
    reste = connu == 0
    if reste.any():
        moy = (img[..., :3] * (img[..., 3:4] > 0.05)).sum((0, 1)) / max(1, (img[..., 3] > 0.05).sum())
        rgb[reste] = moy
    img[..., :3] = rgb
    return img


atlas = np.zeros((COTE, COTE, 4), dtype=np.float32)
sortie = {"taille": [COTE, COTE], "sprites": {}}
for s, k, x, y, w, h in rang:
    cw, ch = s["case"]
    vue = s["pixels"][:, k * cw:(k + 1) * cw]
    atlas[y:y + h, x:x + w] = etaler(reduire(vue, w, h))
    d = sortie["sprites"].setdefault(s["nom"], {
        "largeur": s["largeur"], "hauteur": s["hauteur"], "bas": s["bas"], "rayon": s["rayon"], "vues": []})
    d["vues"].append(None)
for s, k, x, y, w, h in rang:  # rectangles en UV (v vers le haut, comme three.js avec flipY)
    sortie["sprites"][s["nom"]]["vues"][k] = [round(x / COTE, 5), round(1 - (y + h) / COTE, 5), round(w / COTE, 5), round(h / COTE, 5)]
# couleur des zones vides : étalée aussi (pas de noir qui bave dans les petites mipmaps)
vide = atlas[..., 3] == 0
moy = atlas[..., :3][~vide].mean(0)
atlas[vide, :3] = moy

o = bpy.data.images.new("atlas", COTE, COTE, alpha=True)
o.pixels.foreach_set(atlas[::-1].ravel())
o.filepath_raw = SORTIE + ".png"
o.file_format = "PNG"
o.save()
o.filepath_raw = SORTIE + ".webp"
o.file_format = "WEBP"
o.save(quality=int(os.environ.get("QUALITE", "82")))
json.dump(sortie, open(SORTIE + ".json", "w"), separators=(",", ":"))
print("atlas", SORTIE, os.path.getsize(SORTIE + ".webp") // 1024, "Kio")
