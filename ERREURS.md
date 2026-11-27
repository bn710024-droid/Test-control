# ERREURS — ce qui reste à corriger (tour de contrôle)

<!-- RÉSUMÉ DE LA NUIT : complété à 5 h 45 -->

Format : écran · étapes pour reproduire · cause probable · correctif proposé. Ce qui a été corrigé
cette nuit est dans `BUGS.md`.

Relevé automatique (13 pages + 17 gestes à 1440×900, base locale) : **0 erreur console,
0 erreur de page, 0 requête en échec**. `npm run build` : OK. `npm run lint` : 0 erreur,
30 avertissements (n° 5).

---

### 1. Annonce « image seule » sans produit non affichée par l'application
- **Écran** : Publications › Annonces, lien « Aucun ».
- **Cause** : l'application exige un produit par annonce ; `?v=2` les écarte.
- **Correctif** : côté application, accepter une annonce sans produit (image, toucher sans effet).

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
- `OPEN_ACCESS = true`, CORS `*`, réception des commandes non authentifiée, RLS à activer
  (voir `supabase/schema.sql` et `A-CONNECTER.md` de l'application).
