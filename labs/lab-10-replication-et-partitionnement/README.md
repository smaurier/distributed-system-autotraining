# Lab 10 — Réplication & partitionnement

> **Outcome :** à la fin, tu sais concevoir la stratégie de distribution des données de TribuZen — choisir un modèle de réplication et un mode sync/async par donnée, **calculer** des quorums (`W + R > N`, `W > N/2`), et **dessiner** un consistent hash ring avec l'impact d'un ajout de noeud.
> **Vrai outil :** papier + schéma (conception d'architecture data). Aucun code à faire tourner : c'est un lab de **design**, l'équivalent de ce qu'on te demande au tableau en entretien senior.
> **Feedback :** le coach valide ta copie en session — pas de test-runner auto-correcteur. Tu produis des schémas et des calculs, pas un binaire.

---

## Énoncé

TribuZen grossit. Sa base PostgreSQL unique sature en lecture le soir, et la table `activity_log` (journal d'activité des familles) ne tient bientôt plus sur un disque. On te confie la **conception de la couche data distribuée**. Tu vas produire **trois livrables** de conception, à la main.

Le contexte data de TribuZen :

| Donnée | Volume | Profil d'accès | Cohérence attendue |
|---|---|---|---|
| `familles` (profil : nom, avatar, membres) | modéré | **lecture ≫ écriture** (chaque ouverture d'app relit) | l'auteur doit revoir sa propre modif (read-your-writes) |
| `activity_log` (« X a validé la routine », millions de lignes/mois) | **énorme, croît sans fin** | écriture continue, lecture « historique de MA famille » | molle : un léger retard d'affichage est acceptable |
| `vues_sortie` (compteur de vues par sortie) | fort débit | **écriture ≫ lecture**, incréments | très molle : perdre une vue est sans conséquence |

**Pas de gap-fill, pas de code à exécuter.** Tu écris les décisions, les calculs et les schémas. Les trois livrables ci-dessous sont l'exercice.

### Livrable 1 — Réplication de `familles`

1. Choisis un **modèle** (single-leader / multi-leader / leaderless) et **justifie** en une phrase.
2. Choisis **synchrone / asynchrone / semi-synchrone** et dis **ce que tu perds** au failover avec ton choix.
3. Explique en 2 lignes **comment tu gères le read-your-writes** (le parent modifie son nom de famille et doit le revoir au rechargement).

### Livrable 2 — Calcul de quorums (le coeur du lab)

TribuZen teste un store **leaderless à N = 3** pour deux données. Pour **chacune**, pose les nombres et **vérifie les inégalités** :

1. **Profil `familles`** (lecture fréquente, cohérence voulue) : propose `W` et `R`, écris le calcul `W + R > N`, dis si c'est cohérent et pourquoi ce réglage convient au read-heavy.
2. **`vues_sortie`** (débit d'écriture, cohérence molle) : propose `W` et `R`, écris le calcul, dis quelle cohérence tu obtiens et pourquoi c'est acceptable ici.
3. **Question de contrôle** : avec `N = 5`, quel est le plus petit `W = R` qui reste **cohérent** ? Montre le calcul et vérifie aussi `W > N/2`.

### Livrable 3 — Consistent hash ring de `activity_log`

1. **Dessine** un anneau avec **3 noeuds** (A, B, C) et place **4 clés** `familyId` (invente les positions horaires). Indique pour chaque clé **quel noeud** la stocke (premier noeud dans le sens horaire).
2. **Ajoute un noeud D** entre C et A sur l'anneau. Indique **quelles clés bougent** et **lesquelles ne bougent pas**. Estime la **fraction** de clés déplacée et compare à ce qu'aurait fait un `hash(familyId) % M` naïf.
3. Explique en 2 lignes **à quoi servent les noeuds virtuels** ici, et **pourquoi le hash seul ne protège pas** d'une famille virale (hotspot).

---

## Étapes (en friction)

1. **Livrable 1** — pose d'abord le modèle de réplication AVANT le mode sync/async. Écris la phrase « je perds ___ au failover » — si tu ne sais pas quoi écrire, relis §2.4.
2. **Livrable 2** — pour chaque donnée, écris littéralement `W + R = ? > N ?` et conclus « cohérent / éventuel ». Ne devine pas : l'inégalité est **stricte** (`>`, pas `≥`).
3. **Livrable 2.3** — teste plusieurs `W=R` pour `N=5` (2 ? 3 ?) et garde le plus petit qui passe `W+R>5` ET `W>2.5`.
4. **Livrable 3** — dessine vraiment le cercle (à la main). Place les noeuds, puis les clés, puis trace les flèches horaires. Le schéma **est** la réponse.
5. **Livrable 3.2** — surligne l'arc qui change de propriétaire quand D arrive. Tout ce qui n'est pas dans cet arc **ne bouge pas** — c'est le point du lab.

---

## Grille d'évaluation (le coach coche)

| Critère | Attendu | ✅ |
|---|---|---|
| L1 — modèle réplication | single-leader choisi et justifié (pas de conflit, read scaling) | |
| L1 — sync/async | async ou semi-sync + **perte au failover nommée** | |
| L1 — read-your-writes | route la lecture de l'auteur vers le leader après son écriture | |
| L2.1 — quorum profil | `W+R>3` posé et **vérifié** (ex. W=3,R=1 → 4>3 ✅), lien read-heavy | |
| L2.2 — quorum vues | calcul posé, **cohérence éventuelle assumée** (ex. W=1,R=1 → 2 ≯ 3) | |
| L2.3 — contrôle N=5 | `W=R=3` (3+3=6>5 ✅ et 3>2.5 ✅), plus petit valide | |
| L3.1 — ring dessiné | 3 noeuds + 4 clés placés, assignation horaire correcte | |
| L3.2 — ajout de D | seul l'arc [C→D] migre nommé, ~1/4 estimé, comparé à `% M` (quasi tout) | |
| L3.3 — vnodes + hotspot | vnodes = distribution/pondération ; hotspot = hot key non résolue par le hash | |

**Seuil coach :** 7/9 pour valider. En dessous, on refait le(s) livrable(s) manqué(s) au tableau.

---

## Coach — comment mener la session

- **Ne donne pas les nombres.** Demande « pose l'inégalité au tableau » et laisse Sylvain écrire `W + R > N`. La friction du calcul à la main **est** l'apprentissage (generation effect).
- **Piège à tendre sur L2** : proposer `W=1, R=1` pour le profil « parce que c'est rapide » — laisse-le poser `1+1=2 ≯ 3` et **découvrir** que c'est éventuel, donc read-your-writes cassé. Ne le corrige pas avant qu'il ait fait le calcul.
- **Sur L3**, si le ring est bancal, demande « et si tu ajoutes D, combien de clés bougent avec `hash % M` ? » — la comparaison rend le gain du consistent hashing évident.
- **Relance si silence** : « quelle donnée exige la cohérence forte, laquelle s'en passe ? » — le but est qu'il **relie** chaque choix W/R au profil d'accès, pas qu'il récite.
- **Question de sortie** (vérifie la compréhension profonde) : « pourquoi `W + R > N` garantit-il une lecture à jour ? » Réponse attendue : **chevauchement** — les jeux de lecture et d'écriture partagent forcément au moins une réplique, qui a la version fraîche.

---

## Variante J+30 (fading)

**Même exercice, contraintes ajoutées, sans rouvrir le module ni ce corrigé :**

1. **En 20 minutes**, refais les **trois livrables de mémoire** pour un **nouveau** cas : le store passe à **N = 5** répliques, et on ajoute une 4ᵉ donnée `messages` (chat familial : écriture fréquente, l'expéditeur doit revoir son message immédiatement, mais un léger retard chez les autres est OK).
2. Pour `messages`, propose `W`/`R` sur `N=5` qui donnent **read-your-writes pour l'expéditeur** tout en restant dispo — pose et vérifie les deux inégalités.
3. Sur le ring, pars de **4 noeuds** et **retire** un noeud (au lieu d'en ajouter) : dis où vont ses clés et pourquoi les vnodes évitent que **tout** son arc n'atterrisse sur un seul voisin.

**Critère de réussite :** les inégalités sont posées et justes sans aide, et l'impact du retrait de noeud est correctement borné à une fraction des clés.

---

## Application TribuZen

Dans le repo `smaurier/tribuzen`, cette conception se matérialise en **décisions d'infra** (pas un fichier de code unique) :

- **Réplication `familles`** : configuration Postgres **1 primary + 2 replicas asynchrones** (fichier `infra/db/replication.md` ou équivalent Terraform/compose), et dans le code, un **routing de lecture** qui envoie la lecture de l'auteur vers le primary juste après son écriture.
- **Sharding `activity_log`** : documenter la **clé de partition `familyId`** et la stratégie **consistent hashing** dans un ADR (`docs/adr/00NN-sharding-activity-log.md`).
- **Quorums** : si un jour TribuZen adopte un store leaderless (Cassandra/Scylla) pour un sous-domaine, les valeurs `N/W/R` par table vivent dans la config de ce store.

**Commit cible (ADR de conception, pas de code applicatif) :**
```
docs(infra): ADR réplication familles (single-leader async) + sharding activity_log (consistent hashing par familyId)
```

> Rappel de portée : ce lab s'arrête à la **conception**. L'**élection** du nouveau primary au failover (consensus) = **module 18** ; écrire de façon **transactionnelle à travers plusieurs shards** = **module 11 (next)** ; **résoudre** les conflits sans perte = **module 21 (CRDTs)**.
