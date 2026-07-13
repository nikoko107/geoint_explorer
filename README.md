# GeoINT Explorer

Outil de support au travail GEOINT (Geographic Intelligence). Application web entièrement statique — aucun backend, aucune clé API requise. Toutes les données sont stockées localement dans le navigateur.

## Lancement

Servir le dossier racine avec n'importe quel serveur HTTP statique :

```bash
python3 -m http.server 8080
# puis ouvrir http://localhost:8080
```

> Ne pas ouvrir `index.html` directement via `file://` — les imports ES Modules échouent sans serveur HTTP.

---

## Interface

<img width="1434" height="749" alt="Capture d'écran 2026-05-07 à 18 03 08" src="https://github.com/user-attachments/assets/ffbd23cd-022e-4ee3-b1eb-6f13fdcf50aa" />

```
┌─────────────────────────────────────────────────────────────┐
│  PROJET : [Projet actif ▼]  [+ Nouveau]  [🗑]               │
├──────────────────────────┬──────────────────────────────────┤
│  [🔍 Recherche]          │                                  │
│    CARTE D'ANALYSE       │    CARTE DE SUIVI                │
│    (travail en cours)    │    (avancement global)           │
│                          │                                  │
│  ← séparateur draggable →│                                  │
├──────────────────────────┴──────────────────────────────────┤
│ [Couches] [📌 Annoter] [≡ Annotations] [✏ Zone] [≡ Zones] [↺ Reset] │
│ [🚶 Street View] [📷 Mapillary] [🌐 Panoramax] [☀ SunCalc] [W3W]    │
│ [📏 Mesure] [🔍 Overpass] [🖼 Image]                         │
│ [↓ GeoJSON] [↓ CSV] [↓ Projet] [↑ Projet]                  │
└─────────────────────────────────────────────────────────────┘
```

- **Carte d'analyse** (gauche) — navigation libre, couches IGN/Google, annotations, rectangle de capture. Overlay haut-gauche avec recherche et coordonnées (WGS84, Lambert 93, Plus Code).
- **Carte de suivi** (droite) — fond sombre Carto avec labels villes/routes/rues au-dessus des couches de suivi, historique de couverture, zones à traiter/traitées.
- **Séparateur** — draggable pour redimensionner les deux volets ; double-clic pour revenir au 50/50.
- La carte de suivi reste **centrée sur la carte d'analyse** en permanence.

---

## Projets

Un projet isole l'ensemble des données d'une mission : annotations, historique de navigation, zones de suivi et configuration des couches.

| Action | Comment |
|---|---|
| Créer | Bouton **+ Nouveau** dans la barre de projet |
| Changer | Dropdown de sélection |
| Supprimer | Bouton 🗑 (confirmation requise) |
| Exporter | Bouton **↓ Projet** — sauvegarde complète en JSON |
| Importer | Bouton **↑ Projet** — depuis un fichier JSON, au choix : créer un **nouveau projet** ou **fusionner** dans un projet existant (annotations, navLog, zones, visites terrain et calques importés concaténés, sans écraser la config du projet cible) |

Les données sont persistées dans le `localStorage` du navigateur sous les clés `geoint_project_{id}` et `geoint_index`.

---

## Couches cartographiques

Le panneau **Couches** permet de superposer plusieurs fonds de carte avec slider d'opacité et contrôle d'ordre.

### IGN Géoplateforme

| Couche | Zoom utile |
|---|---|
| Plan IGN | 6 – 18 |
| Ortho HR | 6 – 21 |
| Ortho 20cm | 16 – 21 |
| PCRS Image | 18 – 21 |
| Cadastre | 13 – 20 |
| Routes | 6 – 18 |

### Google

| Couche | Description |
|---|---|
| Google Satellite | Imagerie satellitaire (**activée par défaut**) |
| Google Hybride | Satellite + noms de rues |
| Google Maps | Carte routière |

### Calques externes (GeoJSON / KML)

En bas du panneau **Couches**, le bouton **+ Importer un calque** permet de superposer un fichier `.geojson`/`.json` ou `.kml` sur la carte d'analyse (parsing KML fait maison, sans dépendance tierce). Le calque est fusionné directement dans le projet actif — pas de création de nouveau projet. Chaque calque importé dispose d'une pastille couleur modifiable, d'une case à cocher visibilité et d'un bouton de suppression.

---

## Recherche et navigation

Le champ de recherche (overlay haut-gauche) reconnaît trois formats :

- **Adresse** — autocomplétion via [api-adresse.data.gouv.fr](https://api-adresse.data.gouv.fr)
- **Coordonnées WGS84** — `lat, lon` décimal (ex : `48.8534, 2.3488`)
- **Plus Code** — code OLC complet (ex : `8FW4V83X+8Q`) — décodage client-side, sans réseau

La sélection centre la carte d'analyse au zoom 17.

---

## Coordonnées du centre

L'overlay haut-gauche affiche en permanence les coordonnées du centre de la carte en trois systèmes :

| Système | Exemple |
|---|---|
| WGS84 | `48.853400, 2.348800` |
| Lambert 93 (EPSG:2154) | `652184 E  6861122 N` |
| Plus Code (OLC) | `8FW4V83X+8Q` |

Chaque valeur dispose d'un bouton **⎘ copier**. Le Plus Code est calculé localement (algorithme OLC intégré, sans CDN externe).

---

## Annotations

1. Cliquer **📌 Annoter** pour activer le mode (curseur en croix, bouton violet)
2. Cliquer sur la carte pour placer un marqueur
3. Remplir le label et la catégorie dans la popup, puis **Enregistrer**
4. En mode normal, cliquer sur un marqueur pour consulter, modifier ou supprimer
5. Bouton **≡ Annotations** pour le panneau liste avec recherche et filtre par catégorie

**Catégories prédéfinies** : `Info` · `Alerte` · `Traité` · `À vérifier` (saisie libre également)

Échap quitte le mode annotation.

---

## Journal de navigation (tracker)

Le rectangle de capture en pointillés sur la carte d'analyse matérialise la zone enregistrée à chaque déplacement (si zoom ≥ 14 et chevauchement < 80 % avec la dernière entrée).

### Niveaux de couverture

| Niveau | Zoom | Couleur |
|---|---|---|
| Survol | 14 – 16 | Jaune pâle |
| Inspection | 17 – 19 | Orange |
| Analyse détaillée | 20+ | Bleu vif |

Les rectangles s'affichent sur la carte de suivi. La couleur du niveau le plus élevé historique est toujours conservée.

Le bouton **↺ Reset** vide l'historique de navigation et les visites terrain du projet actif (annotations et zones manuelles conservées).

---

## Zones de suivi

Délimiter des zones géographiques sur la **carte de suivi** et suivre leur avancement.

Bouton **✏ Zone** → mode dessin polygone (clic pour poser les sommets, barre flottante pour terminer / annuler dernier / abandonner).

### Statuts

| Statut | Couleur |
|---|---|
| À traiter | Rouge |
| Traité | Vert |

Cliquer sur une zone ouvre sa popup : renommer, changer de statut, supprimer, lancer une requête BD TOPO. Pour les zones traitées, le niveau de couverture maximal atteint (depuis le navLog) est affiché.

Les contours des zones sont **également visibles sur la carte d'analyse** (avec halo blanc pour la lisibilité sur fond satellite).

---

## Requêtes BD TOPO / Overpass

### BD TOPO ZAI (depuis une zone)

Depuis la popup d'une zone, le bouton **🗺 BD TOPO ZAI** interroge la [BD TOPO IGN WFS](https://data.geopf.fr/wfs/ows) dans la bbox de la zone. Les objets retournés (zones d'activité, équipements de transport, voirie structurante…) peuvent être importés comme annotations avec catégorie et couleur.

### Overpass QL (standalone)

Bouton **🔍 Overpass** — ouvre un panneau de requête libre Overpass QL (OSM) :

- Écrire la requête dans le textarea (endpoint `overpass-api.de`, timeout 45 s, 500 résultats max)
- Cliquer **Lancer** — les résultats s'affichent avec cases à cocher
- Choisir la catégorie et la couleur, puis **Importer la sélection**
- Compatible `out center;`, `out geom;`, `out body;`

---

## Mesure linéaire

Bouton **📏 Mesure** :

- **Clic** : ajoute un point — **Double-clic** : termine le tracé
- Distance calculée en haversine (m ou km)
- Prévisualisation en temps réel (ligne rouge + pointillés jaunes jusqu'au curseur)
- Barre flottante avec la distance totale et bouton **⎘ copier**
- Échap ou re-clic du bouton annule la mesure

---

## Image de référence

Bouton **🖼 Image** — ouvre une fenêtre flottante indépendante de la carte (pas de géoréférencement) pour analyser une photo dont on cherche à estimer des distances ou tailles relatives :

1. **Charger…** une image locale
2. Zoomer (molette ou boutons **−/+**) et pivoter (slider ou boutons **↺/↻**) pour l'inspecter
3. **Calibrer** l'échelle : cliquer 2 points dont la distance réelle est connue, puis saisir cette distance (m)
4. **Mesurer** : cliquer pour poser des points, double-clic pour terminer — la distance s'affiche en direct puis peut être copiée

La fenêtre n'est pas modale (la carte d'analyse reste utilisable en parallèle) et fermer (**✕**) ne réinitialise rien. L'image (compressée, JPEG qualité ~80%, 1600px max), la vue (zoom/rotation) et la calibration sont **persistées dans le projet actif** : elles survivent à un rechargement de page et suivent le projet lors d'un changement (comme les annotations ou les zones). Bouton **🗑** pour supprimer explicitement l'image de référence du projet.

### Métadonnées EXIF

Au chargement, un parseur EXIF fait maison (aucune dépendance, lecture directe du JPEG) extrait Marque/Modèle d'appareil, date de prise de vue et coordonnées GPS si présentes — affichés dans un bandeau sous l'image. Si des coordonnées GPS sont trouvées, le bouton **📍** recentre directement la carte d'analyse sur cette position (zoom 17).

---

## Vue terrain

Ouvre la position courante dans un service externe (nouvel onglet).

| Bouton | Service | Visite enregistrée |
|---|---|---|
| 🚶 Street View | Google Maps | ✅ point bleu sur carte suivi |
| 📷 Mapillary | Mapillary | ✅ point vert sur carte suivi |
| 🌐 Panoramax | panoramax.ign.fr | ✅ point orange sur carte suivi |
| ☀ SunCalc | suncalc.org (date/heure courante) | — |
| W3W | what3words.com (position courante) | — |

---

## Export / Import

### Annotations

| Bouton | Format | Contenu |
|---|---|---|
| **↓ GeoJSON** | `.geojson` | `FeatureCollection` de Points — `label`, `category`, `createdAt` |
| **↓ CSV** | `.csv` | `id`, `lat`, `lon`, `label`, `category`, `createdAt` |

### Projet complet

| Bouton | Action |
|---|---|
| **↓ Projet** | Exporte en JSON : annotations, zones, navLog, visites terrain, calques importés, image de référence, config couches, dernière vue |
| **↑ Projet** | Importe un `.json` — au choix, crée un **nouveau projet** ou **fusionne** dans un projet existant |

---

## Raccourcis clavier

| Touche | Action |
|---|---|
| `Échap` | Quitte le mode annotation / dessin / mesure, ferme les popups |
| `Entrée` | Valide la popup active |

---

## Architecture technique

```
geoint-explorer/
├── index.html               — structure, popups, panneaux
├── style.css                — thème sombre, layout, composants
├── app.js                   — init cartes, géocodage, coordonnées
│                              (WGS84 / Lambert 93 / Plus Code inline OLC)
└── modules/
    ├── storage.js           — abstraction localStorage, gestion quota
    ├── projects.js          — CRUD projets, switch, isolation données
    ├── layers.js            — couches IGN/Google, sélecteur, opacité
    ├── tracker.js           — navLog automatique, niveaux de couverture
    ├── annotations.js       — marqueurs, popups, liste, filtre, import batch
    ├── tracking-zones.js    — dessin polygone, statuts zones
    ├── overpass.js          — Overpass QL standalone + BD TOPO WFS IGN
    ├── measure.js           — mesure linéaire haversine
    ├── external-layers.js   — import calques GeoJSON/KML, fusion projet actif
    ├── image-tool.js        — fenêtre image de référence, mesure relative
    └── export.js            — GeoJSON, CSV, export/import (+ fusion) projet JSON
```

**Stack** : MapLibre GL JS 4.7 (CDN) · HTML/CSS/JS vanilla · ES Modules natifs · localStorage

Aucune dépendance serveur. Aucune clé API requise. Compatible Chrome, Firefox, Edge modernes.

**APIs externes utilisées (CORS ouvert, sans authentification)**

| Service | Usage |
|---|---|
| [api-adresse.data.gouv.fr](https://api-adresse.data.gouv.fr) | Géocodage adresses France |
| [data.geopf.fr](https://data.geopf.fr) WMTS | Couches IGN raster |
| [data.geopf.fr](https://data.geopf.fr) WFS | BD TOPO ZAI |
| [overpass-api.de](https://overpass-api.de) | Requêtes OSM libres |
| [mt1.google.com](https://mt1.google.com) | Tuiles Google XYZ |

---

## Gestion du stockage

En cas de quota `localStorage` presque atteint, un bandeau d'avertissement apparaît et les entrées de navigation les plus anciennes sont supprimées automatiquement (FIFO, 20 entrées à la fois). Si le quota est dépassé malgré le nettoyage : exporter les données et supprimer un projet pour libérer de l'espace.
