# Sons du T-rex du bord de la route (src/trex-attaque.js), à partir de sons libres CC0 :
#  - « T-rex calls » (CaveboyTup, OpenGameArt) : rugissement (raté) et grognement (il guette) ;
#  - « 80 CC0 creature SFX #2 » (rubberduck, OpenGameArt) : claquement de mâchoires = attack_01
#    un peu plus grave + stomp_01 (coup sourd).
# Découpe, fondus, mélange et normalisation avec numpy ; encodage OGG Vorbis mono avec le module aud
# de Blender (pas besoin de ffmpeg).
# Lancer : blender -b --factory-startup --python outils/blender/sons_trex.py -- <dossier assets-libres> <dossier de sortie>
import aud, numpy as np, os, sys

entree, sortie = sys.argv[sys.argv.index("--") + 1:][:2]
RATE = 48000

def charger(f):
    s = aud.Sound(f).resample(RATE, False)
    d = s.data()
    return (d.mean(axis=1) if d.ndim > 1 else d).astype(np.float64)

def couper(x, debut, fin, fondu_in=0.03, fondu_out=0.5):
    y = x[int(debut * RATE):int(fin * RATE)].copy()
    a, b = int(fondu_in * RATE), int(fondu_out * RATE)
    y[:a] *= np.linspace(0, 1, a)
    y[-b:] *= np.linspace(1, 0, b) ** 2
    return y

def grave(x, f):
    """Ralentit (f < 1 : plus grave et plus long)."""
    n = int(len(x) / f)
    return np.interp(np.arange(n) * f, np.arange(len(x)), x)

def ecrire(x, nom, pic=0.95, debit=96000):
    x = x * (pic / max(np.abs(x).max(), 1e-9))
    s = aud.Sound.buffer(x.astype(np.float32).reshape(-1, 1), RATE)
    chemin = os.path.join(sortie, nom)
    s.write(chemin, rate=RATE, channels=aud.CHANNELS_MONO, container=aud.CONTAINER_OGG, codec=aud.CODEC_VORBIS, bitrate=debit)
    print(nom, f"{len(x) / RATE:.2f}s", os.path.getsize(chemin), "octets")

appels = charger(os.path.join(entree, "t-rex-calls", "t-rex_calls.mp3"))
# rugissement le plus grave et puissant de l'enregistrement (10,45 s → 15,35 s), raccourci à 4 s
ecrire(couper(appels, 10.45, 14.45, 0.03, 0.9), "trex-rugissement.ogg")
# grognement grave et court (15,8 s → 18,7 s)
ecrire(couper(appels, 15.8, 18.7, 0.03, 0.6), "trex-grognement.ogg")
# CLAC : claquement sec un peu plus grave + coup sourd
claque = grave(charger(os.path.join(entree, "creature-sfx-2", "extrait", "attack_01.ogg")), 0.85)
coup = charger(os.path.join(entree, "creature-sfx-2", "extrait", "stomp_01.ogg"))
n = max(len(claque), len(coup))
mix = np.zeros(n)
mix[:len(claque)] += claque
mix[:len(coup)] += 0.6 * coup / max(np.abs(coup).max(), 1e-9) * np.abs(claque).max()
ecrire(couper(mix, 0, n / RATE, 0.002, 0.08), "trex-clac.ogg")
