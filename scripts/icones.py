"""
Fabrique les icônes de l'appli (PWA) à partir des sprites des personnages.

Sortie : public/icones/icone-192.png, icone-512.png, icone-maskable-512.png, apple-touch-icon.png
Usage : python scripts/icones.py   (ou npm run icones, sans installer Python)
"""

from pathlib import Path
from PIL import Image, ImageDraw

RACINE = Path(__file__).resolve().parent.parent
SPRITES = RACINE / "assets" / "personnages"
SORTIE = RACINE / "public" / "icones"


def fond(taille: int, arrondi: bool) -> Image.Image:
    """Dégradé bleu -> violet, avec une bande de damier en bas."""
    img = Image.new("RGBA", (taille, taille))
    px = img.load()
    for y in range(taille):
        t = y / (taille - 1)
        r = int(0x4A + (0x7B - 0x4A) * t)
        g = int(0xA8 + (0x5C - 0xA8) * t)
        b = 0xFF
        for x in range(taille):
            px[x, y] = (r, g, b, 255)
    d = ImageDraw.Draw(img)
    case = taille // 12
    y0 = taille - case * 2
    for ligne in range(2):
        for col in range(13):
            couleur = (255, 255, 255, 255) if (col + ligne) % 2 == 0 else (30, 30, 30, 255)
            d.rectangle([col * case, y0 + ligne * case, (col + 1) * case, y0 + (ligne + 1) * case], fill=couleur)
    if arrondi:
        masque = Image.new("L", (taille, taille), 0)
        ImageDraw.Draw(masque).rounded_rectangle([0, 0, taille - 1, taille - 1], radius=taille // 5, fill=255)
        img.putalpha(masque)
    return img


def tete(nom: str, hauteur: int) -> Image.Image:
    """Le haut du sprite de face (tête + épaules)."""
    s = Image.open(SPRITES / f"{nom}_face.png").convert("RGBA")
    boite = s.getbbox()
    s = s.crop(boite)
    s = s.crop((0, 0, s.width, int(s.height * 0.78)))
    l = int(s.width * hauteur / s.height)
    return s.resize((l, hauteur), Image.LANCZOS)


def icone(taille: int, zone_sure: float, arrondi: bool) -> Image.Image:
    """zone_sure : part de l'icône où le contenu doit tenir (maskable = 0.8)."""
    img = fond(taille, arrondi)
    h = int(taille * zone_sure * 0.78)
    gauche, droite = tete("viggo", h), tete("harry", h)
    bas = int(taille * (1 + zone_sure) / 2) - int(taille * 0.08)
    cx = taille // 2
    ecart = int(taille * zone_sure * 0.2)
    img.alpha_composite(droite, (cx + ecart - droite.width // 2, bas - h))
    img.alpha_composite(gauche, (cx - ecart - gauche.width // 2, bas - h))
    return img


def main():
    SORTIE.mkdir(parents=True, exist_ok=True)
    icone(192, 0.95, True).save(SORTIE / "icone-192.png", optimize=True)
    icone(512, 0.95, True).save(SORTIE / "icone-512.png", optimize=True)
    icone(512, 0.8, False).save(SORTIE / "icone-maskable-512.png", optimize=True)
    icone(180, 0.9, False).save(SORTIE / "apple-touch-icon.png", optimize=True)
    print("Icônes créées dans", SORTIE.relative_to(RACINE))


if __name__ == "__main__":
    main()
