# ERREURS — ce qui reste à corriger (tour de contrôle)

## État au 27/11/2026, soir (branche `nuit-branchement`, en ligne)

- **En ligne** : app https://tropicaura-app.vercel.app · tour https://tropicaura-tour.vercel.app ·
  vraie base Supabase. Les deux PR `nuit-branchement → main` restent ouvertes, non fusionnées.
- **Tests en ligne** (`app/scripts/online/`) : t1 tour → app 81/81 · t2 app → tour + statuts 42/42 ·
  t4 images 20/20 (0 image en 404, 0 image vide) · t5 forfait transport 8/8 · t3 boutons : 954 clics,
  0 erreur. Hors ligne : `test_app.py` 63/63, `tsc` 0 erreur, `npm run build` OK, tests unitaires
  des deux côtés au vert.
- **Corrigé aujourd'hui** : images de la tour revenues ; annonces « toucher » et « image seule » ;
  libellés des étapes pro ; moyens de paiement réglables ; publications photo dans l'app ; cause du
  raté de statut (la position du client écrasait le statut) ; photos des emballages ; forfaits de
  transport réglables dans la tour ; identifiant de compte aléatoire ; photos remplacées
  supprimées du stockage (plus de fichiers laissés).
- **À faire par l'équipe** : saisir les vrais forfaits de transport (Réglages › Transport) ; ajouter
  les contenus manquants des emballages (tour n° 3).
- **Encore ouvert** (décisions de design ou de produit) : app n° 4, 8, 9 ; tour n° 2, 4.

Format : écran · étapes pour reproduire · cause probable · correctif proposé. Ce qui a été corrigé
cette nuit est dans `BUGS.md`.

Relevé automatique (13 pages + 17 gestes à 1440×900, base locale) : **0 erreur console,
0 erreur de page, 0 requête en échec**. `npm run build` : OK. `npm run lint` : 0 erreur,
30 avertissements (n° 5).

---

### 1. ~~Annonce « image seule » sans produit non affichée par l'application~~ — corrigé
- **Corrigé** (27/11, `672805f` + app `473551c`) : `?v=2` publie l'annonce `link: 'none'` avec
  `id: null` ; l'application l'affiche en image seule, sans effet au toucher. Test en ligne t1.

### 2. Pas de visibilité « ce pays uniquement » pour un emballage
- **Écran** : Produit › Emballages › réglages par pays.
- **Cause** : seuls des réglages par pays existent ; pas de mode « pays uniquement ».
- **Correctif** : ajouter le mode à l'emballage, publié en `visibility` (l'application le lit déjà).

### 3. Emballage sans contenu refusé à l'enregistrement
- **Reproduire** : catalogue d'exemple, « Mangue séchée » › Carton (contenu vide) → enregistrer
  la fiche : erreur « Indiquez ce que contient cet emballage ».
- **Cause** : règle volontaire de la tour (un prix d'emballage sans contenu ne veut rien dire).
- **Correctif** : à compléter par l'équipe (donnée).

### 4. Avertissement du routeur sur la fiche produit
- **Message** : « You are trying to use a blocker on a POP navigation… ».
- **Reproduire** : ouvrir une fiche produit puis changer l'adresse `#/…` à la main.
- **Cause** : `useBlocker` avec `createHashRouter` sur une navigation « retour ».
- **Correctif** : sans gravité ; tester `useBlocker` seulement sur les navigations internes.

### 5. 30 avertissements ESLint
- `react-hooks/set-state-in-effect` (chargements dans `useEffect`), `react-refresh` (exports
  mixtes), `react-hooks/purity` (`Date.now()` dans un `useMemo`). Aucun bug constaté à l'écran ;
  passés en avertissement plutôt que réécrire les effets cette nuit.

### 6. Sécurité (volontairement inchangé — phase de test)
- `OPEN_ACCESS = true`, CORS `*`, réception des commandes non authentifiée. RLS active sur la vraie
  base (accès réservé au rôle serveur) ; à durcir avant l'ouverture au public.

### 7. ~~Moyens de paiement non réglables dans la tour~~ — corrigé
- **Corrigé** (27/11, `672805f`) : Réglages › « Moyens de paiement », un interrupteur par moyen
  (mêmes `Block` et `Switch` que les autres réglages), au moins un reste activé ; publié dans
  `payments`. Test en ligne t2 : virement désactivé → absent de l'application.

### 8. ~~Photos remplacées ou retirées : le fichier reste dans le stockage~~ — corrigé
- **Corrigé** (27/11, soir) : photo de produit, illustration de rayon ou image de filtre remplacée,
  retirée ou supprimée avec sa ligne → fichier supprimé de l'espace `catalogue`, seulement si aucune
  ligne (produits, rayons, réglages, emballages) ne le cite encore (`api/_files.js`,
  `shared/files.js`, test `test-files.mjs`). En ligne : t1 vérifie « 0 fichier laissé ».

### 9. ~~Vidéo publiée servie avec retard (cache 15 s + 60 s)~~ — corrigé
- Cache de `?public=videos` et `?public=photos` ramené à 5 s + 5 s, comme le catalogue.

### 10. ~~Images disparues de la tour en ligne (produits, rayons, filtres)~~ — corrigé
- **Cause** : sur la nouvelle base, `compat.embeddedAssets` (liste des photos embarquées) était vide :
  la tour affichait « Sans photo » partout.
- **Corrigé** (27/11, `31c9685`) : liste des photos de la tour dans `shared/assets.js` ; 4 photos
  ajoutées (mangue séchée, ananas séché, baobab, bissap, reprises de l'application en webp).
  Test en ligne t4 : 0 image en 404, 0 image vide.

### 11. ~~Statut d'une commande perdu (raté isolé, 1 sur 14)~~ — cause trouvée, corrigé
- **Cause** : `trackPosition` (position envoyée par l'application) relisait toutes les commandes puis
  réécrivait la commande chiffrée entière : un statut changé par l'équipe entre-temps était effacé.
- **Corrigé** (27/11, `a7d4899`) : écritures conditionnelles sur l'empreinte du bloc chiffré
  (`shared/stamp.js`). Un conflit avec un autre membre de l'équipe répond 409 « rechargez ».

### 12. Forfaits de transport (nouveau réglage)
- Réglages › « Transport des particuliers » : un forfait en euros par zone, publié dans `?v=2`
  (`transport`) une fois enregistré ; `value: null` le retire. **À saisir par l'équipe** : le bloc
  affiche le barème d'exemple de l'application tant qu'il n'est pas enregistré.
