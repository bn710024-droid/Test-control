# TROPICAURA — Tour de contrôle

Espace d'administration du catalogue de l'application d'achat
(`bn710024-droid/app-tropicaura`, analysée au commit `448f833`). Application distincte : le dépôt
de l'application d'achat n'est pas modifié.

## Nuit du 27/11/2026 — branchement réel de l'application (branche `nuit-branchement`)

**Fait**
- `GET /api/catalog?v=2` : catalogue **au format de l'application** (`schema: 2`,
  `shared/catalog-v2.js`) — `formats` (emballages : contenu en grammes, prix de l'emballage
  entier, `null` conservé, réglages par pays), `visibility`, `campaigns`, `delivery.gp`, plus
  `categories`, `filters`, `payments`, `productRequest`, `countryPrices`. Sans `v` : document
  historique inchangé. Test de contrat : `node scripts/test-catalog-v2.mjs` (12/12).
- Livraison GP par pays : Commandes › Livraison › « Pays desservis par le GP », publiés dans
  `delivery.gp` (copie publique scellée `settings.gp`, rien de personnel).
- Commandes : devise (`currency`) et « pour un proche » enregistrées ; montants affichés dans la
  devise de la commande (F CFA…) ; statistiques et clients : les sommes en € ne comptent que les
  commandes en € (« N commande(s) dans une autre devise, non comptée(s) »).
- Emballages publiés avec un libellé d'unité neutre (« par cagette de 5 kg »).
- Textes devenus faux corrigés : plus de « appliquez le correctif » (le correctif
  `public/branchement/app-tropicaura.patch` est **obsolète**, voir LISEZ-MOI), adresse `?v=2`,
  variable `EXPO_PUBLIC_CONTROL_TOWER_URL`.
- `npm run local` : tour complète (API + front) sur http://localhost:3000 **sans Supabase**,
  base locale `.local-db/` remplie avec le catalogue d'exemple de l'application. Développement
  et tests uniquement.
- `supabase/schema.sql` : tables `product_requests` et `publication_reactions` documentées.
- Lint : 0 erreur (typographie française tolérée) ; import `.vite-source-tags.js` retiré ;
  paquet renommé `tropicaura-tour` ; `.env.example` (noms des variables, sans valeurs).

**Testé réellement** (Chromium, 1440×900, tour locale) : `npm run build` OK ; 13 pages et
17 gestes sans erreur console / réseau ; bout en bout avec l'application (dépôt
Test-app-tropicaura, `scripts/test_tower_live.py`, 36/36) ; fiche produit modifiée et
enregistrée via l'interface (scellé valide). **Non testé** : base Supabase réelle,
déploiement Vercel.

**Restant** : `ERREURS.md` (statistiques multi-devises, annonce image sans produit…) et
`A-CONNECTER.md` du dépôt de l'application (variables, tables, sécurité).

## Ce que fait cette administration

- Produits : liste, recherche, filtres, fiche complète, photo, prix, unité, saison, visibilité.
- Offres professionnelles : avion, bateau, standard ; prix EXW / FOB ; minimum, palier, maximum ;
  poids du conteneur par offre. Calculs repris de `lib/catalog/rules.ts`.
- Rayons : nom, illustration ronde, ordre.
- Publication : `GET /api/catalog` renvoie le document au format `lib/catalog/schema.ts`
  (`schema: 1`).

## Relier l'application d'achat (étape manuelle, non faite)

1. Dans le dépôt de l'application, ouvrir `lib/config.ts`.
2. Remplacer `CATALOG_ENDPOINT = null` par `https://<domaine-de-cette-administration>/api/catalog`.
3. Publier l'application. Ce chemin (`lib/catalog/source.ts`) n'a jamais été exercé contre un
   vrai serveur : le tester avant mise en service.

Limites connues côté application : ses rayons (noms, ordre, illustrations) sont écrits dans son
code ; un rayon inconnu est affiché sous « Fruits ». Commandes, demandes, comptes et avis restent
sur l'appareil du client : ils ne sont pas administrables ici.

## Branchement de l'application mobile

L'application d'achat est un projet à part : rien de ce qui est fait ici ne peut la modifier
directement. `public/branchement/app-tropicaura.patch` est le correctif à appliquer à son dépôt
(commit `448f833`, `git apply`) ; `public/branchement/LISEZ-MOI.txt` en donne le détail. Les deux
sont téléchargeables depuis Réglages → Publication.

Vérifié : le correctif s'applique proprement, l'application corrigée passe `tsc --noEmit` et
s'exporte pour le web (`expo export --platform web`). Une fois appliqué, l'application relit le
catalogue (`/api/catalog` : produits, prix, règles, `categories`, `filters`, `campaigns`, `banners`,
`payments`), les vidéos et le suivi des commandes à l'ouverture, toutes les 60 secondes et à
chaque retour au premier plan.

## Demandes professionnelles (B2B)

Rien n'est payé dans l'application. Le grossiste ou l'importateur envoie son intérêt
(`POST /api/orders`, `type: 'demande_professionnelle'`) ; l'équipe le contacte (e-mail, téléphone
et WhatsApp sont dans la fiche) et fait avancer la demande d'étape en étape (`PRO_STAGES`,
`shared/orders.js`) :

| Étape | Statut dans l'application | Sens |
|---|---|---|
| `interet` Intérêt reçu | `attente` | Premier contact : le client a envoyé son intérêt |
| `contacte` Contacté | `attente` | L'équipe l'a contacté |
| `discussion` En discussion | `attente` | Quantités, prix, transport, paiement |
| `contrat` Contrat conclu | `confirmee` | La commande est ferme |
| `preparation` En préparation | `preparation` | Marchandise en préparation |
| `livraison` En livraison | `expediee` | Marchandise en route |
| `livree` Livrée | `livree` | Réception confirmée |
| `annulee` Sans suite | `annulee` | Demande classée |

Le paiement se règle par contrat ; il peut être pointé pour mémoire, sans rien bloquer. Pour les
particuliers (B2C), le paiement reste obligatoire avant toute confirmation.

## Rayons et filtres de l'accueil

Page « Rayons » : chaque rond de l'aperçu « Sur l'accueil de l'application » s'ouvre pour
modifier son nom et sa photo — les rayons, et les deux filtres « Tout » et « De saison »
(réglage `filters`, publié dans le catalogue sous la clé `filters`). L'application d'achat lit
aujourd'hui ces noms et ces images dans son code : ils s'y afficheront après sa mise à jour.

## Phase de test : accès ouvert

`shared/access.js` contient `OPEN_ACCESS = true` : l'administration s'ouvre sans connexion et tout
est modifiable par quiconque a l'adresse (commandes et coordonnées des clients comprises). Les
adresses e-mail de l'équipe restent masquées sans connexion. **À repasser à `false` avant de
relier de vrais clients** : la connexion et les rôles reprennent aussitôt, sans autre changement.

## Atelier de configuration et aperçu client

Dans une fiche produit, chaque bloc a un bouton « Agrandir » : il prend alors tout l'écran, avec
à côté la fiche telle que le client la verrait (particulier ou professionnel), mise à jour à
chaque frappe. « Terminé » le replie. Les annonces s'éditent de la même façon, avec l'accueil de
l'application en aperçu.

## Pays où un produit s'affiche

Fiche produit › « Pays » : trois niveaux — monde entier, Sénégal uniquement, ou monde entier sauf
les pays choisis. Rangé dans la table `zones` (une ligne par produit, absente = monde entier) et
publié avec chaque produit sous `countries`. `GET /api/catalog?pays=SN` renvoie le catalogue tel
que le voit un client de ce pays. La page Produits se filtre par pays (« vu depuis ») ou par
réglage.

## Livraison

- Sénégal : à domicile, par nos livreurs à moto. L'application envoie la position du téléphone
  avec la commande (`location`) si le client l'autorise, puis la rafraîchit tant que la commande
  est en cours (`POST /api/orders { action: 'position' }`). La fiche de la commande affiche la
  position, l'itinéraire, et un message WhatsApp pour le livreur choisi (adresse, position,
  numéro du client). La position est chiffrée avec la commande.
- International : par GP, jusqu'à l'aéroport d'arrivée ou porte à porte. Réglage général dans
  Commandes › Livraison (`gpDelivery`), modifiable commande par commande (`delivery`).
- Limite : la position n'arrive que lorsque l'application du client est ouverte ; il n'y a pas
  de carte en direct ni de suivi du livreur lui-même.

## Aperçus client

Les aperçus (`src/components/Preview.tsx`) reprennent la composition des écrans de l'application
publique (commit `448f833`) : accueil — recherche, rayons, « En ce moment » en rangée, « Tout
l'étal » en grille, barre d'onglets ; fiche produit — barre haute (retour, panier), cœur, grande
photo, étiquettes, nom, prix, description, saison, puis le quai d'achat (quantité, total,
« Ajouter »). Le sélecteur de quantité applique le palier, le minimum et le maximum saisis.
Le bloc « Emballage » n'existe pas dans l'application : l'aperçu le place là où elle met son
sélecteur d'offres.

## Emballages par pays

Deux réglages distincts, à ne pas confondre :

- **où le produit s'affiche** — rubrique « Pays » de la fiche (table `zones`, clé `countries` du
  catalogue). Tant qu'un produit n'est pas affiché dans un pays, le client de ce pays ne le voit
  pas, emballages compris ;
- **un emballage dans un pays** — `countryRules` de l'emballage : `[{ countries, available,
  price }]`. `available: false` : non proposé dans ces pays. `price: null` : prix d'origine (il
  suit le prix de l'emballage) ; sinon, prix propre à ces pays. Un pays ne figure que dans un
  réglage par emballage.

**Description.** Chaque emballage peut porter une phrase (`description`, facultative, 200
caractères au plus) : celle que le client lit sur la fiche, au-dessus de la description du produit,
quand il choisit cet emballage. Elle est la même dans tous les pays.

**Photos.** Chaque emballage a sa photo (`photo_url`) : celle de tous les pays. Un réglage par
pays garde cette photo (`photo_url: null` — même emballage, seul le prix peut changer) ou porte
une photo propre à ces pays. Les images sont préparées dans le navigateur, envoyées à
`/api/upload` (`kind: 'packagings'`) dès qu'elles sont choisies, et rattachées à la fiche à
l'enregistrement ; les fichiers retirés ou remplacés sont effacés. Un emballage sans photo est
signalé (« Photo à ajouter »), sans blocage.

**Écran.** Emballages, réglages par pays et offres professionnelles tiennent chacun en une ligne
(`RuleRow`) : « Modifier » ouvre le détail, × retire (avec « Annuler »). Un bloc qui contient
une erreur ne reste jamais replié.

Un réglage d'emballage s'enregistre même pour un pays où le produit n'est pas affiché : il est
gardé et s'applique le jour où le produit y est affiché. L'écran le dit, sans bloquer. Calcul :
`packFor(pack, country)` (`shared/catalog.js`). `/api/catalog` publie l'emballage d'origine et
`countryRules` ; `/api/catalog?pays=FR` publie les emballages proposés en France, à leur prix
en France. L'application n'affiche pas encore les emballages : ces réglages vivent dans
l'administration, son aperçu (« Vu depuis ») et le catalogue publié.

## Prix par public et par pays

Deux publics, deux jeux de prix, jamais mélangés : `retail` (particuliers) et `wholesale`
(grossistes et importateurs). Dans la fiche produit, allumer un public ouvre la fenêtre de ses
prix (« Prix particuliers », « Prix grossistes et importateurs »). Un prix professionnel au kilo
identique au prix particulier est signalé, sans blocage.

Pour chaque public, le prix saisi est le **prix global** : il vaut pour tous les pays, sauf ceux
qui ont leur propre prix (`countryPrices`, rangé dans `retail` et dans chaque offre de
`wholesale`) :

- `retail.countryPrices: [{ countries, price }]` — le prix est obligatoire ;
- `wholesale[i].countryPrices: [{ countries, prices: { EXW, FOB } }]` — au moins un prix ; un
  incoterm vide garde le prix global.

Un pays ne figure que dans un groupe par offre (`validateProduct`). Calcul : `retailPriceFor`,
`offerPricesFor` (`shared/catalog.js`). `/api/catalog` publie le prix global et `countryPrices` ;
`/api/catalog?pays=SN` publie le prix de ce pays, sans la clé. La page Prix modifie le prix
global et signale les produits dont des pays ont leur prix. L'application corrigée applique le
prix du pays du client (`forCountry`, `lib/catalog/schema.ts`) : vérifié sur sa version web, en
changeant le pays de l'appareil.

## Emballages

Table `packagings` (une ligne par produit, `items` en JSON). Un emballage se décrit en trois
temps, qui ne se mélangent pas :

- **son contenu** (`qty` + `unit` : kg, g ou pièces), **obligatoire** — ce qu'il y a dans UN
  emballage : un box de 4 kg, un sachet de 200 g, une barquette de 6 pièces ;
- **son prix** (`price`) — toujours celui de l'emballage entier, jamais un prix au kilo. Le prix
  au kilo ou à la pièce est le prix global du produit (`retail`). Un emballage de plusieurs
  kilos au prix d'un seul kilo est signalé à l'écran (`packPriceAlert`), sans blocage ;
- **le nombre d'emballages commandés** (`step`, `min`, `max`) — toujours des emballages entiers.
  Palier vide : 1. Minimum vide : un palier. Maximum vide : aucun maximum fixé (`null`), rien
  n'est supposé à la place. Le minimum doit être un multiple du palier, et le maximum doit
  tomber sur un palier.

S'y ajoutent le nom, le prix d'UN emballage (facultatif), le public (tous, particuliers, pros)
et l'état proposé / masqué. Tout se modifie à tout moment dans la fiche produit (rubrique
Emballages → « Modifier »), avec l'aperçu client à côté.

Ces règles sont propres aux emballages. Elles ne remplacent ni la vente au détail du produit
(palier, minimum, maximum en kilos ou en pièces — rubrique « Vente et prix »), ni les offres
professionnelles (minimum et palier par mode de transport, en kilos ou en conteneurs).

Publication : clé `packagings` de chaque produit du catalogue —
`{ id, label, qty, unit, price, step, min, max, audience }`, où `step` et `min` sont toujours
des nombres et `max` vaut `null` quand aucun maximum n'est fixé. **L'application d'achat ne lit
pas cette clé** : ni le dépôt public ni le correctif de branchement n'affichent les emballages.
Tant que ce n'est pas développé de son côté, les emballages n'existent que dans cette
administration et dans son aperçu.

Vente à la pièce : le libellé de l'unité ne peut pas être « le kg ». Il est corrigé à la saisie
et, par sécurité, par le serveur (« la pièce », ou « par sachet » selon le nom de l'unité).

## Produits introuvables

Écran **Introuvables** (`src/pages/Requests.tsx`, route `#/introuvables`, entre Rayons et
Publications ; sous « Plus » sur téléphone). Un client cherche un produit absent du catalogue :
l'application lui demande lequel et transmet sa demande.

- **Message au client** — réglage `missing` (`/api/settings`, toute l'équipe) : `{ enabled,
  title, body, placeholder, button, thanks }`, contrôlé par `validateRequestMessage`
  (`shared/requests.js`) et publié dans le catalogue sous `productRequest`. Jamais réglé : les
  textes par défaut (`DEFAULT_REQUEST_MESSAGE`). Désactivé : l'application ne propose rien.
- **Demandes** — table `product_requests` (`id`, `enc`, `received_at`), chiffrée comme les
  commandes (`vaultSeal`). Pas de nouvelle fonction serveur : tout passe par `/api/orders`, que
  l'application appelle déjà.
  - `POST { type: 'produit_introuvable', product, details?, customer, country }` : réception sans
    connexion ; un e-mail ou un téléphone est exigé ; le même compte qui redemande le même
    produit ne crée pas de doublon ; trente demandes par minute au plus.
  - `GET ?vue=introuvables` : équipe uniquement. `PUT { request: { id, status?, note? } }` :
    étape (`nouvelle`, `etude`, `prevenu`, `ecartee`) et note interne. `DELETE { requestId }` :
    responsables.
- **Écran** — une ligne par demande (`RuleRow`), « Traiter » ouvre la fiche : le client, de quoi
  le recontacter (WhatsApp, appel, e-mail préremplis), l'étape, la note. « Créer la fiche de ce
  produit » ouvre un nouveau produit au nom demandé (`#/produits/nouveau?nom=…`).
- **Application** — le correctif ajoute `components/MissingProduct.tsx` à la recherche de
  l'accueil. Vérifié sur la version web de l'application corrigée : message lu depuis la tour,
  envoi, arrivée de la demande, désactivation.
- **Non fait** : aucune notification n'est envoyée au client (ni e-mail, ni SMS, ni notification) —
  l'équipe le recontacte elle-même, et « Client prévenu » se coche à la main ; le suivi n'est pas
  renvoyé à l'application ; aucun compteur de nouvelles demandes sur l'onglet ni sur « Contrôle ».

## Publications (vidéos, photos) et annonces : deux espaces distincts

**Espace Publications** — dans l'application : Favoris › Publications. Vidéos et publications
photo de l'équipe, et rien d'autre : le client regarde, aime, commente. Rien n'y mène à un produit.

- **Vidéos** (`kind = 'video'`) : `/api/publications?public=videos`.
- **Publications photo** (`kind = 'photos'`) : une à dix photos que le client fait défiler de côté,
  avec une description dessous. `/api/publications?public=photos` : `{ id, images: [{ url, width,
  height }], description, publishedAt, audience }`. Les images sont ramenées à 1 600 px dans le
  navigateur, puis envoyées au stockage (`publications/photos/`) ; les fichiers retirés ou
  remplacés sont effacés.
- **Statistiques** : l'application envoie l'état de chaque compte (publications vues, aimées,
  commentaires) à `POST /api/publications?public=reactions` ; la table `publication_reactions`
  est alignée sur cet état (une ligne par vue, J'aime ou commentaire ; un renvoi ne change rien).
  `GET /api/publications` donne les totaux (`stats`) ; `GET /api/publications?reactions=<id>` le
  détail (nom du compte, geste, texte du commentaire, date), réservé à l'équipe. Supprimer une
  publication supprime ses statistiques. La table `reactions` (vide) n'est pas utilisée.

**Annonces** (`kind = 'annonce'`) — le bandeau en haut de l'accueil, et lui seul. Pas de
statistiques. C'est le seul endroit où un bouton ou une image mène à un produit.

- Une annonce est soit le modèle (produit, accroche, texte, bouton), soit l'image de l'équipe
  (`image_url`), avec `link` : `none` (image seule), `button` (un bouton ouvre la fiche du
  produit), `tap` (toucher l'image ouvre la fiche).
- `/api/publications?public=annonces` et la clé `banners` du catalogue donnent toutes les annonces
  en cours, dans l'ordre ; la clé `campaigns` ne contient que les annonces au modèle. Une annonce
  dont le produit n'est plus commercialisé n'est plus servie.

**Dans l'application** : le correctif (`public/branchement/app-tropicaura.patch`) apporte tout
cela — l'espace Publications (`screens/FavoritesScreen.tsx`, `components/PhotoPosts.tsx`,
`lib/posts.ts`), l'envoi des statistiques (`lib/videos.ts`, `lib/store.tsx`) et les annonces en
image (`components/HomeHero.tsx`). Vérifié sur la version web de l'application corrigée, branchée
sur cette tour. Les versions iOS et Android n'ont pas été lancées. Sans le correctif,
l'application n'affiche pas les photos et n'envoie aucune statistique.

**À fermer avant la mise en service** : les tables de la base, commandes et statistiques
comprises, sont lisibles directement avec la clé publique du projet (pas de verrou « RLS »
effectif). Un essai de verrou sur `publication_reactions` avec les outils disponibles ici n'a pas
tenu : c'est à régler dans la console Supabase.

## Annonces : durée d'affichage

Une annonce porte `starts_at` et `ends_at` (facultatif). Elle n'est publiée
(`/api/publications?public=annonces`, clé `campaigns` du catalogue) que si elle est activée,
commencée et pas terminée. Aucune annonce en cours : liste vide, donc pas de bandeau.

## Publications

Page « Publications » de la tour de contrôle.

- Vidéos de l'espace « Découvrir » : `GET /api/publications?public=videos` répond au format de
  `fetchTeamVideos` (`lib/videos.ts`). Renseigner cette adresse dans `VIDEOS_ENDPOINT`
  (`lib/config.ts`) pour que l'application les affiche. Les vues, « J'aime » et commentaires que
  l'application enverrait à `VIDEOS_ENDPOINT/views|likes|comments` ne sont pas reçus.
- Annonces du bandeau d'accueil : `GET /api/publications?public=annonces`, au format de
  `CAMPAIGNS` (`lib/data.ts`). L'application lit aujourd'hui cette liste dans son code : il faut
  la modifier pour qu'elle lise l'adresse.
- Fichiers : envoyés directement du navigateur au stockage (50 Mo au plus par vidéo), avec une
  autorisation à usage unique délivrée aux seuls comptes autorisés.

## Mise à jour des onglets ouverts

Après une mise en ligne, un onglet resté ouvert se recharge seul dans les trente secondes (ou
propose « Mettre à jour » si une saisie est en cours).

## Espace commandes

Accessible depuis le tableau de bord (bouton « Commandes ») : commandes, clients, statistiques.

- Statuts d'une commande — ceux de l'application d'achat (`StatusId`, `lib/store.tsx`), repris
  tels quels. L'équipe les change dans la fiche de la commande ; chaque passage est daté.

  | Statut | Dans l'administration | Le client voit (particulier / professionnel) | Sens |
  |---|---|---|---|
  | `attente` | En attente | En validation / En attente de réponse | Commande reçue, paiement attendu |
  | `confirmee` | Confirmée | Validée / Confirmée | Paiement reçu : commande confirmée |
  | `preparation` | En préparation | En préparation | Produits en préparation |
  | `expediee` | Expédiée | Expédiée | En livraison (livreur, ou transit vers l'aéroport) |
  | `livree` | Livrée | Livrée | Reçue par le client (à l'aéroport, à l'international) |
  | `annulee` | Annulée | Annulée | Commande annulée |

  Pas de crédit : `confirmee` et les suivants exigent un paiement pointé. Quand le client
  organise lui-même son transport, l'application affiche « Prête à enlever » et « Enlevée » à
  la place de « Expédiée » et « Livrée ».
- Déroulé d'une commande, côté équipe : la commande arrive (`attente`) → **accuser réception**
  en pointant le paiement reçu (`confirmee`) → **préparer la livraison** (`preparation`) →
  **mettre en livraison** (`expediee`) → **confirmer la réception** quand le livreur confirme
  que le client a reçu (`livree`).
- Page « Statuts » : les commandes en cours (en attente, confirmée, en préparation, expédiée),
  rangées par statut. Le statut se change sur place ; une commande passée à « Livrée » (reçue)
  ou annulée quitte la page et reste consultable dans « Commandes ».
- Notifications au client : à chaque statut correspond un message déjà écrit
  (`shared/orders.js`). Depuis la fiche, l'équipe l'ouvre dans WhatsApp ou dans un e-mail ; la
  fiche note quand et par quel moyen, et la carte porte « Client à prévenir » tant que ce n'est
  pas fait. L'envoi automatique n'existe pas : il demanderait un service tiers (WhatsApp
  Business, SMS, e-mail) ou les notifications de l'application. Les mêmes messages sont publiés
  dans le suivi (`notifications`) pour que l'application les affiche une fois reliée.
- Suivi pour l'application : `GET /api/orders?compte=<identifiant du compte>` (et, au besoin,
  `&suivi=<référence>`) renvoie `{ orders: [{ reference, type, status, statusAt, history, notifications }] }`,
  sans aucune donnée personnelle. **L'application ne lit pas encore cette adresse** : ses
  statuts n'avancent aujourd'hui que par ses boutons « Mode test » (`TEST_TOOLS`). Reste à
  développer côté application : relire cette adresse à l'ouverture et à intervalle régulier,
  remplacer `status` / `statusAt` de chaque commande, puis passer `TEST_TOOLS` à `false`.
  L'identifiant de compte de l'application est prévisible (dérivé de l'heure de création) :
  cette lecture ne livre que des statuts, mais elle est à renforcer avant une mise en service.
- Réception : `POST /api/orders`. Les demandes professionnelles sont acceptées au format de
  `lib/transmission.ts` (`type: 'demande_professionnelle'`, version 2) : il suffit de renseigner
  `TEAM_ENDPOINT = 'https://<domaine>/api/orders'` dans `lib/config.ts` de l'application.
- Commandes des particuliers : l'application ne les envoie pas aujourd'hui (elles restent sur
  l'appareil). Format attendu, à développer côté application : `{ type: 'commande', reference,
  createdAt, lines: [{ productId, product, quantity, unit, unitNoun, unitPrice }], transportCost,
  payment, note, address, country, customer: { accountId, name, email, phone } }`.
- La réception n'est pas authentifiée (l'application n'a aucun moyen de l'être) : totaux
  recalculés par le serveur, doublons ignorés, vingt envois par minute au plus. À renforcer.
- Données personnelles : chaque commande est chiffrée avant d'être enregistrée ; sans connexion,
  seules les commandes d'exemple (fictives) sont lisibles.
- Paiement : aucun prestataire n'est relié. Le paiement reçu est pointé à la main par l'équipe,
  avec son moyen (Orange Money, Wave, virement bancaire, carte bancaire). Il n'y a pas de
  crédit : pointer le paiement confirme la commande, et aucune étape n'avance sans paiement.
  L'application propose aujourd'hui « carte » et « mobile money » (`PAYMENTS`, `lib/data.ts`) :
  cette liste est à mettre à jour côté application.
- Livraison (page « Livraison ») : au Sénégal, l'équipe attribue chaque commande à l'un de ses
  livreurs — rien n'est attribué automatiquement. À l'international, transit jusqu'à l'aéroport
  d'arrivée par le GP ; le client se charge de la suite. Le numéro du GP et ceux des livreurs
  sont chiffrés et ne sortent que pour les comptes autorisés.
- Message au GP : lien WhatsApp (`wa.me`) avec le message pré-rempli, ouvert depuis la fiche de
  la commande ; l'envoi reste un geste humain. Un envoi automatique demanderait l'API WhatsApp
  Business (service tiers, non relié).

## Configuration

Variables d'environnement (aucune valeur ne figure dans le dépôt) :

| Variable | Usage |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Connexion depuis le navigateur |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Routes `/api`, côté serveur uniquement |
| `SEAL_SECRET`, `VAULT_SECRET` | Secrets propres (32 caractères au moins, deux valeurs différentes) pour les empreintes d'intégrité et le chiffrement des commandes, séparés de la clé de service. Tant qu'ils ne sont pas définis, l'ancienne dérivation depuis la clé de service reste utilisée. Une fois définis, l'existant reste lisible. **À conserver ailleurs : les perdre rend les commandes écrites ensuite illisibles.** |
| `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_AUTH_PROXY` | Connexion Google (facultatif) |

```bash
npm install
npm run build      # contrôle des types + construction
```

Les routes `/api` sont des fonctions Vercel : en local, utiliser `vercel dev`.

## Sécurité

- Connexion par Supabase Auth. Le rôle (`owner`, `editor`, `pending`) est rangé dans les
  métadonnées du compte (`app_metadata.tropicaura_role`), que seul le serveur peut écrire.
- Mode visite : sans compte, on entre directement et tout se lit (produits, rayons, réglages,
  journal sans les adresses) ; aucune écriture n'est possible.
- Chaque écriture sur `/api` relit le compte et vérifie le rôle. Suppression définitive, règles, équipe
  et validation en masse : responsables uniquement.
- Première mise en service : tant qu'aucun responsable n'existe, le premier compte connecté peut
  le devenir. Cette possibilité se referme ensuite.
- Stockage des images : lecture publique, écriture par le serveur seulement.

### À faire avant une mise en production : activer la sécurité par ligne

Constat vérifié : dans l'environnement de construction, les tables restent lisibles et
modifiables avec la clé publique (la sécurité par ligne n'a pas pu y être activée). Parade en
place : chaque ligne écrite par l'administration porte une empreinte HMAC (table `seals`) ; une
ligne sans empreinte valide est signalée et n'est jamais publiée. Cela empêche de publier un
prix forgé, mais pas de lire les tables, de supprimer une ligne ou de rejouer une ancienne
version validée. Exécuter `supabase/schema.sql` (section « Sécurité par ligne ») dans l'éditeur
SQL de Supabase ferme ces accès ; les routes `/api` continuent de fonctionner sans changement.

Changer la clé de service invalide les empreintes : un responsable revalide alors les lignes
dans Réglages.

## Données

Schéma : `supabase/schema.sql`. Les 38 produits d'origine sont les données d'exemple de
`lib/data.ts` (marquées « Exemple »). Mangue séchée, ananas séché et baobab en poudre sont créés
masqués, sans prix, origine, saison ni photo : à compléter.
