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

```
┌─────────────────────────────────────────────────────────────┐
│  PROJET : [Projet actif ▼]  [+ Nouveau]  [🗑]               │
├──────────────────────────┬──────────────────────────────────┤
│                          │                                  │
│    CARTE D'ANALYSE       │    CARTE DE SUIVI                │
│    (travail en cours)    │    (avancement global)           │
│                          │                                  │
│  ← séparateur draggable →│                                  │
├──────────────────────────┴──────────────────────────────────┤
│ [Adresse] [Couches] [📌 Annoter] [⬜ Rectangle] [⬡ Polygone] │
│ [🚶 Street View] [📷 Mapillary] [🌐 Panoramax] [↓ Export]   │
└─────────────────────────────────────────────────────────────┘
```

- **Carte d'analyse** (gauche) — navigation libre, couches IGN/Google, annotations, rectangle de capture. Le champ de recherche est positionné en overlay **haut-gauche** de cette carte.
- **Carte de suivi** (droite) — fond sombre Carto avec **labels villes/routes/rues** lisibles au-dessus des couches de suivi, historique de couverture, zones à traiter/traitées. Les contours des zones y tracées sont également visibles sur la carte d'analyse (rouge = à traiter, vert = traité).
- **Séparateur** — draggable pour redimensionner les deux volets ; double-clic pour revenir au 50/50
- La carte de suivi reste **centrée sur la carte d'analyse** en permanence

---

## Projets

Un projet isole l'ensemble des données d'une mission : annotations, historique de navigation, zones de suivi et configuration des couches.

| Action | Comment |
|---|---|
| Créer | Bouton **+ Nouveau** dans la barre de projet |
| Changer | Dropdown de sélection |
| Supprimer | Bouton 🗑 (confirmation requise) |

Les données sont persistées dans le `localStorage` du navigateur sous les clés `geoint_project_{id}` et `geoint_index`.

---

## Couches cartographiques

Le panneau **Couches** (barre du bas) permet de superposer plusieurs fonds de carte.

### IGN Géoplateforme

| Couche | Zoom utile | Note |
|---|---|---|
| Plan IGN | 6 – 18 | |
| Ortho HR | 6 – 21 | Orthophotos standard |
| Ortho 20cm | 16 – 21 | Haute résolution |
| PCRS Image | 18 – 21 | Niveau rue / réseau |
| Cadastre | 13 – 20 | Parcelles |
| Routes | 6 – 18 | Réseau routier |

### Google

| Couche | Description |
|---|---|
| Google Satellite | Imagerie satellitaire (**activée par défaut**) |
| Google Hybride | Satellite + noms de rues |
| Google Maps | Carte routière |

Chaque couche dispose d'un **slider d'opacité** (0–100 %) et de boutons d'ordre de superposition. L'état est sauvegardé dans le projet.

---

## Recherche et navigation

Le champ de recherche se trouve en **overlay haut-gauche** de la carte d'analyse.

- **Adresse** — saisie libre avec autocomplétion ([api-adresse.data.gouv.fr](https://api-adresse.data.gouv.fr)) ; les résultats s'ouvrent vers le bas, une erreur réseau est signalée
- **Coordonnées** — saisir `lat, lon` ou `lat lon` en WGS84 décimal (ex : `48.8534, 2.3488`) ; les bornes ±90 / ±180 sont validées
- La sélection centre la carte d'analyse au zoom 17

---

## Annotations

1. Cliquer **📌 Annoter** pour activer le mode (curseur en croix, bouton violet)
2. Cliquer sur la carte pour placer un marqueur
3. Remplir le label et la catégorie dans la popup, puis **Enregistrer**
4. En mode normal, cliquer sur un marqueur pour le consulter, modifier ou supprimer
5. Bouton **≡ Annotations** pour afficher le panneau liste avec recherche et filtre

**Catégories prédéfinies** : `Info` · `Alerte` · `Traité` · `À vérifier` (saisie libre également)

Échap quitte le mode annotation.

---

## Journal de navigation (tracker)

Le rectangle de capture affiché en pointillés sur la carte d'analyse matérialise la zone qui sera enregistrée dans l'historique.

L'enregistrement se déclenche automatiquement sur chaque déplacement **si** :
- zoom ≥ 14
- la zone ne chevauche pas à plus de 80 % la dernière entrée

### Niveaux de couverture

| Niveau | Zoom | Couleur |
|---|---|---|
| Survol | 14 – 16 | Jaune pâle |
| Inspection | 17 – 19 | Orange |
| Analyse détaillée | 20+ | Bleu vif |

Les rectangles s'affichent sur la carte de suivi. Si une zone est repassée à un zoom plus faible, la couleur du **niveau le plus élevé** historique est conservée.

Le bouton **🗺 Historique** affiche les 20 dernières entrées. Cliquer sur une entrée recentre la carte d'analyse.

---

## Zones de suivi

Délimiter des zones géographiques sur la **carte de suivi** et suivre leur état d'avancement.

### Dessiner une zone

**⬜ Rectangle** — cliquer-glisser sur la carte de suivi

**⬡ Polygone** — cliquer pour poser les sommets, une barre flottante apparaît :
- **✓ Terminer** — valide le polygone (minimum 3 points)
- **↩ Annuler dernier** — supprime le dernier sommet
- **✕ Annuler** — abandonne le tracé
- Échap annule également

La prévisualisation (contour vert en pointillés, remplissage, sommets) se met à jour en temps réel pendant le tracé.

### Statuts

| Statut | Couleur | Signification |
|---|---|---|
| À traiter | Rouge | Zone identifiée, pas encore analysée |
| Traité | Vert | Zone analysée |

Cliquer sur une zone affiche sa popup : renommer, changer de statut, supprimer. Pour les zones "Traitées", le niveau de couverture maximal atteint (calculé depuis le navLog) est affiché.

Cliquer sur une zone dans le panneau **≡ Zones** recentre la carte d'analyse sur cette zone.

Les contours des zones sont **également affichés sur la carte d'analyse** (rouge = à traiter, vert = traité, avec halo blanc pour la lisibilité sur fond satellite), en dessous des markers d'annotations.

---

## Vue terrain

Ouvre la position courante de la carte d'analyse dans un service de photographies street-level :

| Bouton | Service |
|---|---|
| 🚶 Street View | Google Maps (nouvel onglet) |
| 📷 Mapillary | Mapillary (nouvel onglet) |
| 🌐 Panoramax | panoramax.ign.fr (nouvel onglet) |

---

## Export

Le bouton **↓ GeoJSON** et **↓ CSV** exportent les annotations du projet actif.

**GeoJSON** — `FeatureCollection` de Points, propriétés : `label`, `category`, `createdAt`

**CSV** — colonnes : `id`, `lat`, `lon`, `label`, `category`, `createdAt`

---

## Raccourcis clavier

| Touche | Action |
|---|---|
| `Échap` | Quitte le mode annotation, dessin de zone ou ferme les popups |
| `Entrée` | Valide la popup active (annotation, zone) |

---

## Architecture technique

```
geoint-explorer/
├── index.html               — structure, popups, panneaux
├── style.css                — thème sombre, layout, composants
├── app.js                   — point d'entrée, init cartes, géocodage
└── modules/
    ├── storage.js           — abstraction localStorage, gestion quota
    ├── projects.js          — CRUD projets, switch, isolation données
    ├── layers.js            — couches IGN/Google, sélecteur, opacité
    ├── tracker.js           — navLog automatique, niveaux de couverture
    ├── annotations.js       — marqueurs, popups, liste, filtre
    ├── tracking-zones.js    — dessin rectangle/polygone, statuts
    └── export.js            — GeoJSON + CSV
```

**Stack** : MapLibre GL JS 4.7 (CDN) · HTML/CSS/JS vanilla · ES Modules natifs · localStorage

Aucune dépendance serveur. Compatible Chrome, Firefox, Edge modernes.

**Fonds de carte utilisés**

| Carte | Source |
|---|---|
| Analyse — fond de référence | OpenStreetMap (opacité 15 %) |
| Analyse — couches sélectionnables | IGN Géoplateforme WMTS + Google XYZ |
| Suivi — fond sombre | CARTO `dark_nolabels` |
| Suivi — labels villes/routes/rues | CARTO `dark_only_labels` (layer au-dessus de tout) |

---

## Gestion du stockage

En cas de quota `localStorage` presque atteint, un bandeau d'avertissement apparaît et les entrées de navigation les plus anciennes sont supprimées automatiquement (FIFO, 20 entrées à la fois).

Si le quota est dépassé malgré le nettoyage : exporter les données et supprimer un projet pour libérer de l'espace.
