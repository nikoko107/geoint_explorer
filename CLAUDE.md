# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# GeoINT Explorer

## Contexte projet

Application web de **support au travail GEOINT** (Geographic Intelligence), entièrement statique, hébergée sur GitHub Pages. Aucun backend. Toutes les données sont stockées en `localStorage`.

L'objectif central : **ne jamais perdre le fil de son analyse géographique**. L'outil doit mémoriser où l'utilisateur est passé, à quel zoom, ce qu'il a annoté, et l'état d'avancement de son travail — organisé par projet.

---

## Stack technique

| Composant | Choix | Justification |
|---|---|---|
| Carte | **MapLibre GL JS** (CDN) | Rendu vectoriel + raster, support WMTS IGN, performances |
| Géocodage | **API Adresse (adresse.data.gouv.fr)** | Gratuit, CORS ouvert, haute précision France |
| Couches raster | **IGN Géoplateforme WMTS** | PCRS, HR 20cm, ortho, scan, cadastre |
| Persistance | **localStorage** | Pas de backend, survit à la fermeture du navigateur |
| Export | **GeoJSON + CSV** | Natif browser via Blob + URL.createObjectURL |
| UI | **HTML/CSS/JS vanilla** | Zéro dépendance build, compatible GitHub Pages direct |

> Pas de React, pas de bundler, pas de Node. Fichiers servis tels quels depuis GitHub Pages.

## Développement local

Aucune étape de build. Servir le répertoire racine avec n'importe quel serveur HTTP statique supportant ES Modules :

```bash
# Python (intégré)
python3 -m http.server 8080

# Node (npx, sans installation globale)
npx serve .

# VS Code : extension "Live Server" suffit
```

> Ne pas ouvrir `index.html` directement via `file://` — les imports ES Modules échouent sans serveur HTTP (restriction CORS du navigateur).

### Point d'attention GitHub Pages + ES Modules

Tous les fichiers JS utilisent `type="module"`. GitHub Pages sert correctement le MIME type `application/javascript` pour les `.js`, mais les imports relatifs doivent utiliser des extensions explicites (`./modules/layers.js` et non `./modules/layers`). Ne pas utiliser de bare imports (ex: `import x from 'maplibre-gl'` sans CDN URL).

---

## Architecture des fichiers

```
geoint-explorer/
├── index.html
├── style.css
├── app.js                  ← point d'entrée, init cartes, géocodage, séparateur
├── modules/
│   ├── storage.js          ← abstraction localStorage avec gestion quota
│   ├── projects.js         ← gestion des projets (création, switch, suppression, import/export)
│   ├── layers.js           ← couches IGN + Google, sélecteur, opacité, mode comparaison
│   ├── tracker.js          ← journal de navigation automatique
│   ├── annotations.js      ← annotations (mode, popup, markers, filtre)
│   ├── tracking-zones.js   ← zones manuelles à traiter / traitées (polygones)
│   ├── measure.js          ← mesure linéaire (haversine, clic/double-clic, barre flottante)
│   ├── overpass.js         ← requêtes Overpass API (OSM), import POI → annotations
│   └── export.js           ← export GeoJSON / CSV / projet JSON complet
└── README.md
```

---

## Layout général

```
┌─────────────────────────────────────────────────────────────┐
│  PROJET : [Projet actif ▼]  [+ Nouveau]  [🗑]               │
├──────────────────────────┬──────────────────────────────────┤
│  [🔍 Recherche overlay]  │                                  │
│    CARTE D'ANALYSE       │    CARTE DE SUIVI                │
│    (travail en cours)    │    (avancement global)           │
│                          │                                  │
│  ← séparateur draggable →│                                  │
├──────────────────────────┴──────────────────────────────────┤
│ [Couches] [📌 Annoter] [≡ Annotations] [✏ Zone] [≡ Zones]  │
│ [📐 Mesure] [↺ Reset] [🚶 Street View] [📷 Mapillary]       │
│ [↓ GeoJSON] [↓ CSV] [↓ Projet] [↑ Projet]                  │
└─────────────────────────────────────────────────────────────┘
```

- **Carte d'analyse** (gauche) — navigation libre, couches IGN/Google, annotations, rectangle de capture. Le champ de recherche est en overlay haut-gauche de la carte.
- **Carte de suivi** (droite) — fond CARTO dark + labels villes/routes au-dessus des couches de suivi, historique de couverture, zones à traiter/traitées. Les contours des zones sont également visibles sur la carte d'analyse.
- **Séparateur** — draggable pour redimensionner les deux volets ; double-clic pour revenir au 50/50.
- La carte de suivi reste **centrée sur la carte d'analyse** en permanence.

Sur écran < 900px : layout vertical (carte d'analyse au-dessus, carte de suivi en dessous, hauteur 50vh chacune).

---

## Module : Projets

Un **projet** regroupe annotations, journal de navigation et zones de suivi pour une mission d'analyse donnée. Plusieurs projets peuvent coexister dans le localStorage.

### Comportement

- Au premier lancement : création automatique d'un projet par défaut nommé `"Projet 1"`
- Barre de projet en haut de l'interface : dropdown de sélection + bouton créer + bouton supprimer
- Chaque projet est **isolé** : changer de projet recharge les données correspondantes sur les deux cartes
- La suppression d'un projet est irréversible — demander confirmation avant d'exécuter
- **Export projet** : bouton **↓ Projet** — sauvegarde complète en JSON (annotations, zones, navLog, layerConfig, lastView) avec champ `geoint_export_version` pour valider le format à l'import
- **Import projet** : bouton **↑ Projet** — crée un **nouveau** projet depuis le fichier JSON (ne remplace pas le projet actif), bascule automatiquement vers lui ; affiche une erreur dans le bandeau si le fichier est invalide

### Structure de données

Chaque projet est stocké sous une clé distincte : `geoint_project_{id}`. Un index global liste les projets disponibles sous la clé `geoint_index`.

Chaque projet contient au minimum : `id`, `name`, `createdAt`, `lastView` (centre + zoom de la carte d'analyse), `layerConfig`, `annotations`, `navLog`, `trackingZones`, `streetviewVisits`.

Ne pas rigidifier le schéma JSON au-delà de ces champs — laisser de la flexibilité pour les évolutions.

---

## Module : Couches IGN

### Endpoint WMTS Géoplateforme

```
https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0
  &LAYER={LAYER}&STYLE=normal&FORMAT={FORMAT}
  &TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}
```

### Couches IGN Géoplateforme

| Nom UI | LAYER IGN | FORMAT | Zoom min | Zoom max |
|---|---|---|---|---|
| Ortho HR | `ORTHOIMAGERY.ORTHOPHOTOS` | `image/jpeg` | 6 | 21 |
| Ortho 20cm | `HR.ORTHOIMAGERY.ORTHOPHOTOS` | `image/jpeg` | 16 | 21 |
| PCRS Image | `PCRS.GRAPHE.PCRS` | `image/png` | 18 | 21 |
| Plan IGN | `GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2` | `image/png` | 6 | 18 |
| Cadastre | `CADASTRALPARCELS.PARCELLAIRE_EXPRESS` | `image/png` | 13 | 20 |
| Routes | `TRANSPORTNETWORKS.ROADS` | `image/png` | 6 | 18 |

> Les couches PCRS et Ortho 20cm ne chargent qu'à partir de zoom 18. En dessous, afficher un avertissement dans le sélecteur ("Non disponible à ce niveau de zoom") plutôt que de laisser des tuiles vides sans explication.

### Couches Google (XYZ)

| Nom UI | URL tuile | Note |
|---|---|---|
| Google Satellite | `https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}` | Activée par défaut |
| Google Hybride | `lyrs=y` | Satellite + noms de rues |
| Google Maps | `lyrs=m` | Carte routière |

### Sélecteur de couches

- Sélection multiple (couches superposées dans MapLibre)
- Slider d'opacité par couche (0–100%)
- Boutons monter/descendre pour l'ordre de superposition
- État du sélecteur persisté dans le projet courant

---

## Module : Géolocalisation et recherche

### Recherche par adresse
```
GET https://api-adresse.data.gouv.fr/search/?q={query}&limit=5
```
- Autocomplétion avec debounce 300ms
- Résultats affichés en dropdown sous le champ
- Sélection : centrer la carte d'analyse sur les coordonnées + zoom 17

### Recherche par coordonnées
- Formats acceptés : `lat, lon` ou `lat lon` (WGS84 décimal)
- Détection automatique : si la saisie contient deux nombres séparés par `,` ou espace, traiter comme des coordonnées sans appel API

---

## Module : Annotations

### Mode annotation

Les annotations ne se créent **pas** en cliquant librement sur la carte (conflit avec la navigation). Un bouton dédié "📌 Annoter" dans la barre de contrôle bascule un mode annotation.

- **Mode inactif** : la carte fonctionne normalement (drag, zoom, clic sur markers existants)
- **Mode actif** : curseur change (crosshair), clic gauche → ouverture popup de création ; le mode reste actif jusqu'à désactivation manuelle ou appui sur Échap

### Création d'une annotation

Popup au clic contient :
- Champ texte libre (label)
- Sélecteur de catégorie (liste par défaut : `Info`, `Alerte`, `Traité`, `À vérifier` ; l'utilisateur peut saisir une valeur libre)
- Bouton "Enregistrer" / "Annuler"

### Consultation et gestion

- Clic sur un marker existant (mode inactif) : popup avec label, catégorie, date, bouton "Modifier" et bouton "Supprimer"
- Panneau liste des annotations (accessible via bouton dédié) avec :
  - Champ de **recherche textuelle** sur le label
  - Filtre par **catégorie**
  - Clic sur une entrée : centrer la carte d'analyse sur l'annotation concernée

### Export

- **GeoJSON** : FeatureCollection de Points, properties = `{label, category, createdAt}`
- **CSV** : colonnes `id, lat, lon, label, category, createdAt`
- Export portant sur le projet actif uniquement

---

## Module : Journal de navigation (tracker)

### Zone de capture

La zone enregistrée dans le navLog n'est **pas** la bbox complète de l'écran. Un **rectangle de capture** est affiché en permanence en overlay sur la carte d'analyse — il matérialise exactement ce qui sera comptabilisé comme zone analysée.

- Le rectangle est centré sur la vue, fixe en pixels (indépendant du zoom et du déplacement de la carte)
- Taille recommandée : 60% de la largeur et 60% de la hauteur de la carte d'analyse
- Style : bordure fine en pointillés, légèrement contrastée, non obstructive
- C'est la **bbox géographique de ce rectangle** (et non celle de l'écran complet) qui est enregistrée dans chaque entrée navLog

Ce rectangle sert aussi de **repère visuel** pour l'utilisateur : il sait en permanence quelle portion de ce qu'il voit sera tracée dans son historique d'avancement.

### Enregistrement automatique

Sur l'événement `moveend` de MapLibre (carte d'analyse), enregistrer une entrée **uniquement si** :
- Le niveau de zoom est **≥ 14** (les vues très dézoomées n'ont pas d'intérêt pour le suivi GEOINT)
- ET la bbox du rectangle de capture ne chevauche pas à plus de **80%** la dernière entrée enregistrée (évite le spam lors d'un simple recentrage)

Chaque entrée contient : `id`, `bbox` (du rectangle de capture), `zoom` (arrondi à 1 décimale), `center`, `timestamp`.

### Gestion du volume

Pas de limite fixe arbitraire. Avant chaque écriture, vérifier l'espace disponible via le module storage. Si quota insuffisant : déclencher un nettoyage FIFO (supprimer les 20 entrées les plus anciennes) avant de réécrire.

### Niveaux de couverture par zoom

Chaque entrée du navLog est classée dans un niveau de couverture selon le zoom enregistré :

| Niveau | Zoom | Couleur | Signification |
|---|---|---|---|
| Survol | 14–16 | Jaune pâle | Zone aperçue, non analysée |
| Inspection | 17–19 | Orange | Zone inspectée |
| Analyse détaillée | 20+ | Bleu vif | Zone traitée au niveau PCRS |

Ces niveaux sont utilisés à la fois pour la **couleur des rectangles** sur la carte de suivi et pour un **indicateur de couverture** au survol.

### Affichage sur la carte de suivi

- Chaque entrée = rectangle semi-transparent coloré selon son **niveau de couverture** (voir tableau ci-dessus)
- Sur une même zone géographique, si plusieurs entrées existent à des niveaux différents, afficher la couleur du **niveau le plus élevé atteint** — ce niveau ne peut qu'augmenter, jamais régresser. Si l'utilisateur repasse sur une zone à un zoom plus faible, la couleur affichée reste celle du zoom maximum historique pour cette zone.
- Survol : tooltip `[date heure] zoom X — Niveau : {Survol / Inspection / Analyse détaillée}`
- Clic : centrer la carte d'analyse sur cette bbox

### Panneau liste (dans la zone de suivi)

- 20 dernières entrées, format `[HH:MM] z{zoom} {niveau} — {lat}, {lon}`
- Indicateur visuel du niveau de couverture (pastille colorée selon le tableau)
- Clic = même comportement que clic sur le rectangle

---

## Module : Zones de suivi (tracking-zones)

Ce module est le cœur du suivi d'avancement. Il permet de **délimiter des zones géographiques** sur la carte de suivi et de leur attribuer un statut.

### Statuts disponibles

| Statut | Couleur | Signification |
|---|---|---|
| `todo` | Rouge semi-transparent | Zone identifiée, pas encore analysée |
| `done` | Vert semi-transparent | Zone analysée et traitée |

Le statut `done` doit afficher en sous-titre le **niveau de couverture maximal atteint** sur cette zone, calculé automatiquement à partir des entrées du navLog qui chevauchent la zone. Ce niveau est calculé comme le **maximum historique** : repasser sur la zone à un zoom plus faible ne le fait pas régresser. Cela permet de savoir si une zone "traitée" l'a été en survol ou au niveau PCRS.

Exemple d'affichage au survol d'une zone traitée : `Zone industrielle Nord — Traité — Analyse détaillée (zoom 20)`

### Création d'une zone

Sur la **carte de suivi** uniquement :
- Bouton "Délimiter une zone" active un mode dessin de rectangle (drag)
- À la fin du drag : popup demandant le nom de la zone et le statut initial (`todo` par défaut)
- Clic sur une zone existante : popup avec nom, statut, bouton "Passer à Traité" / "Supprimer"

### Affichage

Les zones de suivi sont superposées aux rectangles bleus du navLog. Elles sont au-dessus (z-order supérieur) pour rester lisibles.

---

## Module : Overpass (overpass.js)

Permet d'interroger l'API Overpass (OSM) pour extraire des POIs et les importer comme annotations dans le projet actif.

### Deux modes d'accès

- **Mode zone** (`openOverpassPanel(zone)`) : déclenché depuis le popup d'une zone de suivi (bouton "Requête Overpass"). Interroge dans la bbox de la zone sélectionnée. L'import crée des annotations pour les POIs cochés.
- **Mode standalone** (`btn-overpass-standalone`) : accessible depuis la barre de contrôle sans zone préalable. Le panneau `overpass-standalone-panel` permet de saisir une requête Overpass libre ou de choisir des presets sur la vue courante de la carte d'analyse.

### Endpoint et contraintes

```
https://overpass-api.de/api/interpreter
```
- CORS ouvert — aucun proxy nécessaire
- Timeout 45 secondes (`TIMEOUT_MS = 45_000`)
- Limite à 500 résultats (`MAX_ITEMS = 500`)

### Presets disponibles

Catégories prédéfinies avec sous-types cochables individuellement :
- **Infrastructures routières** : Ponts, Tunnels, Viaducs
- **Santé** : Hôpitaux, Cliniques, Pharmacies, EHPAD
- **Sécurité publique** : Police/Gendarmerie, Pompiers, Prisons
- **Éducation** : Maternelles, Écoles primaires, Collèges, Lycées, Universités
- **Transports** : Gares SNCF/RER, Métro, Tramway, Aérodromes, Hélistations, Ports
- **Énergie** : Centrales, Transformateurs HT, Éoliennes, Pylônes HT

### Workflow (mode zone, 3 phases)

1. **Phase 1** : Sélection du preset et des sous-types → bouton "Lancer la requête"
2. **Phase 2** : Résultats listés avec cases à cocher + sélection de la catégorie d'annotation + mode de nommage (tag OSM ou nom fixe)
3. **Import** : Les POIs cochés sont créés comme annotations via `addAnnotationsBatch()` (fonction exportée par `annotations.js`)

---

## Module : Affichage des coordonnées

La barre de contrôle affiche en permanence les coordonnées du **centre de la carte d'analyse** en deux systèmes :

- **WGS84** (`coord-wgs84`) : `lat, lon` à 6 décimales
- **Lambert 93** (`coord-l93`) : `X E  Y N` arrondi au décimètre (EPSG:2154, calcul analytique dans `wgs84ToLambert93()` dans `app.js`)

Chaque valeur a un bouton copier (`btn-copy-wgs84`, `btn-copy-l93`) qui donne un retour visuel (✓ temporaire).

---

## Module : Mesure linéaire (measure.js)

Outil de mesure de distance sur la **carte d'analyse** uniquement.

- Bouton **📐 Mesure** dans la barre de contrôle active le mode (curseur crosshair)
- **Clic** : ajoute un point ; **double-clic** : termine le tracé (le click du deuxième clic est retiré de la liste pour éviter le doublon)
- Distance calculée avec la formule **haversine** (mètres < 1 km, km au-delà)
- Pendant le tracé : ligne rouge + ligne de prévisualisation jaune pointillée jusqu'au curseur + hint de distance live
- À la fin : barre flottante affiche la distance totale + bouton **⎘ copier dans le presse-papier**
- `Échap` ou re-clic du bouton annule et vide les sources GeoJSON
- Les 3 sources MapLibre (`measure-line`, `measure-points`, `measure-preview`) sont réutilisées entre les mesures — ne jamais créer de nouvelles sources

## Module : Persistance (storage.js)

### Gestion du quota

Toujours encapsuler les écritures `localStorage.setItem()` dans un try/catch. Si une `QuotaExceededError` est levée :
1. Afficher un bandeau d'avertissement non bloquant : "Espace de stockage presque plein — anciennes entrées de navigation supprimées automatiquement"
2. Déclencher le nettoyage FIFO du navLog (supprimer les 20 entrées les plus anciennes)
3. Retenter l'écriture une seule fois
4. Si toujours en erreur : afficher un message demandant à l'utilisateur d'exporter ses données et de supprimer un projet

### Restauration au chargement

À l'initialisation de l'app :
1. Lire l'index des projets
2. Charger le dernier projet actif (ou le projet par défaut)
3. Restaurer `lastView` sur la carte d'analyse
4. Restaurer `layerConfig` dans le sélecteur de couches
5. Charger les markers d'annotations
6. Charger le navLog et les zones de suivi sur la carte de suivi

---

## Vue terrain

Boutons dans la barre de contrôle qui ouvrent un **nouvel onglet** centré sur les coordonnées actuelles de la carte d'analyse :

| Bouton | Service | URL |
|---|---|---|
| 🚶 Street View | Google Maps | `https://maps.google.com/?layer=c&cbll={lat},{lon}` |
| 📷 Mapillary | Mapillary | `https://www.mapillary.com/app/?lat={lat}&lng={lon}&z=18` |
| 🌐 Panoramax | panoramax.ign.fr | `https://panoramax.ign.fr/?background=streets&focus=pic&map=17/{lat}/{lon}&speed=250&users=default` |
| ☀️ SunCalc | suncalc.org | `https://www.suncalc.org/#/{lat},{lon},{zoom}/{date}/{time}/1/3` (date/heure courante) |

Chaque clic sur Street View, Mapillary ou Panoramax enregistre également une **visite terrain** dans `project.streetviewVisits` (tableau de `{id, service, lat, lon, timestamp}`). Ces visites s'affichent sur la **carte de suivi** sous forme de cercles colorés : Street View = bleu `#4285F4`, Mapillary = vert `#05CB63`, Panoramax = orange `#FF6B35`. SunCalc ne génère pas de visite. Le reset navLog (↺) efface aussi `streetviewVisits`.

---

## Comportements critiques

- **CORS** : `data.geopf.fr`, `api-adresse.data.gouv.fr` et `overpass-api.de` ont des headers CORS ouverts. Aucun proxy nécessaire.
- **Performance navLog** : utiliser une seule `GeoJSON source` MapLibre mise à jour par `setData()` — ne jamais ajouter un layer par entrée de log.
- **Performance annotations** : idem, une source GeoJSON unique pour tous les markers du projet actif.
- **Performance mesure** : les sources `measure-*` sont initialisées une seule fois au chargement de la carte ; `_initSources()` fait un early return si elles existent déjà.
- **Reset navLog** : bouton **↺ Reset** vide l'historique de navigation (`navLog`) ET les visites terrain (`streetviewVisits`) du projet actif après confirmation — les annotations et zones manuelles sont conservées.
- **Raccourcis clavier** : `Échap` quitte le mode annotation, dessin de zone ou mesure et ferme les popups ; `Entrée` valide la popup active.
- **Responsive** : split 50/50 ≥ 900px, stack vertical < 900px.

---

## UI / Esthétique

Interface d'analyste : sobre, sombre, fonctionnelle. Penser "poste de travail OSINT" plutôt qu'application grand public. Pas d'éléments décoratifs superflus.

Priorités visuelles :
- Lisibilité des coordonnées et labels (police monospace pour les valeurs numériques)
- Distinction claire entre les deux zones de carte
- Indicateur visuel fort du mode annotation quand il est actif (bouton coloré, curseur crosshair)
- Bandeau quota bien visible mais non bloquant

---

## Ordre de développement recommandé

1. Layout HTML/CSS — split, barre projet, barre de contrôle
2. `storage.js` — abstraction localStorage + gestion quota
3. `projects.js` — création, switch, suppression de projets
4. `layers.js` — intégration MapLibre + WMTS IGN + sélecteur avec zoom warnings
5. Géocodage — adresse + coordonnées
6. `tracker.js` — navLog automatique avec seuils de zoom et chevauchement
7. `annotations.js` — mode, popup, markers, liste, filtre
8. `tracking-zones.js` — dessin de zones, statuts, affichage superposé
9. `export.js` — GeoJSON + CSV par projet
10. Polish — bandeau quota, responsive, Échap pour quitter les modes

---

## Contraintes absolues

- Aucune dépendance serveur ni appel à un backend propriétaire
- JS en modules ES natifs (`type="module"`) avec extensions explicites dans les imports
- MapLibre chargé depuis CDN public
- Pas de framework JS (React, Vue, Angular)
- Compatible Chrome, Firefox, Edge modernes
