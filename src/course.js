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
/** Ventre du T-rex : adversaires montrés dans le tunnel s'ils sont à moins de tant de secondes de l'enfant. */
const VENTRE_FENETRE_DEVANT = 8;
const VENTRE_FENETRE_DERRIERE = 10;

/**
 * Entrée dans la gueule du T-rex (vue de l'enfant) : le noir se referme sur la gueule pendant
 * que le kart y vole (en mètres par rapport au bord avant de la gueule), puis on est dedans :
 * un court moment sans lumière, et l'intérieur s'ouvre autour du kart qui roule déjà.
 */
const VOILE_DEBUT = 8; // le noir commence à se refermer 8 m avant les dents...
const VOILE_FIN = 2.5; // ...et il est complet 2,5 m dans la gueule : c'est là qu'on est croqué
const NOIR_TENU = 0.12; // secondes de noir complet
const NOIR_FONDU = 0.4; // secondes pour que l'intérieur apparaisse
const lisse = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

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
    this.noirRestant = 0; // fondu du noir après l'entrée dans le ventre
    this.voileAffiche = 0;

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
    this.piste.humains = this.karts.filter((k) => k.joueur); // suivis par le décor (ex. le brachiosaure qui fait coucou)
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

  /**
   * Progression sur le circuit principal. Dans le T-rex, on avance en douceur de la gueule
   * jusqu'au point où l'on ressort, au rythme de la traversée (k.ventre.f de 0 à 1) :
   * pas de saut de place à l'entrée ni à la sortie, et la mini-carte suit la même règle.
   */
  progression(k) {
    const v = k.ventre;
    if (v) return v.debut + (v.ecart / this.piste.N) * v.f;
    const ph = k.physPrincipale ?? k.phys, p = this.piste, i = ph.indice;
    if (ph.piste !== p || i < 0) return ph.progression;
    // + la position entre deux points du tracé : deux karts au même point ne s'échangent pas sans cesse
    const fin = ((ph.x - p.cx[i]) * p.tx[i] + (ph.z - p.cz[i]) * p.tz[i]) / p.pas;
    return ph.progression + THREE.MathUtils.clamp(fin, -0.5, 0.5) / p.N;
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
      // un kart qui zigzague roule vite mais avance peu. (Moyenne gardée telle quelle dans le T-rex.)
      const prog = this.progression(joueur);
      if (this.progPrecedente !== undefined && dt > 0 && !joueur.ventre) {
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
    this.placerDansVentre(dt);
    for (const k of this.karts) this.majVisuel(k, dt);
    this.particulesJoueur();
    this.particules.update(dt);

    const vRel = joueur.phys.vitesse / REGLAGES.vitesseMax;
    if (!joueur.scenario?.camera?.(this.cam, dt)) this.cam.update(dt, joueur.phys.x, joueur.phys.z, joueur.phys.angle, vRel, joueur.phys.y);
    this.majVoile(dt);
    this.decor.ciel.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.decor.animer(dt, this.camera);
    for (const k of this.karts) {
      k.modele.groupe.updateMatrixWorld();
      const angle = (this.physAffichee(k) ?? k.phys).angle;
      k.pilote.orienter(this.camera, angle + k.modele.corps.rotation.y, angle);
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
    if (!t) return;
    if (k.dedans) {
      // dans le ventre : on avance sur la mini-carte (et au classement) au rythme du tour intérieur
      const P = k.phys.piste, depart = this.departVentre;
      const q = (k.phys.tour * P.N + k.phys.indice - depart) / (P.N - depart);
      k.ventre.f = Math.max(k.ventre.f, Math.min(1, Math.max(0, q)));
      return;
    }
    const reste = this.resteGueule(k.phys);
    if (reste === null || reste > -VOILE_FIN) return; // croqué une fois bien entré dans la gueule
    const p = this.piste, ph = k.phys;
    k.distanceCroc = reste + (t.distanceGueule ?? 15); // jusqu'au centre de la tête (pour les essais)
    // la traversée, vue du circuit principal : de la gueule jusqu'au point où l'on est recraché
    k.ventre = {
      debut: this.progression(k), ecart: (t.recrache - ph.indice + p.N) % p.N, i0: ph.indice, f: 0,
      dx: ph.x - p.cx[ph.indice], dz: ph.z - p.cz[ph.indice], // écart à la ligne du milieu (s'efface)
    };
    if (k.joueur && this.interieur) {
      // l'enfant passe tout de suite dans le ventre, sans s'arrêter : le noir cache la bascule
      audio.croc?.();
      this.entrerDansLeVentre(k);
      return;
    }
    // les adversaires ne roulent pas vraiment dans le ventre : ils le traversent en à peu près le
    // temps que met l'enfant ; on les montre dans le ventre quand l'enfant y est (voir placerDansVentre)
    k.mange = k.ventre.duree = this.interieur ? this.dureeVentreIA() : 1.1;
    if (this.interieur) {
      const lim = this.interieur.piste.demi - 1.5;
      k.ventre.voie = THREE.MathUtils.clamp(k.ia.voie ?? 0, -lim, lim); // sa voie dans le tunnel
    }
    k.modele.groupe.visible = false;
  }

  /**
   * Temps passé dans le T-rex par un adversaire : à peu près ce que met l'enfant qui entre
   * lancé et fait le tour du ventre à bonne allure (mesuré : ≈ 12 s), un peu plus pour être juste.
   */
  dureeVentreIA() {
    return this.dureeVentre - 0.4;
  }

  /**
   * Distance (le long de la route) entre le kart et le bord avant de la gueule :
   * positive avant les dents, négative dedans ; null si le kart n'est pas dans l'entonnoir.
   */
  resteGueule(ph) {
    const t = this.piste.teteTrex, p = this.piste, i = t.indice;
    const gueule = t.distanceGueule ?? 15; // bord avant de la gueule, en mètres avant le centre de la tête
    const d = (i - ph.indice + p.N) % p.N;
    if (d > (gueule + 10) / p.pas) return null;
    // distance exacte le long de la route jusqu'au centre de la tête (au sol comme en plein saut)
    return (p.cx[i] - ph.x) * p.tx[i] + (p.cz[i] - ph.z) * p.tz[i] - gueule;
  }

  /**
   * Le noir de la gueule (vue de l'enfant) : il se referme autour du kart pendant qu'il vole
   * vers les dents, reste complet un court instant, puis s'ouvre sur l'intérieur.
   * Envoyé à l'interface : quand.voile(force 0..1, x %, y %) avec le centre à l'écran.
   */
  majVoile(dt) {
    const j = this.joueur;
    let force = 0;
    if (this.noirRestant > 0) {
      this.noirRestant = Math.max(0, this.noirRestant - dt);
      force = lisse(this.noirRestant / NOIR_FONDU);
    } else if (this.piste.teteTrex && !j.dedans && !j.mange && !j.scenario && this.etat !== "decompte") {
      const reste = this.resteGueule(j.phys);
      if (reste !== null) force = THREE.MathUtils.clamp((VOILE_DEBUT - reste) / (VOILE_DEBUT + VOILE_FIN), 0, 1);
    }
    if (force === 0 && this.voileAffiche === 0) return;
    this.voileAffiche = force;
    // centre du cercle : entre le kart et le fond de la gueule pendant qu'on y vole,
    // puis sur le kart dans le ventre
    const v = (this._voile ??= new THREE.Vector3());
    v.set(j.phys.x, j.phys.y + 0.8, j.phys.z).project(this.camera);
    let sx = v.x, sy = v.y;
    const T = this.piste.teteTrex, tete = T?.objet;
    if (!j.dedans && tete) {
      const p = this.piste, i = T.indice, recul = (T.distanceGueule ?? 12) - 3;
      v.set(tete.position.x - p.tx[i] * recul, 4.5, tete.position.z - p.tz[i] * recul).project(this.camera);
      sx = (sx + v.x) / 2;
      sy = (sy + v.y) / 2;
    }
    const x = THREE.MathUtils.clamp((sx + 1) * 50, 10, 90), y = THREE.MathUtils.clamp((1 - sy) * 50, 10, 90);
    this.quand.voile?.(force, x, y);
  }

  /** Pendant qu'il est dans la gueule ; puis le T-rex le recrache derrière lui. */
  digerer(k, dt) {
    k.mange -= dt;
    if (k.ventre) k.ventre.f = Math.min(1, 1 - k.mange / k.ventre.duree);
    if (k.mange > 0) return;
    k.ventre = null;
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

  /**
   * Le kart file dans le ventre du T-rex : on bascule sur le circuit intérieur, en gardant
   * son élan (vitesse, hauteur du saut) ; la caméra se replace derrière lui pendant le noir.
   */
  entrerDansLeVentre(k) {
    const P = this.interieur.piste, avant = k.phys;
    k.physPrincipale = avant;
    const ph = new KartPhysique(P);
    ph.placer(P.N - 6, 0); // juste après la porte
    this.departVentre = ph.indice;
    ph.assistance = avant.assistance;
    ph.y = Math.max(0.6, avant.y); // il finit son saut dans le ventre
    ph.vy = Math.min(0, avant.vy);
    ph.enLair = true;
    ph.vitesse = Math.max(12, avant.vitesse);
    ph.boost = avant.boost;
    ph.xAvant = ph.x;
    ph.zAvant = ph.z;
    k.phys = ph;
    k.dedans = true;
    k.modele.groupe.visible = true;
    this.cam.angle = null;
    this.ambiance(true);
    this.noirRestant = NOIR_TENU + NOIR_FONDU;
  }

  /** On passe la porte : retour sur la route, derrière le T-rex. */
  sortirDuVentre(k) {
    const vitesse = Math.max(12, k.phys.vitesse);
    const ph = k.physPrincipale, p = this.piste, i = p.teteTrex.recrache;
    k.phys = ph;
    k.physPrincipale = null;
    k.dedans = false;
    k.ventre = null;
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
        if (ks[a].mange > 0 || ks[b].mange > 0) continue; // dans le T-rex : plus sur la route
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

  /**
   * Ce qu'on affiche d'un kart : sa vraie physique ; ou, pendant que l'enfant est dans le ventre,
   * sa place dans le tunnel s'il est proche de l'enfant au classement (voir placerDansVentre) ;
   * null : caché (dans la gueule, loin de l'enfant). Un kart n'a qu'un modèle : il est dessiné
   * soit sur la route, soit dans le ventre, jamais aux deux endroits.
   */
  physAffichee(k) {
    if (k.joueur) return k.phys;
    if (this.joueur.dedans && k.vueVentre?.visible) return k.vueVentre;
    return k.mange > 0 ? null : k.phys;
  }

  /**
   * Le ventre vivant. Les adversaires ne roulent pas vraiment dans le T-rex, et avec l'élastique
   * ils sont presque toujours juste derrière l'enfant : à leur vraie place, ils seraient derrière
   * la caméra (ou pas encore entrés) et l'enfant ne verrait jamais personne. Alors, tant que
   * l'enfant est dedans, chaque adversaire proche au classement (quelques secondes devant ou
   * derrière, sur la route ou dans le T-rex) est montré dans le tunnel, rapproché, mais dans
   * l'ordre du classement : ceux devant roulent devant l'enfant, ceux derrière arrivent à sa
   * hauteur sur le côté. Classement et mini-carte restent ceux de la vraie course.
   */
  placerDansVentre(dt) {
    const j = this.joueur;
    if (!this.interieur) return;
    if (!j.dedans) {
      for (const k of this.karts) k.vueVentre = null;
      return;
    }
    const P = this.interieur.piste, J = j.phys, lim = P.demi - 1.5;
    // où est l'enfant sur le tour intérieur (indice avec la fraction)
    const i = J.indice;
    const sJ = i + THREE.MathUtils.clamp(((J.x - P.cx[i]) * P.tx[i] + (J.z - P.cz[i]) * P.tz[i]) / P.pas, -0.5, 0.5);
    const vitesseRef = REGLAGES.vitesseMax * 0.85; // m/s : pour compter l'écart en secondes
    const progJ = this.progression(j);
    // écart réel (en mètres de route) de chaque adversaire, puis place visée dans le tunnel
    const devant = [], derriere = [];
    for (const k of this.karts) {
      if (k.joueur) continue;
      const ecart = (this.progression(k) - progJ) * this.piste.L;
      const proche = ecart > 0 ? ecart < VENTRE_FENETRE_DEVANT * vitesseRef : -ecart < VENTRE_FENETRE_DERRIERE * vitesseRef;
      k.vueVentreEcart = ecart;
      if (proche) (ecart > 0 ? devant : derriere).push(k);
      else if (k.vueVentre) k.vueVentre.cible = k.vueVentre.decalage > 0 ? 50 : -14; // il s'éloigne hors de vue
    }
    devant.sort((a, b) => a.vueVentreEcart - b.vueVentreEcart);
    derriere.sort((a, b) => b.vueVentreEcart - a.vueVentreEcart);
    // devant : à 7, 13, 19... m (un peu plus loin s'il a beaucoup d'avance) ;
    // derrière : les deux plus proches à la hauteur de l'enfant, sur les côtés ; les autres restent
    // derrière la caméra (7 m en arrière) : plus près d'elle, ils cacheraient tout l'écran.
    // Petit va-et-vient pour que ça bataille un peu.
    const balance = (k) => Math.sin(this.t * 0.7 + this.karts.indexOf(k) * 2.1);
    devant.forEach((k, n) => this.viserDansVentre(k, 7 + n * 6 + Math.min(6, k.vueVentreEcart * 0.04) + balance(k) * 0.8));
    derriere.forEach((k, n) => this.viserDansVentre(k, n < 2 ? -0.6 - n * 1.6 + balance(k) * 0.7 : -12));

    // on avance chacun vers sa place, puis on choisit sa voie sans toucher les autres, et sans se
    // mettre entre la caméra et l'enfant (de 9 m derrière lui à 4,5 m devant)
    const places = [{ d0: -9, d1: 4.5, lat: J.lateral, ecart: 2.9 }];
    const montres = this.karts.filter((k) => k.vueVentre).sort((a, b) => Math.abs(a.vueVentre.decalage) - Math.abs(b.vueVentre.decalage));
    for (const k of montres) {
      const v = k.vueVentre;
      v.decalage += (v.cible - v.decalage) * Math.min(1, dt * 1.5);
      if (v.cible <= -14 && v.decalage < -13) { k.vueVentre = null; continue; }
      if (v.cible >= 50 && v.decalage > 48) { k.vueVentre = null; continue; }
      let lat = THREE.MathUtils.clamp(v.lat, -lim, lim);
      for (let essai = 0; essai < 4; essai++) {
        const gene = places.find((p) => v.decalage > p.d0 && v.decalage < p.d1 && Math.abs(p.lat - lat) < p.ecart);
        if (!gene) break;
        const cote = lat >= gene.lat ? 1 : -1;
        lat = gene.lat + cote * gene.ecart;
        if (Math.abs(lat) > lim && gene === places[0]) {
          // l'enfant le serre contre la paroi : plutôt que de passer à travers lui, il se laisse
          // distancer (et repasse derrière la caméra)
          lat = cote * lim;
          v.cible = Math.min(v.cible, -12);
          break;
        }
        if (Math.abs(lat) > lim) lat = gene.lat - cote * gene.ecart;
        lat = THREE.MathUtils.clamp(lat, -lim, lim);
      }
      places.push({ d0: v.decalage - 4.5, d1: v.decalage + 4.5, lat, ecart: 2.6 });
      v.lat += (lat - v.lat) * Math.min(1, dt * 3);
      // position sur le circuit intérieur
      const s = (((sJ + v.decalage / P.pas) % P.N) + P.N) % P.N;
      const i0 = Math.floor(s) % P.N, i1 = (i0 + 1) % P.N, u = s - Math.floor(s);
      const a0 = P.angleA(i0), da = Math.atan2(Math.sin(P.angleA(i1) - a0), Math.cos(P.angleA(i1) - a0));
      const x0 = P.cx[i0] + P.nx[i0] * v.lat, z0 = P.cz[i0] + P.nz[i0] * v.lat;
      v.x = x0 + (P.cx[i1] + P.nx[i1] * v.lat - x0) * u;
      v.z = z0 + (P.cz[i1] + P.nz[i1] * v.lat - z0) * u;
      v.chute = Math.max(0, v.chute - dt);
      v.y = 2.2 * (v.chute / 0.45) ** 2; // il tombe dans le ventre comme l'enfant
      v.angle = a0 + da * u;
      v.vitesse = Math.max(8, J.vitesse + (v.decalage - (v.avant ?? v.decalage)) / Math.max(dt, 1e-3));
      v.avant = v.decalage;
      v.direction = THREE.MathUtils.clamp(-da * 6, -1, 1); // braque un peu dans les virages
      v.visible = true;
    }
  }

  /** Place visée dans le tunnel (mètres devant + / derrière - l'enfant) ; il arrive hors de vue. */
  viserDansVentre(k, decalage) {
    if (!k.vueVentre) {
      const lim = this.interieur.piste.demi - 1.5;
      const voie = THREE.MathUtils.clamp(k.ventre?.voie ?? k.ia.voie ?? 0, -lim, lim);
      // à l'entrée de l'enfant (pendant le noir), chacun est déjà à sa place ; ensuite, un
      // nouveau venu arrive de derrière la caméra ou du fond du tunnel
      const entree = this.noirRestant > 0;
      k.vueVentre = {
        decalage: entree ? decalage : decalage > 0 ? 45 : -13, avant: undefined, voie, lat: voie,
        chute: entree ? 0.45 : 0, ySol: 0, pente: 0, direction: 0, dansHerbe: false, clignote: 0, visible: false,
      };
    }
    k.vueVentre.cible = decalage;
  }

  majVisuel(k, dt) {
    const { modele } = k;
    const phys = this.physAffichee(k);
    if (!phys) {
      modele.groupe.visible = false; // dans la gueule, loin de l'enfant
      return;
    }
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
    modele.groupe.visible = phys.clignote > 0 ? Math.floor(this.t * 12) % 2 === 0 : true;
    // montré dans le ventre : à plat dans le tunnel, sans le passage scripté qu'il fait sur la route
    if (phys !== k.phys) modele.groupe.rotation.set(0, phys.angle, 0);
    else k.scenario?.visuel?.(k);
  }

  particulesJoueur() {
    if (Math.random() > 0.5) return;
    const phys = this.joueur.phys;
    const vRel = phys.vitesse / REGLAGES.vitesseMax;
    const ax = Math.sin(phys.angle), az = Math.cos(phys.angle);
    const cote = Math.random() < 0.5 ? 1 : -1;
    const px = phys.x - ax * 1.1 + az * 0.9 * cote, pz = phys.z - az * 1.1 - ax * 0.9 * cote;
    if (phys.dansHerbe && Math.abs(phys.vitesse) > 3) this.particules.emettre(px, phys.ySol + 0.3, pz, this.def.horsPiste, 0.7, 0.5); // ySol : route abaissée (tranchée)
    else if (Math.abs(phys.direction) > 0.6 && vRel > 0.6) this.particules.emettre(px, phys.ySol + 0.3, pz, 0xffffff, 0.8, 0.5);
  }

  liberer() {
    if (this.voileAffiche > 0) this.quand.voile?.(0, 50, 50);
    liberer(this.piste.groupe, true);
    liberer(this.decor.groupe, true);
    this.bonbons.mesh.material.dispose(); // la forme du bonbon est partagée, on la garde
    for (const k of this.karts) liberer(k.modele.groupe);
    if (this.interieur) liberer(this.interieur.groupe, true);
  }
}
