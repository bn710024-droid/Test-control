# DÉCISIONS — nuit du 27/11/2026

Les décisions de la nuit (application et tour) sont tenues en un seul endroit : `DECISIONS.md` du
dépôt de l'application (bn710024-droid/Test-app-tropicaura, branche `nuit-branchement`).

Propres à la tour :
- `?v=2` publie `schema: 2` au format de l'application ; `/api/catalog` sans `v` reste inchangé.
- `npm run local` : base simulée JSON pour développer sans Supabase — jamais en production.
- Pays GP recopiés dans un réglage public scellé (`settings.gp`) : les réglages GP sont chiffrés.
- Montants affichés dans la devise de la commande ; statistiques en € sur les seules commandes en €.
- `OPEN_ACCESS` laissé à `true` (consigne).
