# Super Kart Famille : tester et installer sur la tablette

## 1. Tester pendant le développement (sans installer)

Sur le PC, dans le dossier du jeu :

```powershell
npm run dev
```

Sur la tablette (même Wi-Fi que le PC), ouvrir Chrome à l'adresse :

**http://192.168.0.57:5173**

Chaque modification du code s'affiche dès qu'on recharge la page.

> Si la page ne s'ouvre pas : Windows a peut-être bloqué Node.js. Autoriser Node.js
> sur les **réseaux privés** dans le pare-feu Windows.
> Si l'adresse du PC change, la retrouver avec `ipconfig` (ligne « Adresse IPv4 »).

## 2. Installer l'appli sur la tablette

Chrome n'installe une appli que depuis une adresse **sécurisée** (https) ou depuis
`localhost`. Une adresse du réseau local comme `http://192.168.0.57` ne compte pas,
d'où une petite étape de réglage dans Chrome.

### Méthode conseillée : tout reste à la maison

Les dessins des personnages viennent de photos de famille. Avec cette méthode, rien
n'est publié sur Internet.

**Sur le PC** : fabriquer la version finale et la servir sur le réseau.

```powershell
npm run build
```

```powershell
npm run preview
```

Le jeu est alors disponible sur **http://192.168.0.57:4173**.

**Sur la tablette, une seule fois** : dire à Chrome de faire confiance à cette adresse.

1. Dans la barre d'adresse de Chrome, taper `chrome://flags` puis valider.
2. Chercher **Insecure origins treated as secure**.
3. Dans la case de texte, écrire `http://192.168.0.57:4173`.
4. Passer le réglage sur **Enabled**, puis appuyer sur **Relaunch** (Chrome redémarre).

**Installer** :

1. Ouvrir **http://192.168.0.57:4173** dans Chrome et attendre l'écran titre.
2. Menu **⋮** (en haut à droite) → **Installer l'application**
   (ou **Ajouter à l'écran d'accueil** → **Installer**).
3. L'icône « Super Kart » (Viggo et Harry) apparaît sur l'écran d'accueil.

Ensuite :

- L'appli s'ouvre en plein écran, en paysage.
- Elle marche **sans le PC et sans Internet** : tout est enregistré sur la tablette.
- Pour une **mise à jour** : sur le PC, relancer `npm run build` puis `npm run preview`.
  Ouvrir l'appli sur la tablette pendant que le PC tourne : la nouvelle version
  s'installe toute seule (elle apparaît au lancement suivant).

> ⚠️ Si l'adresse du PC change (autre box, autre réseau), l'appli déjà installée
> continue de marcher, mais les mises à jour demandent de refaire le réglage
> `chrome://flags` avec la nouvelle adresse.

### Autre méthode : mettre le jeu en ligne (https)

On peut aussi publier le dossier `dist/` (créé par `npm run build`) sur un hébergeur
gratuit en https (GitHub Pages, Netlify, Cloudflare Pages…). Plus besoin de
`chrome://flags`, et l'appli s'installe depuis n'importe où.

> ⚠️ Le site serait accessible à toute personne qui connaît l'adresse, avec les
> visages de la famille.

## Commandes utiles

| Commande | À quoi ça sert |
|---|---|
| `npm run dev` | jouer pendant le développement (port 5173) |
| `npm run build` | fabriquer la version finale dans `dist/` |
| `npm run preview` | servir la version finale sur le réseau (port 4173) |
| `npm run sprites` | refaire les sprites depuis `assets/originaux/` |
| `npm run icones` | refaire les icônes de l'appli |
