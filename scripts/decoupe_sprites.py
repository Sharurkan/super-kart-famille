"""
Découpe les images de personnages en sprites face / dos avec fond transparent.

Entrée  : assets/originaux/<nom>.jpg  (vue de face à gauche, vue de dos à droite, fond blanc)
Sortie  : assets/personnages/<nom>_face.png et <nom>_dos.png

Tous les sprites ont la même taille de toile, le bas du personnage collé au bas
de l'image, centré horizontalement sur le buste.

Usage : python scripts/decoupe_sprites.py
Dépendances : pip install pillow numpy
"""

from pathlib import Path
from collections import deque

import numpy as np
from PIL import Image

RACINE = Path(__file__).resolve().parent.parent
DOSSIER_ENTREE = RACINE / "assets" / "originaux"
DOSSIER_SORTIE = RACINE / "assets" / "personnages"
NOMS = ["viggo", "harry", "maman", "bryan", "mamy"]

TAILLE_TOILE = 512      # sprites carrés 512 x 512
MARGE_HAUT = 8          # quelques pixels libres au-dessus de la tête
SEUIL_BAS = 15          # "distance au blanc" en dessous = fond pur
SEUIL_HAUT = 60         # au-dessus = personnage opaque


def distance_au_blanc(rgb: np.ndarray) -> np.ndarray:
    """0 pour un pixel blanc, grand pour un pixel coloré ou sombre."""
    rgb = rgb.astype(np.int16)
    sombre = 255 - rgb.min(axis=2)                 # éloignement du blanc
    sature = rgb.max(axis=2) - rgb.min(axis=2)     # couleur (évite de manger le pastel)
    return np.maximum(sombre, sature)


def trouver_colonne_de_coupe(rgb: np.ndarray) -> int:
    """Cherche, dans le tiers central, la colonne la plus 'blanche'."""
    d = distance_au_blanc(rgb)
    largeur = d.shape[1]
    debut, fin = largeur // 3, 2 * largeur // 3
    remplissage = (d[:, debut:fin] > SEUIL_HAUT).sum(axis=0)
    # lissage pour viser le milieu de la bande blanche
    noyau = np.ones(15) / 15
    remplissage = np.convolve(remplissage, noyau, mode="same")
    return debut + int(np.argmin(remplissage))


def remplissage_fond(d: np.ndarray) -> np.ndarray:
    """Flood fill depuis les bords (sauf le bas, où le personnage est coupé)
    sur les pixels presque blancs. Les blancs à l'intérieur du personnage
    (bandes de casque, combinaison) ne sont pas touchés."""
    h, w = d.shape
    clair = d < SEUIL_HAUT
    fond = np.zeros((h, w), dtype=bool)
    file = deque()
    for x in range(w):
        file.append((0, x))
        file.append((h - 1, x))
    for y in range(h):
        file.append((y, 0))
        file.append((y, w - 1))
    while file:
        y, x = file.popleft()
        if fond[y, x] or not clair[y, x]:
            continue
        fond[y, x] = True
        if y > 0:
            file.append((y - 1, x))
        if y < h - 1:
            file.append((y + 1, x))
        if x > 0:
            file.append((y, x - 1))
        if x < w - 1:
            file.append((y, x + 1))
    return fond


def detourer(img: Image.Image) -> Image.Image:
    """Renvoie une image RGBA dont le fond blanc est transparent,
    avec des contours doux et sans halo blanc."""
    rgb = np.asarray(img.convert("RGB")).astype(np.float32)
    d = distance_au_blanc(rgb.astype(np.uint8)).astype(np.float32)

    fond_candidat = remplissage_fond(d)
    # zone claire connectée au bord : transparence progressive selon la
    # distance au blanc (contours des cheveux adoucis)
    alpha = np.ones(d.shape, dtype=np.float32)
    alpha[fond_candidat] = np.clip((d[fond_candidat] - SEUIL_BAS) / (SEUIL_HAUT - SEUIL_BAS), 0, 1)

    # supprime les poussières isolées (artefacts JPEG)
    alpha[alpha < 0.08] = 0

    # "dé-mélange" du blanc : couleur = (observé - blanc*(1-a)) / a
    a = alpha[..., None]
    with np.errstate(divide="ignore", invalid="ignore"):
        propre = np.where(a > 0, (rgb - 255.0 * (1 - a)) / np.maximum(a, 1e-3), 0)
    propre = np.clip(propre, 0, 255)

    rgba = np.dstack([propre, alpha * 255]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def boite(alpha: np.ndarray):
    ys, xs = np.nonzero(alpha > 128)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def centre_buste(alpha: np.ndarray, b) -> float:
    """Centre horizontal du bas du personnage (plus stable que les cheveux)."""
    x0, y0, x1, y1 = b
    bas = alpha[y1 - max(1, (y1 - y0) // 6):y1, :]
    xs = np.nonzero((bas > 20).any(axis=0))[0]
    return (xs.min() + xs.max() + 1) / 2


def poser_sur_toile(sprite: Image.Image, echelle: float) -> Image.Image:
    alpha = np.asarray(sprite)[..., 3]
    b = boite(alpha)
    cx = centre_buste(alpha, b)
    x0, y0, x1, y1 = b
    recadre = sprite.crop((x0, y0, x1, y1))
    nl, nh = max(1, round((x1 - x0) * echelle)), max(1, round((y1 - y0) * echelle))
    recadre = recadre.resize((nl, nh), Image.LANCZOS)
    toile = Image.new("RGBA", (TAILLE_TOILE, TAILLE_TOILE), (0, 0, 0, 0))
    px = round(TAILLE_TOILE / 2 - (cx - x0) * echelle)
    py = TAILLE_TOILE - nh          # bas collé au bas de la toile
    toile.paste(recadre, (px, py), recadre)
    return toile


def traiter(nom: str):
    img = Image.open(DOSSIER_ENTREE / f"{nom}.jpg")
    rgb = np.asarray(img.convert("RGB"))
    coupe = trouver_colonne_de_coupe(rgb)
    w, h = img.size
    vues = {
        "face": detourer(img.crop((0, 0, coupe, h))),
        "dos": detourer(img.crop((coupe, 0, w, h))),
    }
    # même échelle pour face et dos : la plus grande hauteur tient dans la toile
    hauteurs, largeurs = [], []
    for v in vues.values():
        x0, y0, x1, y1 = boite(np.asarray(v)[..., 3])
        hauteurs.append(y1 - y0)
        largeurs.append(x1 - x0)
    echelle = min((TAILLE_TOILE - MARGE_HAUT) / max(hauteurs), TAILLE_TOILE / max(largeurs))
    for cote, v in vues.items():
        sortie = DOSSIER_SORTIE / f"{nom}_{cote}.png"
        poser_sur_toile(v, echelle).save(sortie, optimize=True)
        print(f"  {sortie.relative_to(RACINE)}")
    print(f"{nom} : coupe à x={coupe}, échelle {echelle:.3f}")


def main():
    DOSSIER_SORTIE.mkdir(parents=True, exist_ok=True)
    for nom in NOMS:
        traiter(nom)


if __name__ == "__main__":
    main()
