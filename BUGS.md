# BUGS — Tour de contrôle (nuit du 27/11/2026)

Constats faits en branchant l'application sur la tour. « Corrigé » = corrigé cette nuit et vérifié.

| # | Gravité | Constat | État |
|---|---|---|---|
| 1 | Bloquant (dev) | Sans variables Supabase, la tour ne s'ouvre pas (« Configuration manquante ») et `/api` ne répond pas : impossible de développer ou tester sur un poste sans accès à la base. | **Contourné** : `npm run local` (scripts/local) — API telle quelle + base locale JSON, front Vite sur le même port. Jamais utilisé en production. |
| 2 | Élevée | `GET /api/catalog` (schema 1) publie le format de la tour (`packagings`, `countries`, `banners`), que l'application ne lit pas : branchée dessus, elle perdait emballages et visibilité. | **Corrigé** : `GET /api/catalog?v=2` publie le format de l'application (shared/catalog-v2.js, test `node scripts/test-catalog-v2.mjs`). |
| 3 | Moyenne | Livraison GP : la tour n'a qu'un réglage global (`gpDelivery` : aéroport / domicile), sans liste de pays. L'application attend `delivery.gp: [{ country, options }]`. | **Corrigé** : « Pays desservis par le GP » dans Commandes › Livraison, publiés dans `delivery.gp` (testé bout en bout, France). |
| 4 | Moyenne | Les montants des commandes s'affichent toujours en € dans la tour, même pour une commande en F CFA. | **Corrigé** : devise enregistrée et fiche commande affichée dans sa devise (F CFA vérifié). Statistiques : montants en € sur les seules commandes en €, avec la mention « N commande(s) dans une autre devise, non comptée(s) » (vérifié). |
| 5 | Moyenne | Emballage : pas de visibilité « ce pays uniquement » au niveau de l'emballage (seulement des réglages par pays). L'exemple de l'application « carton réservé au Sénégal » n'est pas exprimable. | Non fait (évolution de l'écran Produit). |
| 6 | Faible | Annonce « image seule » sans produit (`link: none`) : l'application actuelle ne sait pas l'afficher (une annonce doit pointer un produit). | Écartée de `?v=2` (documenté). |
| 7 | Faible | Emballage sans contenu (`qty` vide) : refusé à l'enregistrement par la tour, alors que le catalogue d'exemple de l'application en a un (carton de mangue séchée). | Signalé : à compléter par l'équipe. |
| 8 | Sécurité | `OPEN_ACCESS = true`, CORS `*`, réception des commandes non authentifiée, identifiant de compte prévisible. | Volontairement inchangé (phase de test). À traiter avant de vrais clients. |
| 9 | Faible | `vite.config.ts` importe `.vite-source-tags.js` (outil de génération) ; paquet nommé `vite-react-ts-fullstack`. | **Corrigé** : import retiré, paquet renommé `tropicaura-tour`. |
| 10 | Moyenne | Textes faux après branchement : « appliquez le correctif » (Introuvables, Publications, Réglages), « l'application n'envoie pas encore ses commandes », « rayons écrits dans le code », « schema 1 », « Favoris › Publications ». | **Corrigé**. |
| 11 | Faible | Lint : 89 erreurs (typographie, imports inutilisés, `@ts-ignore`). | **Corrigé** : 0 erreur, 30 avertissements (ERREURS.md n° 6). |
| 12 | Faible | `schema.sql` sans `product_requests` ni `publication_reactions`, utilisées par l'API. | **Corrigé** (documentées). |
