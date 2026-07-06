# Lab 09 — Cohérence & théorème CAP

> **Outcome :** à la fin, tu sais **classer chaque donnée d'un système réel (TribuZen) par le modèle de cohérence qu'elle exige** et **justifier CP vs AP (+ profil PACELC)** au regard du **coût métier d'une lecture obsolète** — puis défendre chaque choix face à une objection.
> **Vrai outil :** ta tête + une feuille (ou un `.md`). C'est un lab d'**architecture / décision**, pas de code. La compétence visée est le **jugement** — celui qu'on te demandera en revue d'archi ou en entretien senior.
> **Feedback :** le coach valide ton raisonnement en session (pas de test-runner auto-correcteur). Ce qui compte n'est pas « la bonne case » mais **la justification par le coût métier**.

---

## Énoncé

TribuZen tourne en **plusieurs répliques** (deux datacenters). Les partitions réseau **arriveront** : ton job est de décider, **donnée par donnée**, ce que le système doit faire quand elles frappent.

Voici **8 données** manipulées par TribuZen. Pour **chacune**, tu dois produire une **fiche de décision** :

| Donnée | Description |
|---|---|
| **D1 — Solde de la cagnotte partagée** | Montant collecté pour une sortie ; chaque parent y verse sa part. Sert à décider si la sortie est financée. |
| **D2 — Fil d'activité de la famille** | Flux « Papa a rejoint la sortie », « Maman a ajouté une photo ». Affiché sur l'accueil. |
| **D3 — Places restantes pour une sortie à capacité limitée** | Ex. 12 places max au parc ; on ne veut **pas** de survente. |
| **D4 — Fil de commentaires d'une sortie** | Messages postés par les membres ; questions/réponses s'enchaînent. |
| **D5 — Mes préférences de profil (langue, notifications)** | Réglages que **je** modifie pour **moi-même**. |
| **D6 — Compteur « X participants »** affiché sous une sortie | Nombre indicatif, décoratif. |
| **D7 — Statut de paiement d'une part (payé / en attente)** | Confirme qu'un parent a bien réglé sa contribution. |
| **D8 — Photo de couverture d'une sortie** | Image choisie par l'organisateur, modifiable. |

**Pour chaque donnée, ta fiche contient (obligatoire) :**

1. **Coût métier d'une lecture obsolète** : que se passe-t-il, concrètement, si un utilisateur lit une valeur en retard ? (une phrase, chiffrée si possible : perte d'argent ? relance inutile ? rien ?)
2. **Modèle de cohérence choisi** parmi : *forte/linéarisable · séquentielle · causale · read-your-writes (session) · éventuelle*.
3. **Profil : CP ou AP**, et **comportement en partition** attendu (« refuse et affiche réessayer » vs « répond avec la valeur locale »).
4. **Profil PACELC** (**PA/EL · PC/EC · PA/EC · PC/EL**) + une phrase sur le **régime normal** (latence vs cohérence).
5. **Une objection anticipée** : quelqu'un propose le modèle **voisin** (plus fort ou plus faible) ; en une phrase, pourquoi tu **refuses**.

**Pas de gap-fill.** Tu rédiges les 8 fiches toi-même. Le module 09 est autorisé en **support**, mais l'objectif est que tu **tranches** avant de vérifier.

### Starter minimal (format d'une fiche)

```md
### D1 — Solde de la cagnotte partagée
- Coût de l'obsolescence : ...
- Modèle : ...
- Profil CAP + comportement en partition : ...
- Profil PACELC + régime normal : ...
- Objection refusée : « et si on prenait <modèle voisin> ? » → parce que ...
```

---

## Étapes (en friction)

1. **Trie d'abord par coût, pas par techno.** Pour les 8 données, écris **uniquement** la phrase « coût d'une lecture obsolète ». Range-les mentalement de « catastrophe » à « aucun impact ». Ne parle pas encore de CAP.
2. **Place le curseur fort/faible.** Coût élevé (argent, survente) → tire vers **forte** ; coût nul (décoratif) → tire vers **éventuelle** ; coût « visible par l'utilisateur sur ses propres actions » → pense **session** ; coût « un ordre à respecter » → pense **causale**.
3. **Dérive le profil CAP.** Rappelle-toi la ligne de partage : **séquentielle et au-dessus ⟹ CP** (indispo en partition) ; **causale et en-dessous ⟹ AP possible**. Écris le comportement concret en partition.
4. **Ajoute PACELC.** Pour chaque AP, décide le régime normal : lit-on **vite depuis le local** (EL) ou **juste après coordination** (EC) ? Pour chaque CP, c'est **EC**.
5. **Écris l'objection.** Pour chaque donnée, formule l'alternative **voisine** et **réfute-la en une phrase** (soit « trop cher pour ce que ça rapporte », soit « pas assez de garantie pour ce coût métier »).
6. **Cherche les pièges tendus.** Deux de ces données ressemblent à un cas mais en sont un autre — voir la grille. Relis D3 vs D6 et D5 vs D2 **avant** de valider.
7. **Passe la grille d'auto-évaluation** ci-dessous, puis confronte au corrigé.

---

## Grille d'auto-évaluation

Coche honnêtement. Objectif : **7/8 fiches** correctement justifiées (pas juste « la bonne case »).

- [ ] Chaque fiche part du **coût métier**, pas de la techno (« c'est de l'argent donc fort », pas « je mets fort partout »).
- [ ] J'ai bien mis **D1 et D7 en CP** (argent / paiement : refuser > mentir) et **D3 en forte** (survente = coût réel).
- [ ] J'ai bien mis **D2, D6, D8 en éventuelle / AP** (coût d'obsolescence ≈ nul).
- [ ] J'ai distingué **D4 (causale — ordre question/réponse)** d'une simple éventuelle.
- [ ] J'ai mis **D5 en read-your-writes** (mes propres réglages), pas en « forte » (piège du sur-dimensionnement).
- [ ] Aucune fiche ne dit « CA » ni « 2 sur 3 ».
- [ ] Chaque profil PACELC a **les deux lettres** (partition **et** régime normal).
- [ ] Chaque objection est réfutée par un **argument de coût** (trop cher / pas assez garanti), pas « parce que c'est mieux ».
- [ ] Je **n'ai pas** décrit **comment** on l'implémente (quorums, Raft, CRDT) — ça, c'est module 10/18/21, hors sujet ici.

---

## Corrigé (barème indicatif — la justification prime sur la case)

> Il peut exister des variantes défendables (surtout D8, D6). Ce qui est **noté**, c'est la **cohérence entre le coût métier annoncé et le modèle choisi**.

| Donnée | Coût obsolescence | Modèle | CAP | PACELC | Piège / clé |
|---|---|---|---|---|---|
| **D1** Solde cagnotte | **Élevé** — décision d'argent faussée | **Forte / linéarisable** | **CP** — refuse, « réessaie » | **PC/EC** | l'îlot CP assumé : mentir sur l'argent > indispo rare |
| **D2** Fil d'activité | **Nul** — 3 s de retard invisible | **Éventuelle** | **AP** — répond local | **PA/EL** | ne pas sur-dimensionner |
| **D3** Places restantes | **Élevé** — **survente** d'une sortie pleine | **Forte** | **CP** — refuse si incertain | **PC/EC** | ressemble à un compteur (D6) mais coût réel → **fort** |
| **D4** Fil de commentaires | **Moyen** — réponse avant question = confus | **Causale** | **AP** (causal = *sticky available*) | **PA/EL** | pas éventuelle simple : l'**ordre causal** compte |
| **D5** Mes préférences | **Faible mais visible sur MES actions** | **Read-your-writes** (session) | **AP** + garantie session | **PA/EL** | ni forte (trop cher) ni éventuelle nue (je dois revoir mon réglage) |
| **D6** Compteur participants | **Nul** — indicatif/décoratif | **Éventuelle** | **AP** | **PA/EL** | piège inverse de D3 : ici approximatif OK |
| **D7** Statut de paiement | **Élevé** — argent / preuve | **Forte** | **CP** | **PC/EC** | comme D1 : justesse > disponibilité |
| **D8** Photo de couverture | **Quasi nul** — voir l'ancienne 10 s = rien | **Éventuelle** (read-your-writes pour l'organisateur) | **AP** | **PA/EL** | acceptable de renforcer côté auteur (il doit revoir SON upload) |

**Pourquoi ce corrigé est correct :**

- **D1, D3, D7 sont les seuls CP.** Point commun : une lecture obsolète a un **coût métier chiffrable** (argent perdu, survente, litige de paiement). On accepte une **indisponibilité rare** en partition pour ne **jamais** servir une valeur fausse. Les trois sont **PC/EC** : on paie la coordination **même en régime normal**, car la justesse prime tout le temps.
- **D2, D6, D8 sont éventuelles / AP / PA/EL.** Le coût d'obsolescence est **nul** : on optimise la **disponibilité** (partition) et la **latence** (régime normal). Exiger la cohérence forte ici serait payer latence + indisponibilité pour **rien** (piège #3 du module).
- **D4 est causale, pas « juste éventuelle ».** Le coût n'est pas dans la fraîcheur mais dans l'**ordre** : une réponse ne doit jamais apparaître avant sa question (happens-before). La causale garantit cet ordre **tout en restant disponible** en partition — mais en régime *sticky available* (le client colle à une réplique), à la différence de l'éventuelle qui est *totalement* disponible. C'est le plus fort modèle qui reste disponible sans imposer le CP.
- **D5 est read-your-writes, pas forte.** L'utilisateur doit revoir **ses propres** réglages immédiatement, mais on **n'a pas besoin** que tous les autres nœuds soient synchronisés à l'instant. Une **garantie de session** (bon marché) suffit ; passer en cohérence forte serait sur-dimensionner (piège #5).
- **Les pièges tendus :** D3 **ressemble** à un compteur (D6) mais son obsolescence provoque une **survente** → coût réel → **fort/CP**, alors que D6 est décoratif → **éventuelle**. Et D5 **ressemble** à du fil d'activité (D2) mais porte sur **mes propres** actions → **session** requise.

---

## Variante J+30 (fading)

**Même exercice, contraintes ajoutées :**

1. **De mémoire, en 20 minutes**, sans rouvrir le module 09 ni ce corrigé.
2. **Nouveau jeu de 5 données** (invente-les depuis un autre produit que tu connais — un e-commerce, un chat, un jeu) : un **panier**, un **stock produit**, un **fil de notifications**, un **compteur de vues**, un **statut « commande livrée »**. Classe-les avec le **même format de fiche**.
3. **Contrainte piège :** pour **une** des 5 données, propose **deux** modèles défendables selon une hypothèse métier que tu explicites (ex. « si le stock est vendu à l'unité rare → forte ; si surstock abondant → éventuelle avec réconciliation »). Montre que **le contexte métier déplace le curseur**.

**Critère de réussite :** les 5 fiches tiennent debout, aucune ne dit « CA » ni « 2 sur 3 », et la donnée à double lecture est **argumentée par le métier**, pas par la technique.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cette décision se matérialise en **documentation d'architecture** (ADR — *Architecture Decision Record*), pas en code applicatif immédiat :

```
tribuzen/
  docs/
    adr/
      0009-carte-de-coherence-des-donnees.md   ← la carte des 8 données, profil CP/AP + PACELC
```

**Ce que tu portes dans le vrai produit :**

- La **carte de cohérence** (tableau donnée → modèle → CP/AP → PACELC → justification) devient l'ADR de référence : toute nouvelle donnée devra y être classée **avant** d'être stockée.
- Chaque ligne **CP** (cagnotte, places, paiement) est marquée comme **candidate à un mécanisme de cohérence forte** — dont l'implémentation (quorums, consensus) est traitée aux **modules 10 et 18**. Le lab s'arrête à la **décision**.
- Chaque ligne **AP** documente la **stratégie de convergence** attendue (éventuelle simple, ou avec garantie de session) — l'implémentation (read-repair, CRDT) relève des **modules 10 et 21**.

**Commit cible :**
```
docs(adr): carte de cohérence TribuZen — CP/AP + PACELC par donnée, justifié par coût métier
```
