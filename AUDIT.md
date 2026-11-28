# Audit tour → `/api/catalog?v=2` → application : chaque champ saisi arrive-t-il chez le client ?

**Résultat (28/11/2026)** : 98 champs, 83 OK, 15 NON au départ (12 problèmes) → **8 problèmes corrigés** (+ un défaut latent de `?pays=`), **4 restants** : emballages « Pros », texte d’une annonce image seule, titre/description des vidéos, rapport des photos — décisions de design ou de produit, chacune annoncée dans la tour.
Test à la main (t6) : emballage complet créé sur la Mangue dans la tour → « Fiche « Mangue » enregistrée » ; erreur de validation
VISIBLE (« 1 point à corriger avant d’enregistrer », champ en rouge, rien d’enregistré) → `?v=2` → application (prix du Sénégal,
contenu, description) → emballage TEST retiré par l’interface.

Code lu tel qu'il est sur le disque (y compris les changements non commités de la tour : devise des réglages par pays des emballages).
Chaîne : `api/catalog.js` → `shared/catalog.js` (`buildDocument`, `productToDoc`, `retailToDoc`, `offerToDoc`) → `shared/catalog-v2.js` (`toAppDocument`, `productOf`, `formatOf`, `campaignsOf`, `categoriesOf`, `filtersOf`) → app `lib/catalog/source.ts` → `schema.ts` (`parseCatalog`…) → `store.tsx` (`spaceFor` = `forCountry` puis `retailSpace`/`wholesaleSpace`) → `build.ts` / `rules.ts` → écrans.
L'application lit **toujours** `?v=2` **sans** `pays` (`lib/config.ts` › `CATALOG_ENDPOINT`) : le pays du client est appliqué côté application (`forCountry`, `visibleIn`, `resolveFormatForCountry`).

Légende des verdicts : **OK** ; **CORRIGÉ** (28/11, tour `bf65a39`, app `08bf2c1`) ; **NON (restant)** avec la raison.

## 1. Fiche produit (`src/pages/ProductEditor.tsx`, `src/lib/productForm.ts`, `OfferCard.tsx`, `CountryPrices.tsx`, `ZonePicker.tsx`, `PackPhoto.tsx`)

| Champ (tour, libellé à l'écran) | Publié dans ?v=2 | Lu par l'app | Affiché dans l'app | Verdict |
|---|---|---|---|---|
| **Identité** | | | | |
| Nom | oui · `products[].name` | schema.ts › `parseProduct` ; build.ts › `base` | Titre de ProductScreen, ProductCard, titre des annonces (HomeHero), panier | OK |
| Identifiant (à la création) | oui · `products[].id` | `parseProduct` (refus si `:`) | Clé des lignes ; relie la photo embarquée (`PHOTO_ASSETS`) et le rapport (`RATIO`) | OK |
| Variété (facultative) | oui · `products[].variety` | `base` | ProductScreen : sous-titre `` `${variety} · ${origin}` `` ; recherche HomeScreen | CORRIGÉ — seules les parties non vides sont jointes (app `ProductScreen`) |
| Origine | oui · `products[].origin` | `base` | ProductCard (sous le nom), ProductScreen, recherche | OK |
| Description | oui · `products[].description` | `base` | ProductScreen, bloc description | OK |
| Produit bio | oui · `products[].bio` | `base` | ProductScreen : pastille « Bio » | OK |
| Informations vérifiées (fiche d'exemple) | oui · `products[].demo` (+ `example` global) | `parseProduct` › `base` | Pastille « Données de démonstration » (ProductScreen), mention FormatPicker ; ProfileScreen (`catalogExample`) | OK |
| Note et avis d'exemple (Retirer / Rétablir) | oui · `products[].rating`, `products[].reviews` | `base` | ProductScreen : étoile + « N avis », particuliers seulement, si `reviews > 0` | OK (pas de saisie possible : cohérent, aucun système d'avis) |
| **Photo et teinte** | | | | |
| Photo envoyée | oui · `products[].photo.url` | build.ts › `photoOf` → `{ uri }` | ProductCard, ProductScreen, arrière-plan des annonces, toasts | OK |
| Photo embarquée / « Revenir à la photo embarquée » / « Retirer » | oui · `products[].photo.asset` (défaut : l'id) | `photoOf` : `PHOTO_ASSETS[asset]`, sinon feuille | Idem ; sans photo : feuille | OK |
| Rapport largeur/hauteur (`photo_ratio`, calculé à l'envoi) | **non** (`productToDoc` l'omet) | app : `lib/ratios.ts` › `RATIO[id] ?? 1` | Taille dans l'arc de ProductScreen, HomeHero, vol de la carte | NON (restant) — touche au cadrage du carrousel en arc : à décider avec le propriétaire |
| Teinte d'ambiance | oui · `products[].tint` | `parseProduct` (#RRGGBB) | Halo (Glow) ProductScreen / ProductCard / HomeHero, SeasonStrip | OK |
| **Commercialisation et disponibilité** | | | | |
| Produit commercialisé | oui · `products[].available` (`false` publié) | `retailSpace`, `wholesaleSpace`, `allProducts` filtrent `p.available` | Masqué partout ; ses annonces retirées côté tour (`visible` dans catalog.js) | OK |
| Pour les particuliers | oui · `products[].retail` (objet ou `null`) | `retailSpace` exige `retail && retail.price !== null` | Absent de l'espace particulier si éteint ou sans prix | OK |
| Pour les grossistes et importateurs | oui · `products[].wholesale[].available` (l'interrupteur ouvre/ferme toutes les offres) | `wholesaleSpace` garde les offres `available` | Absent de l'espace pro (pour **tous** les comptes pro, pas seulement grossistes/importateurs) | OK |
| Archiver / Remettre au catalogue | oui · produit retiré (`buildDocument` + `.eq('archived', false)`) | — | Disparaît | OK |
| Mois de disponibilité (Toute l'année, Effacer, mois) | oui · `products[].months` | `parseProduct` (liste vide → 12 mois) | ProductScreen « Saison » (SeasonStrip, « Hors de sa pleine saison »), filtre « De saison », tri de l'étal, surtitre des annonces | OK (la tour interdit « commercialisé » sans mois) |
| **Pays et rayon** | | | | |
| Pays : Monde entier | oui · `products[].visibility = {mode:'monde'}` | `parseVisibility` › rules.ts `visibleIn` | Visible partout | OK |
| Pays : Sénégal uniquement | oui · `{mode:'pays', countries:['SN']}` | `visibleIn` (pays inconnu → masqué) | Visible au Sénégal seulement (pays : adresse › compte › appareil) | OK |
| Pays : Monde sauf… | oui · `{mode:'monde_sauf', countries:[…]}` | `visibleIn` | Masqué dans les pays exclus | OK |
| Rayon du produit (+ « Nouveau rayon ») | oui · `products[].category` | build.ts › `categoryOf` (connu, ou dans `doc.categories`, sinon `fruits`) | Filtre de l'accueil, pastille de rayon ProductScreen, « Dans le même rayon » | OK (un rayon pas encore validé n'est pas publié : produit rangé dans « Fruits ») |
| **Prix particuliers** | | | | |
| Ce produit se vend : Par kilo / Par pièce | oui · `retail.unit` (`kg` / `unit`) | `parseRetail` › `base` | `qtyLabel` (« 500 g », « 3 sachets »), icône « Produit initial » | OK |
| Prix global par kilo / par pièce | oui · `retail.price` (€ ; `null` = non fixé) | `parseRetail` › `base` (`price`, `noPrice`) | `priceText` : ProductCard, ProductScreen, panier | OK |
| Prix par pays (particuliers) | oui · `retail.countryPrices[{countries, price}]` | `parseRetail` › schema.ts `forCountry` (store.tsx `spaceFor`) | Prix du pays du client à la place du prix global | OK |
| Libellé de l'unité (à la pièce ; « le kg » forcé au kilo) | oui · `retail.unitLabel` | `base` | `unitShort` / `unitTiny` à côté du prix, carte « Produit initial » | OK |
| Nom au singulier / au pluriel | oui · `retail.noun` | `base` | `qtyLabel`, message d'ajout (`addedMessage`) | OK |
| Palier | oui · `retail.step` | `base` | Stepper +/− | OK |
| Minimum | oui · `retail.min` | `base` | Quantité de départ (`minQty`), `clampQty` | OK |
| Maximum | oui · `retail.max` (vide → palier × 20 dans l'app) | `base` › `maxQty` | Toast « Quantité maximale atteinte » | OK (mais hérité à tort par les emballages, voir plus bas) |
| **Prix grossistes et importateurs** | | | | |
| Ajouter l'avion / le bateau / une offre standard | oui · `wholesale[].mode` (`avion`, `bateau`, `null`) | `parseWholesale` (mode inconnu écarté) › `wholesaleSpace` (une ligne par mode) | OfferPicker (choix du mode), modes sur ProductCard | OK |
| Offre ouverte aux commandes (interrupteur de l'offre) | oui · `wholesale[].available` | `wholesaleSpace` | Offre fermée absente | OK |
| Prix EXW global / Prix FOB global | oui · `wholesale[].prices.EXW` / `.FOB` | rules.ts › `resolveOffer` | IncotermToggle, `priceText` (`shownPrice`), total ; vide → « Prix à confirmer » | OK |
| Prix EXW / FOB dans ces pays | oui · `wholesale[].countryPrices[{countries, prices}]` | `parseWholesale` › `forCountry` (champ vide = prix global) | Prix du pays du client | OK |
| Le prix s'exprime : Au kilo / Au conteneur (bateau) | oui · `wholesale[].priceUnit` | `resolveOffer` | « le conteneur », « Soit X € le conteneur de N kg » (OfferPicker) | OK |
| Quantités propres à cette offre (minimum, palier, maximum) | oui · `wholesale[].minQty`, `stepQty`, `maxQty` | `resolveOffer` | OfferPicker `ruleText`, `checkQuantity` | CORRIGÉ — l’offre sans mode garde ses minimum / palier / maximum (app `wholesaleSpace`) |
| Poids d'un conteneur : Référence / Propre / Non défini | oui · `wholesale[].containerKg` (absent / nombre / `null`) | `resolveOffer` | Total au conteneur ; `ruleText` « 18 000 kg par conteneur (référence Europe) » | CORRIGÉ — « (référence …) » seulement pour le poids de référence (app `build.ts` › `line`) |
| **Emballages** | | | | |
| Nom de l'emballage | oui · `formats[].label` ; `noun` et `unitLabel` (« par box de 4 kg ») déduits | `parseFormat` › `mapFormat` / `formatLine` | FormatPicker, sous-titre ProductScreen, panier (`qtyLabel` avec `noun`) | CORRIGÉ — nom pris avant « de », accordé (« petits cartons ») (tour `nounOf`) |
| Photo de l'emballage | oui · `formats[].photo.url` (sinon `photo.asset` + `preview.asset` embarqués) | build.ts › `formatPhotoOf` / `formatPreviewOf` | Vignette FormatPicker (le haut de fiche garde la photo du produit : pas d'aperçu pour une photo envoyée) | OK |
| Description de l'emballage | oui · `formats[].description` | `mapFormat` › `formatDescription` | ProductScreen, au-dessus de la description, quand l'emballage est choisi | OK |
| Quantité contenue + unité (kg / g / pièces) | oui · `formats[].grams` (kg, g), `detail` « 6 pièces », `unit` | `parseFormat` | « contient 4 kg », « / 4 kg », « Contenu total » ; pièces : détail sous le nom | OK |
| Prix de l'emballage entier | oui · `formats[].price` (`null` = à compléter), `currency: 'EUR'` | `formatLine` (`price`, `noPrice`) | « 12,00 € / 4 kg » ; vide : « Prix à compléter » et ajout refusé (toast) | OK |
| Palier (en emballages) | oui · `formats[].step` | `formatLine` | Stepper | OK |
| Minimum (en emballages) | oui · `formats[].min` (= palier si vide) | `formatLine` | Quantité de départ | OK |
| Maximum (vide = « aucun maximum ») | oui · `formats[].max` (absent si vide) | `formatLine` : `...p` garde `p.max` du produit | `clampQty` / `maxQty` | CORRIGÉ — maximum vide = aucun maximum (app `formatLine`) |
| Proposé à : Tous | oui · format publié (le public n'est pas transmis) | `retailSpace` | ProductScreen : FormatPicker seulement si `!isPro` | NON (restant, décision) — les pros commandent par offres ; la tour le dit sous « Proposé à » |
| Proposé à : Particuliers | oui · format publié | `retailSpace` | FormatPicker | OK |
| Proposé à : Pros | **non** (`productOf` retire `audience === 'pros'`) | — | Rien | NON (restant, décision) — non proposé ; la tour l’annonce clairement sous « Proposé à » |
| Emballage N proposé (actif) | oui · masqué = retiré du document (`buildDocument`) | — | Absent | OK |
| Pays par pays : pays du réglage | oui · `formats[].settings[{mode:'pays', countries}]` | `parseFormatSetting` › rules.ts `resolveFormatForCountry` | Appliqué au pays du client | OK |
| Proposé dans ces pays (oui/non) | oui · `settings[].available: false` | `resolveFormatForCountry` → emballage retiré | Absent dans ces pays | OK |
| Prix d'origine / Prix propre en euros | oui · `settings[].price` (+ `currency: 'EUR'`) ; absent = prix d'origine | `resolveFormatForCountry` | Prix du pays dans FormatPicker et le panier | OK |
| Devise de ce prix : Franc CFA | oui · `settings[].currency: 'XOF'` | `resolveFormatForCountry` › `formatLine.currency` | `money` « 12 500 F CFA », un sous-total par devise | CORRIGÉ — forfait Sénégal / Afrique de l’Ouest réglable en F CFA ; jamais additionné à une autre devise |
| Photo propre à ces pays / Même photo | oui · `settings[].photo.url` | `resolveFormatForCountry` (remplace `photo`) | Vignette du pays | OK |

## 2. Rayons (`src/pages/Categories.tsx`, `api/categories.js`, filtres d'accueil `api/settings.js` › `filters`)

| Champ (tour, libellé à l'écran) | Publié dans ?v=2 | Lu par l'app | Affiché dans l'app | Verdict |
|---|---|---|---|---|
| Nom du rayon | oui · `categories[].label` | schema.ts › `parseCategories` › build.ts `shelvesOf` | Pastilles de l'accueil, pastille de rayon ProductScreen | OK |
| Identifiant (création) | oui · `categories[].id` | `parseCategories`, `categoryOf` | Rattache les produits | OK |
| Ordre (Monter / Descendre) | oui · `categories[].order` (index trié par `sort_order`) | `parseCategories` trie | Ordre des pastilles | OK |
| Importer une image | oui · `categories[].image.url` | `shelvesOf` › HomeScreen `shelfPhoto` (une adresse passe en premier) | Pastille du rayon | OK |
| Rapport de l'image (`image_ratio`, calculé) | **non** | `shelfPhoto` : rapport 1 pour une adresse | Taille de la pastille | NON (restant) — même raison que le rapport des photos produit |
| Photo d'un produit (produit d'illustration) | oui · `categories[].image.asset = <id produit>` | `shelfImage` : `PHOTO_ASSETS[asset]` | Pastille | CORRIGÉ — produit choisi dans la tour respecté ; sa photo envoyée est publiée |
| Rayon visible par les grossistes et importateurs | oui · `categories[].pro` + `wholesale: []` pour ses produits (`proHidden`) | `Shelf.pro` lu mais inutilisé ; `wholesaleSpace` ne garde rien | Produits absents de l'espace pro (qui n'affiche pas de rayons) | OK |
| Créer un rayon | oui · nouvelle entrée `categories[]` (une fois validée) | `categoryOf` l'accepte | Pastille dès qu'il a des produits | OK |
| Supprimer ce rayon (bloqué s'il contient des produits) | oui · retiré | — | Disparaît | OK |
| Filtre « Tout » / « De saison » : nom | oui · `filters.all.label`, `filters.season.label` | `parseFilters` › `shelvesOf` | Deux premières pastilles | OK |
| Filtre « Tout » / « De saison » : photo | oui · `filters.*.image.url` | `shelfPhoto` | Pastille | OK |

## 3. Publications (`src/pages/Publications.tsx`, `src/components/PhotoPost.tsx`, `api/publications.js`, `api/catalog.js`)

| Champ (tour, libellé à l'écran) | Publié | Lu par l'app | Affiché dans l'app | Verdict |
|---|---|---|---|---|
| **Vidéos** (`/api/publications?public=videos`) | | | | |
| Fichier vidéo (Choisir / Remplacer) | oui · `[].videoUrl` | lib/videos.ts › `fetchTeamVideos` (`source`) | Reels (Favoris › Découvrir) | OK |
| Aperçu (extrait du fichier) | oui · `[].posterUrl` | `fetchTeamVideos` (`poster`) | Image d'attente de Reels | OK |
| Titre | oui · `[].title` | `fetchTeamVideos` | Reels : seulement `accessibilityLabel` et « Aucun commentaire sur « … » » | NON (restant, design des vidéos) — la tour précise « non affiché sur la vidéo » |
| Description | oui · `[].description` | `fetchTeamVideos` | Jamais rendue (Reels : « Aucun texte de description ») | NON (restant, design des vidéos) — la tour précise « pas encore affichée » |
| Visible par : Tous / Particuliers / Pros | oui · `[].audience` | `videosFor` | Filtre par type de compte | OK |
| Date affichée | oui · `[].publishedAt` | `fetchTeamVideos` | Reels `formatDay`, tri | OK |
| Publiée | oui · seules les publiées validées | — | Brouillon absent | OK |
| **Publications photo** (`?public=photos`) | | | | |
| Photos (1 à 10) et leur ordre (Plus tôt / Plus tard) | oui · `[].images[{url, width, height}]` | lib/posts.ts › `fetchPhotoPosts` | PhotoPosts : carrousel, rapport de la 1re photo | OK |
| Description | oui · `[].description` | `fetchPhotoPosts` | Sous les photos | OK |
| Visible par | oui · `[].audience` | `postsFor` | Filtre par compte | OK |
| Date affichée | oui · `[].publishedAt` | `fetchPhotoPosts` | `formatDay` | OK |
| Publiée | oui · seules les publiées validées | — | Brouillon absent | OK |
| **Annonces** (`campaigns` de ?v=2 ; ni les vidéos ni les photos n'ont de produit lié, dans la tour comme dans l'app) | | | | |
| Présentation : Modèle / Image | oui · modèle : `campaigns[]` sans `photo` ; image : `campaigns[].photo.url` | schema.ts › `parseCampaign` › build.ts `docCampaigns` › HomeHero `buildSlides` | Bandeau d'accueil | OK |
| Produit mis en avant / produit ouvert | oui · `campaigns[].id` (annonce retirée si le produit n'est pas commercialisé) | HomeScreen `liveCampaigns` (produit présent dans l'espace), `buildSlides` | Titre = nom, photo du produit, toucher → fiche | OK |
| Accroche | oui · `campaigns[].accent` | `buildSlides` | Sous le nom, dernier mot doré | OK |
| Texte (modèle) | oui · `campaigns[].body` | `buildSlides` | Deux lignes | OK |
| Texte sur l'image (annonce image) | oui · `campaigns[].body` | `buildSlides` | Rendu seulement si lien « Bouton » ; « Toucher l'image » / « Aucun » : texte non rendu | NON (restant, choix « image seule ») — la tour l’annonce sous le champ |
| Quand le client touche : Bouton / Toucher l'image / Aucun | oui · `campaigns[].link` (`id: null` pour « Aucun ») | `SlideView` `onPress` | Bouton, image cliquable, ou image seule | OK |
| Texte du bouton | oui · `campaigns[].cta` (défaut « Voir le produit ») | `slide.cta` | Bouton du bandeau | OK |
| Durée / début et fin | oui · `campaigns[].startsAt` / `endsAt` (et seules les annonces en cours sont publiées) | lib/format.ts › `campaignActive` | Allumée et éteinte à l'heure | OK |
| Annonce activée | oui · seules les activées validées ; `enabled: true` | `campaignActive` | — | OK |
| Ordre (Monter / Descendre) | oui · ordre du tableau (`sort_order`) | `buildSlides` | Ordre des diapositives | OK |
| (aucun champ) Surtitre et titre | **non** : clés `kicker` / `title` lues par l'app, jamais publiées | `buildSlides` les déduit | « Campagne en cours » / « Campagne à venir · dès mai », nom du produit | CORRIGÉ — champs « Surtitre » et « Titre » (facultatifs) dans l’éditeur, publiés en `kicker` / `title` |

## 4. Réglages (`src/pages/Settings.tsx`, `api/settings.js` ; GP : `src/pages/Orders.tsx` › Livraison, `api/orders.js`)

| Champ (tour, libellé à l'écran) | Publié dans ?v=2 | Lu par l'app | Affiché dans l'app | Verdict |
|---|---|---|---|---|
| Avion — minimum, palier, maximum (kg) | oui · `rules.avion.minKg/stepKg/maxKg` | schema.ts › `parseRules` › `resolveOffer` | OfferPicker `ruleText`, `checkQuantity` (palier strict), ProfileScreen `proRulesText` | OK |
| Bateau — minimum, palier, maximum (conteneurs) | oui · `rules.bateau.minContainers/stepContainers/maxContainers` | `parseRules` › `resolveOffer` | Idem, conteneurs entiers | OK |
| Poids de référence d'un conteneur | oui · `rules.bateau.containerKg` (vide → `null`) | `resolveOffer` | Total au conteneur ; vide : nombre de conteneurs seul | OK |
| Précision (« Europe ») | oui · `rules.bateau.containerLabel` | build.ts `line` › `containerLabel` | « (référence Europe) » dans OfferPicker | OK (voir le NON « poids propre ») |
| Offres sans mode — minimum, palier, maximum (kg) | oui · `rules.standard.*` | `resolveOffer` | Offres sans mode et tous les « autres professionnels » | OK |
| Moyens de paiement (4 interrupteurs) | oui · `payments[{id, title, detail, icon, enabled}]` (activés seulement) | `parsePayments` › store `payments` | CheckoutScreen, liste des moyens | OK |
| Transport des particuliers (6 zones, €) | oui · `transport{currency:'EUR', zones[{id, label, fee}]}` (une fois validé) | `parseTransport` › lib/countries.ts `transportFee` | Forfait au panier et à la validation | OK (euros seulement : voir le NON franc CFA) |
| Filtres de l'accueil (nom, photo) | voir bloc 2 | — | — | — |
| Produit introuvable : activé, titre, message, texte du champ, bouton, confirmation (page Demandes) | oui · `productRequest{enabled, title, body, placeholder, button, thanks}` | `parseProductRequest` › store (exige `TEAM_ENDPOINT`) | MissingProduct, recherche sans résultat sur HomeScreen | OK |
| Livraison GP : pays desservis | oui · `delivery.gp[].country` (Sénégal exclu) | `parseDelivery` | CheckoutScreen, transport vers ce pays | OK |
| Livraison GP : L'aéroport / Porte à porte | oui · `delivery.gp[].options` (`aéroport` / `domicile`, la même pour tous les pays) | `parseDelivery` | « Livraison via GP : jusqu'à l'aéroport » | OK |
| Nom et WhatsApp du GP, livreurs | non (chiffrés, volontairement) | — | — | OK |

## Remarques hors tableau (vérifiées, sans ligne propre)

- ~~`?v=2&pays=XX` : devise d'un prix propre en F CFA annoncée en euros~~ — CORRIGÉ (`formatOf` publie la devise de l'emballage). Latent, à corriger avant tout usage de `pays`.
- Vendre uniquement en emballage est impossible : sans prix global, `retailSpace` exclut le produit, et FormatPicker propose toujours « Produit initial » (au kilo ou à la pièce). La tour le dit dans l'aide du prix ; c'est une limite, pas une perte de donnée.
- Le libellé « Pour les grossistes et importateurs » couvre en réalité tous les comptes pro de l'app (restaurants, etc.).

## Décompte

98 lignes jugées (sans compter les en-têtes de rubrique ni la ligne de renvoi « Filtres ») : **83 OK, 15 NON**. Les 15 NON se regroupent en 12 problèmes : « Tous » et « Pros » font un problème, les deux rapports de photo un autre, le titre et la description des vidéos un troisième.

## Les NON, par ordre d'importance

1. **Emballage : maximum vide hérité du produit.** Le client est bloqué au maximum particulier (5 kg → 5 cartons) ou à 20 paliers, au lieu de « aucun maximum ». Correctif : dans `formatLine`, ne jamais reprendre `p.max` et porter un maximum explicite (ou « illimité ») pour les emballages. Fichiers : app `lib/catalog/build.ts` (`formatLine`), `lib/format.ts` (`maxQty`), `lib/store.tsx` (`clampQty`).
2. **Prix propre en franc CFA + transport.** Au Sénégal avec transport, le total devient « À confirmer » et le paiement est bloqué ; la commande enregistre un total F CFA + €. Correctif : publier le forfait Sénégal en XOF (ou un forfait par devise), et ne jamais additionner des devises dans `placeOrder`. Fichiers : tour `shared/transport.js`, `api/catalog.js`, `src/pages/Settings.tsx` ; app `lib/catalog/schema.ts` (`parseTransport`), `lib/store.tsx` (`placeOrder`), `screens/CheckoutScreen.tsx`.
3. **Emballages « Pros » jamais publiés, « Tous » jamais montrés aux pros.** Correctif : publier le public de chaque emballage et afficher FormatPicker dans l'espace pro, ou retirer ces deux choix de la tour tant que l'app ne les gère pas. Fichiers : tour `shared/catalog-v2.js` (`productOf`, `formatOf`), `src/pages/ProductEditor.tsx` ; app `lib/catalog/schema.ts`, `lib/catalog/build.ts` (`wholesaleSpace`), `screens/ProductScreen.tsx`.
4. **Quantités propres d'une offre ignorées pour les « autres professionnels ».** Correctif : recopier `minQty`, `stepQty`, `maxQty` (et `containerKg`) dans l'offre recréée par `wholesaleSpace` (`!modes`), ou dire dans la tour qu'elles ne valent que pour les grossistes et importateurs. Fichiers : app `lib/catalog/build.ts` ; tour `src/components/OfferCard.tsx`.
5. **Texte d'une annonce image invisible avec « Toucher l'image » ou « Aucun ».** Correctif : afficher `body` en bas de l'image en mode `imageOnly`, ou masquer ce champ dans la tour pour ces deux liens. Fichiers : app `components/HomeHero.tsx` (`SlideView`) ; tour `src/pages/Publications.tsx`.
6. **Produit d'illustration d'un rayon ignoré.** Correctif : publier l'adresse de la photo du produit quand il en a une (`categoriesOf`), et faire passer l'image de la tour avant `FILTER_PHOTO`. Fichiers : tour `shared/catalog.js` (`buildDocument`), `shared/catalog-v2.js` (`categoriesOf`) ; app `screens/HomeScreen.tsx` (`shelfPhoto`).
7. **Titre et description des vidéos jamais affichés.** Correctif : les montrer dans le bloc méta de Reels, ou retirer ces champs de la tour. Fichiers : app `components/Reels.tsx` ; tour `src/pages/Publications.tsx`.
8. **Rapport des photos non publié (produit et rayon).** Correctif : publier `photo_ratio` et `image_ratio` ; l'app s'en sert quand `RATIO[id]` manque ou que la photo vient d'une adresse. Fichiers : tour `shared/catalog.js` (`productToDoc`), `shared/catalog-v2.js` (`categoriesOf`) ; app `lib/catalog/schema.ts`, `build.ts`, `screens/ProductScreen.tsx`, `components/HomeHero.tsx`, `screens/HomeScreen.tsx`.
9. **« (référence Europe) » affiché sur un poids de conteneur propre.** Correctif : n'ajouter la précision que si le poids vient des règles du catalogue. Fichiers : app `lib/catalog/rules.ts` (`resolveOffer`), `components/OfferPicker.tsx` (`ruleText`).
10. **Nom d'unité d'un emballage = 1er mot du libellé.** Correctif : ajouter « nom au singulier / pluriel » à l'emballage, ou prendre le nom avant « de ». Fichiers : tour `shared/catalog-v2.js` (`nounOf`), `shared/catalog.js` (`validatePackagings`), `src/pages/ProductEditor.tsx`, `src/lib/productForm.ts`.
11. **Surtitre et titre des annonces déduits par l'app, invisibles dans la tour.** Correctif : champs facultatifs dans l'éditeur, publiés en `kicker` / `title` (l'app les lit déjà). Fichiers : tour `src/pages/Publications.tsx`, `api/publications.js`, `api/catalog.js`, `shared/catalog-v2.js` (`campaignsOf`).
12. **Variété ou origine vide : séparateur « · » orphelin.** Correctif : joindre seulement les parties non vides. Fichier : app `screens/ProductScreen.tsx`.
