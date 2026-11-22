import * as THREE from "three";
import { CIRCUITS } from "./circuits.js";
import { construirePiste } from "./piste.js";
import { construireDecor } from "./decor.js";
import { creerKart, KARTS } from "./karts.js";
import { creerPilote, PERSONNAGES } from "./pilote.js";
import { KartPhysique, REGLAGES } from "./physique.js";
import { PiloteIA } from "./ia.js";
import { CameraPoursuite } from "./camera.js";
import { Particules } from "./particules.js";
import { liberer } from "./liberer.js";
import { audio } from "./audio.js";
import { Bonbons } from "./bonbons.js";
import { construireInterieur, AMBIANCE_INTERIEUR } from "./interieur.js";

export const TOURS = 3;
const DUREE_DECOMPTE = 3.6; // 3, 2, 1, Partez !
const RAYON_KART = 1.1;

/** Vitesse de base des adversaires selon la difficulté (le joueur = 1). */
const VITESSE_IA = { facile: 0.78, normal: 0.92, rapide: 1.0 };
/**
 * Élastique selon la difficulté (écarts en tours) :
 * - attente : au-delà de cette avance sur l'enfant, l'adversaire ralentit nettement ;
 * - zone / plafond : à partir de cet écart, l'adversaire ne dépasse pas (vitesse moyenne de l'enfant × plafond).
 */
const ELASTIQUE = {
  facile: { attente: 0.01, zone: -0.03, plafond: 0.85 },
  normal: { attente: 0.02, zone: -0.01, plafond: 0.95 },
  rapide: { attente: 0.06, zone: 0.02, plafond: 1.12 },
};

function melanger(liste) {
  const l = [...liste];
  for (let i = l.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [l[i], l[j]] = [l[j], l[i]];
  }
  return l;
}

/**
 * Une course : le circuit, le joueur et les 4 adversaires.
 * options : { circuit, perso, kart, modeAuto, difficulte }
 * quand : { decompte(n), tour(n), classement(liste), arrivee(place), podium(classement) }
 */
export class Course {
  constructor(options, controles, quand = {}) {
    this.options = options;
    this.controles = controles;
    this.quand = quand;
    this.t = 0;
    this.etat = "decompte"; // decompte | course | arrivee | podium
    this.chrono = 0;
    this.arrivees = []; // karts dans l'ordre d'arrivée

    const scene = (this.scene = new THREE.Scene());
    this.camera = new THREE.PerspectiveCamera(66, 1, 0.3, 1000);
    const ciel = new THREE.HemisphereLight(0xffffff, 0x6a8f4a, 2.2);
    scene.add(ciel);
    const soleil = new THREE.DirectionalLight(0xffffff, 1.6);
    soleil.position.set(60, 100, 40);
    scene.add(soleil);

    const def = (this.def = CIRCUITS[options.circuit] ?? CIRCUITS.prairie);
    scene.fog = new THREE.Fog(def.ciel.horizon, 160, 620);
    if (def.lumiere) {
      ciel.intensity = def.lumiere;
      soleil.intensity = def.lumiere * 0.6;
    }
    this.piste = construirePiste(def);
    scene.add(this.piste.groupe);
    this.decor = construireDecor(def, this.piste);
    scene.add(this.decor.groupe);
    this.lumieres = { ciel, soleil };
    // le ventre du T-rex (circuit à part, loin du monde principal)
    if (def.decor === "dino") {
      this.interieur = construireInterieur();
      scene.add(this.interieur.groupe);
      this.bonbonsInterieur = new Bonbons(scene, this.interieur.piste);
      this.dureeVentre = this.interieur.piste.L / 19; // temps pour en faire le tour
    }

    // --- les 5 pilotes : le joueur part 3e, au milieu de la grille ---
    const adversaires = PERSONNAGES.filter((p) => p !== options.perso);
    const kartsIA = melanger(KARTS.filter((k) => k !== options.kart));
    const base = VITESSE_IA[options.difficulte] ?? VITESSE_IA.normal;
    const ordre = [adversaires[0], adversaires[1], options.perso, adversaires[2], adversaires[3]];
    const melangeIA = melanger(adversaires);
    let n = 0;
    this.karts = ordre.map((perso, rang) => {
      const joueur = perso === options.perso;
      const p = joueur ? perso : melangeIA[n];
      const type = joueur ? options.kart : kartsIA[n++];
      const modele = creerKart(type);
      const pilote = creerPilote(p);
      modele.siege.add(pilote.mesh);
      scene.add(modele.groupe);
      const phys = new KartPhysique(this.piste);
      const lateral = rang % 2 ? -3.5 : 3.5;
      phys.placer(6 + rang * 5, lateral);
      const k = { perso: p, type, joueur, modele, pilote, phys, ia: new PiloteIA(phys, lateral), fini: false };
      if (joueur) phys.assistance = 0.4;
      else {
        k.vitesseBase = base * (0.97 + Math.random() * 0.06);
        phys.facteur = k.vitesseBase;
      }
      return k;
    });
    this.joueur = this.karts.find((k) => k.joueur);
    this.phys = this.joueur.phys; // raccourci (tests)

    this.bonbons = new Bonbons(scene, this.piste);
    this.nbBonbons = 0;
    this.cam = new CameraPoursuite(this.camera);
    this.particules = new Particules(scene);
    this.tourAffiche = 0;
    this.decompteAffiche = null;
    this.prochainClassement = 0;
    this.vitesseJoueurMoy = 0.7;
    this.dernierChoc = 0;
    this.chocsVus = 0;
    this.sautsVus = 0;
    this.atterrissagesVus = 0;
  }

  redimensionner(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Classement : d'abord les arrivés (dans l'ordre), puis par progression. */
  classement() {
    const enCourse = this.karts.filter((k) => !k.fini).sort((a, b) => this.progression(b) - this.progression(a));
    return [...this.arrivees, ...enCourse];
  }

  /** Progression sur le circuit principal (figée pendant qu'on est dans le ventre). */
  progression(k) {
    return (k.physPrincipale ?? k.phys).progression;
  }

  etape(dt, entreeForcee) {
    this.t += dt;
    const joueur = this.joueur;

    // --- départ : 3, 2, 1, Partez ! ---
    if (this.etat === "decompte") {
      this.chrono += dt;
      const n = Math.max(0, 3 - Math.floor(this.chrono / (DUREE_DECOMPTE / 4)));
      if (n !== this.decompteAffiche) {
        this.decompteAffiche = n;
        this.quand.decompte?.(n);
      }
      if (this.chrono >= (DUREE_DECOMPTE * 3) / 4) this.etat = "course";
    }

    // --- pilotes ---
    if (this.etat !== "decompte") {
      // vitesse moyenne de l'enfant *le long de la piste* sur ~4 s (pour l'élastique) :
      // un kart qui zigzague roule vite mais avance peu.
      const prog = this.progression(joueur);
      if (this.progPrecedente !== undefined && dt > 0) {
        const vj = Math.max(0, ((prog - this.progPrecedente) * this.piste.L) / dt / REGLAGES.vitesseMax);
        if (vj < 3) this.vitesseJoueurMoy += (vj - this.vitesseJoueurMoy) * Math.min(1, dt / 4);
      }
      this.progPrecedente = prog;
      for (const k of this.karts) {
        let entree;
        if (k.joueur && this.etat === "course") entree = entreeForcee ?? this.controles.etat(this.options.modeAuto);
        else entree = k.ia.entree(dt);
        if (!k.joueur) this.elastique(k, dt);
        if (k.mange > 0) {
          this.digerer(k, dt);
          continue;
        }
        // passage scripté en cours (looping, ptérodactyle...) : il pilote le kart à la place de la physique
        if (k.scenario) {
          if (k.scenario.etape(dt)) k.scenario = null;
        } else {
          k.phys.update(dt, entree);
          this.croquer(k);
          this.verifierPassages(k);
        }
        if (!k.fini && k.phys.tour > TOURS) {
          k.fini = true;
          this.arrivees.push(k);
        }
      }
      this.collisions();
      // sortie du ventre : un tour du circuit intérieur et on passe la porte
      if (joueur.dedans && joueur.phys.tour >= 1) this.sortirDuVentre(joueur);
      if (joueur.phys.sauts !== this.sautsVus) {
        this.sautsVus = joueur.phys.sauts;
        audio.saut();
      }
      if (joueur.phys.atterrissages !== this.atterrissagesVus) {
        this.atterrissagesVus = joueur.phys.atterrissages;
        audio.atterrissage();
        for (let n = 0; n < 4; n++) this.particules.emettre(joueur.phys.x, joueur.phys.y + 0.3, joueur.phys.z, 0xffffff, 1, 0.5);
      }
      if (joueur.phys.chocs !== this.chocsVus) {
        this.chocsVus = joueur.phys.chocs;
        audio.choc();
      }
    }

    // --- arrivée du joueur ---
    if (this.etat === "course" && joueur.fini) {
      this.etat = "arrivee";
      this.chrono = 0;
      this.quand.arrivee?.(this.arrivees.indexOf(joueur) + 1);
    } else if (this.etat === "arrivee") {
      this.chrono += dt;
      if (this.chrono > 3) {
        this.etat = "podium";
        this.quand.podium?.(this.classement());
      }
    }

    // --- interface ---
    const tour = THREE.MathUtils.clamp((joueur.physPrincipale ?? joueur.phys).tour, 1, TOURS);
    if (tour !== this.tourAffiche) {
      this.tourAffiche = tour;
      this.quand.tour?.(tour);
    }
    this.prochainClassement -= dt;
    if (this.prochainClassement <= 0) {
      this.prochainClassement = 0.25;
      this.quand.classement?.(this.classement());
    }

    // --- bonbons (seul l'enfant les ramasse) ---
    let pris = this.bonbons.update(dt, this.etat === "course" && !joueur.dedans ? joueur.phys : null);
    if (this.bonbonsInterieur) pris += this.bonbonsInterieur.update(dt, joueur.dedans ? joueur.phys : null);
    this.interieur?.animer(dt);
    if (pris > 0) {
      this.nbBonbons += pris;
      joueur.phys.boost = 0.8;
      joueur.phys.vitesse += 1.5;
      audio.bonbon();
      this.quand.bonbons?.(this.nbBonbons);
    }

    // --- visuels ---
    for (const k of this.karts) this.majVisuel(k, dt);
    this.particulesJoueur();
    this.particules.update(dt);

    const vRel = joueur.phys.vitesse / REGLAGES.vitesseMax;
    if (!joueur.scenario?.camera?.(this.cam, dt)) this.cam.update(dt, joueur.phys.x, joueur.phys.z, joueur.phys.angle, vRel, joueur.phys.y);
    this.decor.ciel.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.decor.animer(dt, this.camera);
    for (const k of this.karts) {
      k.modele.groupe.updateMatrixWorld();
      k.pilote.orienter(this.camera, k.phys.angle + k.modele.corps.rotation.y, k.phys.angle);
    }
  }

  /**
   * Passages scriptés posés par le décor dans piste.passages : chacun a
   * verifier(k, course) qui renvoie un scénario (ou null) quand le kart y entre.
   * Un scénario { etape(dt) -> true quand fini, visuel?(k), camera?(cam, dt) -> true s'il gère la caméra }
   * déplace lui-même k.phys (x, y, z, angle, indice, et garde tour/progression cohérents).
   */
  verifierPassages(k) {
    if (k.dedans) return;
    for (const p of this.piste.passages ?? []) {
      const sc = p.verifier(k, this);
      if (sc) {
        k.scenario = sc;
        return;
      }
    }
  }

  /** Le kart arrive devant la gueule du T-rex : il est croqué. */
  croquer(k) {
    const t = this.piste.teteTrex;
    if (!t || k.dedans) return;
    const p = this.piste, ph = k.phys, i = t.indice;
    const gueule = t.distanceGueule ?? 15; // bord avant de la gueule, en mètres avant le centre de la tête
    const d = (i - ph.indice + p.N) % p.N;
    if (d > (gueule + 5) / p.pas) return;
    // distance exacte le long de la route jusqu'au centre de la tête (au sol comme en plein saut)
    const reste = (p.cx[i] - ph.x) * p.tx[i] + (p.cz[i] - ph.z) * p.tz[i];
    if (reste > gueule - 1) return; // croqué une fois bien entré dans la gueule
    k.distanceCroc = reste; // (pour les essais)
    // l'enfant visite le ventre ; les adversaires y passent "invisibles" le même temps
    k.mange = this.interieur ? (k.joueur ? 0.55 : 0.55 + this.dureeVentre) : 1.1;
    k.versVentre = Boolean(this.interieur && k.joueur);
    k.modele.groupe.visible = false;
    if (k.joueur) {
      audio.croc?.();
      this.quand.croc?.();
    }
  }

  /** Pendant qu'il est dans la gueule ; puis le T-rex le recrache derrière lui. */
  digerer(k, dt) {
    k.mange -= dt;
    if (k.mange > 0) return;
    if (k.versVentre) {
      k.versVentre = false;
      this.entrerDansLeVentre(k);
      return;
    }
    const p = this.piste, i = p.teteTrex.recrache, ph = k.phys;
    const tourAvant = ph.tour;
    ph.x = p.cx[i];
    ph.z = p.cz[i];
    ph.angle = p.angleA(i);
    ph.indice = i;
    ph.tour = tourAvant;
    ph.vitesse = 18;
    ph.y = 2;
    ph.vy = 5;
    ph.enLair = true;
    ph.xAvant = ph.x;
    ph.zAvant = ph.z;
    k.modele.groupe.visible = true;
    if (k.joueur) this.cam.angle = null;
  }

  /** Ambiance : sombre dans le ventre, normale dehors. */
  ambiance(dedans) {
    const sc = this.scene, L = this.lumieres;
    if (!this.ambianceDehors) {
      this.ambianceDehors = {
        fond: sc.background, brouillard: [sc.fog.color.getHex(), sc.fog.near, sc.fog.far],
        ciel: [L.ciel.color.getHex(), L.ciel.groundColor.getHex(), L.ciel.intensity], soleil: L.soleil.intensity,
      };
    }
    const a = dedans ? AMBIANCE_INTERIEUR : this.ambianceDehors;
    sc.background = dedans ? new THREE.Color(a.fond) : a.fond;
    sc.fog.color.setHex(a.brouillard[0]);
    sc.fog.near = a.brouillard[1];
    sc.fog.far = a.brouillard[2];
    L.ciel.color.setHex(a.ciel[0]);
    L.ciel.groundColor.setHex(a.ciel[1]);
    L.ciel.intensity = a.ciel[2];
    L.soleil.intensity = a.soleil;
    this.decor.ciel.visible = !dedans;
  }

  /** Le kart tombe dans le ventre du T-rex : on bascule sur le circuit intérieur. */
  entrerDansLeVentre(k) {
    const P = this.interieur.piste;
    k.physPrincipale = k.phys;
    const ph = new KartPhysique(P);
    ph.placer(P.N - 6, 0); // juste après la porte
    ph.assistance = k.physPrincipale.assistance;
    ph.y = 3;
    ph.vy = 0;
    ph.enLair = true;
    ph.vitesse = 10;
    ph.xAvant = ph.x;
    ph.zAvant = ph.z;
    k.phys = ph;
    k.dedans = true;
    k.modele.groupe.visible = true;
    this.cam.angle = null;
    this.ambiance(true);
  }

  /** On passe la porte : retour sur la route, derrière le T-rex. */
  sortirDuVentre(k) {
    const vitesse = Math.max(12, k.phys.vitesse);
    const ph = k.physPrincipale, p = this.piste, i = p.teteTrex.recrache;
    k.phys = ph;
    k.physPrincipale = null;
    k.dedans = false;
    ph.x = p.cx[i];
    ph.z = p.cz[i];
    ph.angle = p.angleA(i);
    ph.indice = i;
    ph.vitesse = vitesse;
    ph.y = 0;
    ph.enLair = false;
    ph.xAvant = ph.x;
    ph.zAvant = ph.z;
    this.cam.angle = null;
    this.ambiance(false);
    this.quand.sortie?.();
  }

  /** Élastique discret : les adversaires attendent l'enfant s'il est loin derrière,
   *  et accélèrent un peu s'il est très loin devant. */
  elastique(k, dt) {
    let f = k.vitesseBase;
    if (!this.joueur.fini && !k.fini) {
      const ecart = this.progression(k) - this.progression(this.joueur); // en tours
      const e = ELASTIQUE[this.options.difficulte] ?? ELASTIQUE.normal;
      if (ecart > e.attente) f *= Math.max(0.45, 1 - (ecart - e.attente) * 3.5);
      else if (ecart < -0.06) f *= Math.min(1.12, 1 + (-ecart - 0.06) * 1.5);
      // près de l'enfant : pas plus vite que lui (en moyenne le long de la piste)
      if (ecart > e.zone) f = Math.min(f, Math.max(0.3, this.vitesseJoueurMoy * e.plafond));
    }
    k.phys.facteur += (f - k.phys.facteur) * Math.min(1, dt * 0.8);
  }

  /** Chocs doux entre karts : on les écarte et on donne une petite poussée. */
  collisions() {
    // obstacles du décor (ronds) : on repousse doucement le kart
    for (const ob of this.decor.obstacles) {
      for (const k of this.karts) {
        const P = k.phys;
        const dx = P.x - ob.x, dz = P.z - ob.z;
        const min = ob.r + RAYON_KART;
        const d2 = dx * dx + dz * dz;
        if (d2 > min * min || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        P.x = ob.x + (dx / d) * min;
        P.z = ob.z + (dz / d) * min;
        P.poussee.x += (dx / d) * 3;
        P.poussee.z += (dz / d) * 3;
        P.vitesse *= 0.9;
      }
    }
    const ks = this.karts;
    for (let a = 0; a < ks.length; a++)
      for (let b = a + 1; b < ks.length; b++) {
        const A = ks[a].phys, B = ks[b].phys;
        const dx = B.x - A.x, dz = B.z - A.z;
        const d2 = dx * dx + dz * dz;
        const min = RAYON_KART * 2;
        if (d2 > min * min || d2 < 1e-6 || Math.abs(A.y - B.y) > 1) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, nz = dz / d;
        const recouvre = (min - d) / 2;
        A.x -= nx * recouvre; A.z -= nz * recouvre;
        B.x += nx * recouvre; B.z += nz * recouvre;
        A.poussee.x -= nx * 2.5; A.poussee.z -= nz * 2.5;
        B.poussee.x += nx * 2.5; B.poussee.z += nz * 2.5;
        // celui qui est derrière perd un tout petit peu de vitesse
        const derriere = Math.sin(A.angle) * nx + Math.cos(A.angle) * nz > 0 ? A : B;
        derriere.vitesse *= 0.97;
        if ((A === this.joueur.phys || B === this.joueur.phys) && this.t - this.dernierChoc > 0.5) {
          this.dernierChoc = this.t;
          audio.choc();
        }
      }
  }

  majVisuel(k, dt) {
    const { phys, modele } = k;
    const vRel = phys.vitesse / REGLAGES.vitesseMax;
    modele.groupe.position.set(phys.x, phys.y, phys.z);
    modele.corps.rotation.x += (phys.pente - modele.corps.rotation.x) * Math.min(1, dt * 10);
    // l'ombre reste au sol et rapetisse quand on saute
    const hauteurVol = phys.y - phys.ySol;
    modele.ombre.position.y = 0.05 - hauteurVol;
    modele.ombre.scale.set(2.4, 1, 3.4).multiplyScalar(1 / (1 + hauteurVol * 0.3));
    modele.groupe.rotation.y = phys.angle;
    const derapage = -phys.direction * 0.32 * THREE.MathUtils.clamp(vRel, 0, 1);
    modele.corps.rotation.y += (derapage - modele.corps.rotation.y) * Math.min(1, dt * 6);
    modele.corps.rotation.z = phys.direction * 0.07 * Math.max(0, vRel);
    const bosses = phys.dansHerbe ? 0.05 : 0.012;
    modele.corps.position.y = Math.abs(Math.sin(this.t * 22 + phys.x)) * bosses * Math.min(1, Math.abs(vRel) * 2);
    for (const r of modele.roues.avant) {
      r.tourne.rotation.x += (phys.vitesse * dt) / r.rayon;
      r.pivot.rotation.y = -phys.direction * 0.45;
    }
    for (const r of modele.roues.arriere) r.tourne.rotation.x += (phys.vitesse * dt) / r.rayon;
    if (k.mange > 0) modele.groupe.visible = false;
    else modele.groupe.visible = phys.clignote > 0 ? Math.floor(this.t * 12) % 2 === 0 : true;
    k.scenario?.visuel?.(k);
  }

  particulesJoueur() {
    if (Math.random() > 0.5) return;
    const phys = this.joueur.phys;
    const vRel = phys.vitesse / REGLAGES.vitesseMax;
    const ax = Math.sin(phys.angle), az = Math.cos(phys.angle);
    const cote = Math.random() < 0.5 ? 1 : -1;
    const px = phys.x - ax * 1.1 + az * 0.9 * cote, pz = phys.z - az * 1.1 - ax * 0.9 * cote;
    if (phys.dansHerbe && Math.abs(phys.vitesse) > 3) this.particules.emettre(px, 0.3, pz, this.def.horsPiste, 0.7, 0.5);
    else if (Math.abs(phys.direction) > 0.6 && vRel > 0.6) this.particules.emettre(px, 0.3, pz, 0xffffff, 0.8, 0.5);
  }

  liberer() {
    liberer(this.piste.groupe, true);
    liberer(this.decor.groupe, true);
    this.bonbons.mesh.material.dispose(); // la forme du bonbon est partagée, on la garde
    for (const k of this.karts) liberer(k.modele.groupe);
    if (this.interieur) liberer(this.interieur.groupe, true);
  }
}
