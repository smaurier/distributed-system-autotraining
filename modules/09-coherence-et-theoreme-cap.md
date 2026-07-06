---
titre: Cohérence & théorème CAP
cours: 17-distributed-systems
notions: ["cohérence (consistency model)", "réplique / replica", "donnée fraîche vs obsolète (stale)", "théorème CAP", "consistency (C)", "availability (A)", "partition tolerance (P)", "P est subie, pas choisie", "CP vs AP", "faux « CA »", "PACELC", "else latency vs consistency (EL / EC)", "cohérence forte / linéarisabilité (linearizability)", "cohérence séquentielle", "cohérence causale", "happens-before", "cohérence éventuelle (eventual)", "read-your-writes", "monotonic reads", "sticky availability", "spectre de cohérence", "coût métier d'une lecture obsolète"]
outcomes:
  - "sait énoncer le théorème CAP correctement : P est subie, donc pendant une partition on choisit entre C et A (jamais « 2 sur 3 »)"
  - "sait expliquer pourquoi un système « CA » distribué n'existe pas et classer un système en CP ou AP par son comportement en partition"
  - "sait ajouter PACELC : hors partition (Else), on arbitre encore entre Latence et Cohérence, et sait placer un système dans PA/EL vs PC/EC"
  - "sait ordonner le spectre de cohérence de la linéarisabilité à l'éventuelle et dire ce que chaque modèle garantit"
  - "sait distinguer cohérence forte, séquentielle, causale, éventuelle et les garanties de session (read-your-writes, monotonic reads)"
  - "sait choisir le modèle de cohérence d'une donnée TribuZen selon le coût métier d'une lecture obsolète, et déférer le COMMENT (quorums, réplication) au module 10"
prerequis: ["Module 00 — pourquoi le distribué, fallacies of distributed computing", "Module 01 — réseau, latence, partial failure", "Module 02 — microservices en TypeScript", "Module 03 — sérialisation et contrats d'API", "Module 04 — communication synchrone (deadlines)", "Module 05 — communication asynchrone, garanties de livraison", "Module 06 — event-driven architecture", "Module 07 — API gateway et BFF", "Module 08 — retries, timeouts, idempotency"]
next: 10-replication-et-partitionnement
libs: []
tribuzen: "backend TribuZen — choix de cohérence par donnée : le solde de la cagnotte partagée d'une sortie exige la cohérence forte (CP), le fil d'activité de la famille se contente de la cohérence éventuelle (AP)"
last-reviewed: 2026-07
---

# Cohérence & théorème CAP

> **Outcomes — tu sauras FAIRE :** énoncer CAP correctement (P subie → choix C ou A en partition), classer un système en CP ou AP, ajouter PACELC (Latence vs Cohérence hors partition), ordonner le spectre de cohérence de la linéarisabilité à l'éventuelle, et choisir le modèle d'une donnée TribuZen selon le coût métier d'une lecture obsolète.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module est le niveau **théorie des garanties**. Il répond à *quelle* cohérence une donnée exige et *pourquoi* une partition réseau force un arbitrage — le **théorème CAP**, son extension **PACELC**, et le **spectre** des modèles de cohérence (forte → éventuelle, avec les garanties de session). On **ne** couvre **pas** ici le **COMMENT** on obtient une cohérence donnée : réplication leader/leaderless, sharding, **hashing cohérent**, lectures/écritures par **quorum** (`W + R > N`), read-repair → **module 10 (next)**. Les **transactions distribuées** (2PC, saga) → **module 11**. Le **consensus** (Raft, leader election) qui *implémente* la cohérence forte → **module 18**. Les **horloges logiques** (Lamport, vector clocks) qui *implémentent* le happens-before de la cohérence causale → **module 19**. La **résolution de conflits** (CRDT, LWW) sous cohérence éventuelle → **module 21**. Ici : on **décide** la garantie ; ailleurs on la **construit**.

## 1. Cas concret d'abord

Tu travailles sur le backend TribuZen. Une famille organise une **sortie** au parc aquatique, financée par une **cagnotte partagée** : chaque parent y verse sa part. Le service tourne en **deux répliques** (deux datacenters, pour la disponibilité). Un matin, le lien réseau entre les deux répliques **hoquette** pendant 4 secondes — une **partition** : les deux répliques sont vivantes mais ne se voient plus.

Pendant ces 4 secondes, deux choses se passent en même temps :

- **Maman** ouvre la cagnotte sur la réplique A : solde affiché **120 €**.
- **Papa** vient de verser **40 €** sur la réplique B. La réplique B connaît **160 €**, mais elle **ne peut pas** le propager à A (partition).

Maman, voyant 120 €, décide qu'il **manque 40 €** et relance la famille sur le groupe. Message inutile et faux : l'argent est là, sur B. La réplique A a servi une **lecture obsolète** (*stale*).

```
        RÉPLIQUE A                 ✂ partition ✂                RÉPLIQUE B
        solde = 120 €          (les répliques ne se voient plus)   solde = 160 €
           │                                                          │  (Papa a versé 40 €)
   Maman lit → 120 €  ← OBSOLÈTE                          Papa lit → 160 €  ← à jour
```

La réplique A a **deux options**, et elles s'excluent :

1. **Répondre quand même** avec ce qu'elle sait (120 €) → elle reste **disponible**, mais **ment** (incohérente). C'est un choix **AP**.
2. **Refuser de répondre** (« service momentanément indisponible, réessaie ») tant qu'elle n'a pas confirmation de la dernière écriture → elle reste **cohérente**, mais **indisponible**. C'est un choix **CP**.

Il n'y a **pas de troisième option** : pendant la partition, A ne peut pas être **à la fois** cohérente et disponible. Ce dilemme forcé, c'est le **théorème CAP**. Et la « bonne » réponse **dépend de la donnée** : pour un **solde d'argent**, servir un chiffre faux est grave → on veut **CP** (refuser plutôt que mentir). Pour le **fil d'activité** de la famille (« Papa a rejoint la sortie »), un affichage en retard de 4 s est sans conséquence → on veut **AP** (toujours répondre, converger ensuite). Ce module te donne le vocabulaire exact pour **trancher ça**, donnée par donnée.

---

## 2. Théorie complète, concise

### 2.1 Cohérence = quelles garanties sur ce qu'on lit

Un **modèle de cohérence** (*consistency model*) est un **contrat** entre le système distribué et le client : il déclare *ce que le système a le droit de retourner* quand plusieurs répliques d'une même donnée existent. Jepsen le formule ainsi : *« A consistency model is a safety property which declares what a system can do. »*

L'intuition d'un développeur habitué à une base **mono-nœud** (« je lis ce que je viens d'écrire, tout le monde voit la même chose ») est un modèle **fort** — le plus cher. Dès qu'on **réplique** une donnée sur plusieurs nœuds, maintenir cette illusion coûte de la **latence** (attendre que les répliques se synchronisent) et de la **disponibilité** (refuser si elles ne peuvent pas). Le reste du module est un spectre : **plus la garantie est forte, plus elle coûte cher** en latence et en disponibilité.

### 2.2 Le théorème CAP — énoncé correct

Énoncé par **Eric Brewer** (2000), prouvé formellement par **Gilbert et Lynch** (2002). Les trois propriétés :

- **C — Consistency** (ici = **linéarisabilité**, §2.6) : toute lecture retourne l'écriture **la plus récente** ; toutes les répliques se comportent comme **une seule** copie.
- **A — Availability** : toute requête reçue par un nœud **non défaillant** obtient une **réponse** (pas d'erreur, pas de timeout infini).
- **P — Partition tolerance** : le système continue de fonctionner malgré la **perte arbitraire de messages** entre nœuds (une partition réseau).

L'énoncé populaire « choisis **2 sur 3** » est **faux et trompeur**. La bonne lecture :

> **P n'est pas un choix, c'est une fatalité.** Dans un vrai système distribué, les partitions **arrivent** (câble coupé, switch en panne, DC injoignable, latence indistinguable d'une coupure). Tu ne peux pas « décider » qu'elles n'existent pas. Donc **P est toujours présent**, et le seul vrai choix est : **pendant une partition**, sacrifier **C** ou sacrifier **A**.

C'est pour ça que le §1 n'a que deux issues (répondre faux = A ; refuser = C), jamais trois. Le « CA » de la légende (§2.4) n'existe pas en distribué.

### 2.3 CP vs AP : le seul vrai axe

On classe un système par ce qu'il fait **quand la partition frappe** :

- **CP (Consistency + Partition tolerance)** : face à la partition, le système **sacrifie la disponibilité**. Le nœud qui n'est pas sûr d'avoir la dernière valeur **refuse** de répondre (erreur/timeout) plutôt que de risquer une lecture obsolète. Le solde de cagnotte du §1 veut ça. Familles de systèmes : bases fortement cohérentes fondées sur un consensus (option 1 du §1).
- **AP (Availability + Partition tolerance)** : face à la partition, le système **sacrifie la cohérence**. Chaque nœud **répond avec ce qu'il a**, quitte à servir une valeur obsolète, et les répliques **convergeront** plus tard (cohérence éventuelle, §2.9). Le fil d'activité du §1 veut ça.

```
              PARTITION EN COURS
      ┌───────────────┴───────────────┐
      ▼                               ▼
     CP                              AP
 « je refuse plutôt              « je réponds toujours,
   que mentir »                    même approximatif »
 → indisponible, cohérent        → disponible, obsolète possible
 (solde de cagnotte)             (fil d'activité)
```

Retiens : **CP et AP ne décrivent qu'un comportement en partition.** Hors partition, les deux peuvent être rapides et cohérents. D'où PACELC (§2.5).

### 2.4 Le mythe du « CA »

Beaucoup de schémas placent PostgreSQL mono-nœud dans une case « CA » (cohérent + disponible, sans P). C'est un **abus de langage** : un serveur **unique** n'est **pas** un système distribué — il n'y a pas de partition possible **à l'intérieur** d'un seul nœud, donc la question CAP ne s'y pose pas. Dès que tu **répliques** (et tu le feras, pour la tolérance aux pannes → module 10), **P s'impose**, et « CA » redevient le choix impossible du §2.2. **« CA » = « je fais comme si les partitions n'existaient pas »** — ce qui, le jour de la partition, se traduit par une **perte silencieuse de cohérence** subie au lieu de choisie.

### 2.5 PACELC — l'arbitrage qui reste hors partition

CAP a un angle mort : il ne parle **que** de la partition. Or les partitions sont **rares** ; que fait le système **le reste du temps** ? **PACELC** (Daniel **Abadi**, 2010, formalisé 2012) complète :

> **P**artition → choisir **A** ou **C** (le CAP classique) ; **E**lse (hors partition) → choisir **L**atence ou **C**onsistency.

Autrement dit : **même quand le réseau va bien**, garantir la cohérence forte **coûte de la latence** (il faut faire un aller-retour vers d'autres répliques / un leader pour confirmer). Un système peut donc, en fonctionnement normal, **choisir de répondre vite** (depuis une réplique locale, potentiellement en retard) **ou** de **répondre juste** (après synchronisation, plus lentement).

Quatre profils (Brewer/Abadi, exemples courants) :

| Profil | En partition | Hors partition (Else) | Exemples typiques |
|--------|-------------|-----------------------|-------------------|
| **PA/EL** | reste **dispo** (obsolète possible) | optimise la **latence** | Cassandra, DynamoDB |
| **PC/EC** | reste **cohérent** (refuse) | optimise la **cohérence** | Spanner, CockroachDB |
| **PA/EC** | dispo en partition, cohérent sinon | cohérence | (hybride, ex. MongoDB selon config) |
| **PC/EL** | cohérent en partition, rapide sinon | latence | (rare) |

L'apport de PACELC : deux systèmes tous deux « AP » peuvent différer **hors** partition (l'un privilégie la latence, l'autre la cohérence). La question complète n'est donc pas « CP ou AP ? » mais « **PA ou PC**, **et EL ou EC** ? ».

### 2.6 Cohérence forte / linéarisabilité — le haut du spectre

La **linéarisabilité** (Herlihy & Wing) est le modèle **le plus fort** pour une donnée unique. Chaque opération **paraît prendre effet instantanément** en un point unique entre son invocation et sa réponse ; le système se comporte comme s'il n'existait **qu'une seule copie** de la donnée, mise à jour de façon atomique. Conséquence : dès qu'une écriture est confirmée, **toute** lecture ultérieure (par n'importe quel client) voit **au moins** cette écriture. C'est le « C » de CAP.

```
Linéarisable :
  Client X:  ──write(x=1)──ack──▶
  Client Y:            ──────read(x)──▶  DOIT renvoyer 1
             (le write de X est confirmé AVANT le début du read de Y
              → temps réel respecté, comme une seule copie)
```

C'est l'intuition « normale » d'une base — et **la plus chère** : elle exige une coordination (consensus, module 18) qui, en partition, oblige à **refuser** → un système linéarisable est forcément **CP**.

### 2.7 Cohérence séquentielle — plus faible que linéarisable

La **cohérence séquentielle** garantit que toutes les opérations apparaissent dans **un ordre total unique** que **tous** les processus observent, **et** que cet ordre respecte l'ordre **de chaque processus** pris isolément. Ce qu'elle **lâche** par rapport à la linéarisabilité : le **temps réel**. L'ordre global peut ne pas correspondre à l'horloge murale — une écriture confirmée peut n'être visible qu'un peu plus tard, tant que *tout le monde* voit le *même* ordre. Linéarisable ⟹ séquentiel, pas l'inverse.

### 2.8 Cohérence causale — respecter le happens-before

La **cohérence causale** ne garantit un ordre que pour les opérations **causalement liées** (relation **happens-before** de Lamport, détaillée au module 19). Si une opération A **cause** B — par exemple B est écrit *après avoir lu* A — alors **tout** processus qui voit B a **forcément** déjà vu A. Les opérations **concurrentes** (sans lien causal) peuvent être vues dans des ordres **différents** par des processus différents.

Exemple TribuZen : dans un fil de commentaires, « Papa : *on part à 9 h ?* » puis « Maman : *oui !* » sont causalement liés — personne ne doit voir « oui ! » **avant** la question. Mais deux commentaires postés **simultanément** par deux parents distincts peuvent apparaître dans un ordre différent chez chaque lecteur, sans gêne. La cohérence causale est le **plus fort** des modèles qui reste **disponible** en partition — mais en régime **sticky** : chaque client doit rester collé à une même réplique (Jepsen : *sticky available*), à la différence de la cohérence éventuelle qui est *totalement* disponible (voir §2.10). C'est tout de même son intérêt : plus fort que l'éventuelle sans imposer le CP. Causal ⟹ garanties de session (§2.9).

### 2.9 Garanties de session — le juste milieu utile

Sous une cohérence globalement faible, on veut souvent des garanties **par client** (« session ») qui suppriment les anomalies les plus choquantes :

- **Read-your-writes** (lis-tes-propres-écritures) : après **ta** écriture, **tes** lectures suivantes voient au moins cette écriture. Sans elle : tu changes ton avatar, tu recharges, l'ancien réapparaît (une réplique en retard). C'est la garantie **minimale attendue** d'une UI.
- **Monotonic reads** (lectures monotones) : tu ne vois **jamais le temps reculer** — si tu as lu une valeur, une lecture ultérieure ne renverra pas une valeur **plus ancienne**.
- **Monotonic writes** : tes écritures sont appliquées **dans l'ordre** où tu les as émises.

Ces garanties sont **faibles** (elles ne coordonnent que *ta* session) mais **bon marché**, et elles évitent 90 % des bizarreries visibles par un utilisateur.

### 2.10 Cohérence éventuelle — le bas du spectre

La **cohérence éventuelle** (*eventual consistency*) promet seulement : *« si plus aucune écriture n'arrive, toutes les répliques finissent par converger vers la même valeur »*. **Aucune** garantie sur le **délai** ni sur ce qu'on lit **entre-temps**. C'est le modèle **le plus faible** et **le moins cher** — celui d'un système **AP** en régime normal.

> **Piège de vocabulaire :** « éventuel » (anglicisme) ne veut **pas** dire « peut-être ». Le système **finira** par converger. « Éventuel » = « à terme, avec certitude, mais sans délai garanti ». Pendant la **fenêtre de convergence**, deux clients peuvent lire deux valeurs différentes — c'est le prix.

Comment on **résout les conflits** quand deux répliques ont divergé (last-write-wins, CRDT) → **module 21**. Comment on **converge** (anti-entropie, read-repair, quorums) → **module 10**.

### 2.11 Le spectre, ordonné (source Jepsen)

Pour une donnée unique, du plus fort au plus faible (chaque niveau **implique** les suivants) :

```
  PLUS FORT  ┌─ Linéarisable (temps réel, « une seule copie »)      ← CP obligatoire
     │       │      ⟹
     │       ├─ Séquentielle (ordre total, sans temps réel)         ← indisponible en partition (CP)
     │       │      ⟹
     │       ├─ Causale (respecte happens-before)                   ← + fort modèle STICKY available
     │       │   (+ PRAM / garanties de session en dessous :            (dispo si le client colle
     │       │    monotonic reads/writes, read-your-writes)              à une même réplique)
     │       │      ⟹
  PLUS FAIBLE└─ Éventuelle (converge un jour)                       ← TOTALEMENT dispo, AP
```

Jepsen le formalise : *« All models at or stronger than … sequential cannot be totally available »* (ils exigent une synchronisation → indisponibles en partition, donc **CP**). En dessous, deux régimes de disponibilité : la **cohérence causale** (et ses corollaires PRAM, read-your-writes, monotonic reads/writes) est **sticky available** — elle reste disponible en partition **à condition que chaque client reste collé à une même réplique** ; la **cohérence éventuelle** est **totalement disponible** (n'importe quelle réplique répond). C'est **la** ligne de partage : **la cohérence causale est le modèle le plus fort qu'on peut garder disponible** (en régime sticky) en partition. Au-dessus (séquentielle, linéarisable), la disponibilité **doit** tomber en partition.

---

## 3. Worked examples

### Exemple 1 — Classer quatre données TribuZen sur le spectre

But : pour chaque donnée, choisir un modèle **et** le profil CAP, en justifiant par le **coût métier d'une lecture obsolète**.

| Donnée TribuZen | Coût d'une lecture obsolète | Modèle visé | Profil |
|---|---|---|---|
| **Solde de la cagnotte partagée** | Élevé : décision d'argent faussée, relances inutiles, découvert | **Forte / linéarisable** | **CP** — refuser vaut mieux que mentir |
| **Fil d'activité de la famille** | Nul : voir un event 3 s en retard n'a aucune conséquence | **Éventuelle** | **AP** — toujours dispo |
| **Ordre d'un fil de commentaires** | Moyen : une réponse ne doit pas précéder sa question | **Causale** | **AP** (causal = totalement dispo) |
| **Préférences de mon propre profil** | Faible mais visible : je dois revoir ce que je viens de régler | **Read-your-writes** (session) | **AP** + garantie de session |

Raisonnement type (cagnotte) : la valeur est **de l'argent**, une lecture fausse a un coût métier **réel** → on veut la garantie la plus forte, quitte à répondre « réessaie » pendant une partition. Raisonnement type (fil d'activité) : la fraîcheur n'a **aucune** valeur métier → on prend le modèle le moins cher (éventuelle) pour rester rapide et disponible. **La donnée dicte le modèle, pas l'inverse.**

### Exemple 2 — Le même système, deux moments (lecture PACELC)

But : montrer que « AP » ne suffit pas à décrire un système ; il faut aussi le comportement **hors** partition.

Prends la base du fil d'activité, profil **PA/EL** (type Cassandra/DynamoDB) :

1. **Partition en cours (P → A)** : la réplique locale **répond** avec les events qu'elle a, même si un event tout récent n'a pas encore été répliqué. L'utilisateur voit un fil peut-être en retard, mais l'app **ne plante pas**.
2. **Réseau normal (E → L)** : même sans partition, une lecture **ne fait pas** d'aller-retour vers les autres répliques pour se garantir la toute dernière écriture ; elle **répond depuis la réplique locale**, vite. On accepte une micro-obsolescence permanente **en échange de latence basse**.

Contraste avec la cagnotte, profil **PC/EC** (type Spanner) :

1. **Partition (P → C)** : la réplique qui n'est pas sûre d'être à jour **refuse** — indisponibilité temporaire assumée.
2. **Réseau normal (E → C)** : chaque lecture **paie** la coordination (aller-retour / consensus) pour garantir la valeur exacte — **plus lent, mais juste**, tout le temps.

Conclusion : décrire correctement une donnée TribuZen = donner **les deux lettres de chaque côté** : le fil = **PA/EL**, la cagnotte = **PC/EC**. Le « comment » (quorums qui règlent ce curseur) → module 10.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — « CAP, c'est choisir 2 propriétés sur 3 »

Le mythe fondateur. On ne « choisit » **pas** P : les partitions sont **subies** (le réseau lâche, point). P est donc **toujours** dans l'équation d'un système distribué. Le vrai énoncé : **pendant une partition**, tu sacrifies **soit C, soit A**. Hors partition, tu peux avoir les deux. « 2 sur 3 » suggère un menu à trois plats permanent ; la réalité est un **arbitrage binaire déclenché par la partition**.

### PIÈGE #2 — Croire qu'un système « CA » existe en distribué

« Ma base est CA : cohérente et disponible, je me passe de P. » Faux dès qu'il y a **plus d'un nœud** répliqué. « Renoncer à P » signifie « faire comme si les partitions n'arrivaient pas » — et le jour où elles arrivent (elles arrivent), le système perd **soit** C **soit** A **sans l'avoir décidé**. Un seul nœud n'est pas « CA », il est **hors sujet CAP** (pas de partition interne possible). Répliqué = P imposé = choix CP ou AP.

### PIÈGE #3 — Confondre « cohérence forte » et « le système est correct »

La cohérence forte (linéarisabilité) n'est **pas** un gage universel de qualité : elle **coûte** de la latence (EC de PACELC) et **impose** l'indisponibilité en partition (CP). Pour un fil de likes, l'exiger est un **gâchis** : tu paies de la latence et tu perds de la disponibilité pour une garantie dont la donnée **n'a pas besoin**. Le bon réflexe n'est pas « le plus de cohérence possible » mais « **le juste modèle pour le coût métier de cette donnée** ».

### PIÈGE #4 — « Éventuel » = « peut-être un jour »

« Cohérence éventuelle, donc les données peuvent rester incohérentes. » Non : **si les écritures cessent, la convergence est garantie** — « éventuel » = « à terme, avec certitude ». Ce qui n'est **pas** garanti, c'est le **délai** et ce qu'on lit **pendant** la fenêtre de convergence. Éventuelle ≠ « pas de garantie » ; c'est **une** garantie, simplement faible.

### PIÈGE #5 — Oublier les garanties de session (tout ou rien)

Erreur fréquente : croire qu'il n'y a que « forte » et « éventuelle ». Entre les deux vit un **étage utile et bon marché** : **read-your-writes** (revoir ses propres écritures), **monotonic reads** (le temps ne recule pas). Sans elles, l'utilisateur change un réglage, recharge, et voit **l'ancien** — bug perçu comme grave alors que la donnée globale est « seulement » éventuelle. Souvent, la bonne réponse n'est pas « passer en cohérence forte » (cher) mais « ajouter une garantie de **session** » (peu cher).

### PIÈGE #6 — Confondre décider la cohérence et l'implémenter

Ce module **décide** (quel modèle pour quelle donnée). Il ne dit **pas** comment on l'obtient. « J'ai choisi la cohérence forte » ne devient réel qu'avec un **mécanisme** : quorums `W + R > N` et réplication (module 10), consensus/Raft (module 18) pour la linéarisabilité, horloges logiques (module 19) pour le causal, CRDT (module 21) pour converger sous éventuelle. Choisir le contrat ≠ le construire.

---

## 5. Ancrage TribuZen

TribuZen est multi-répliques (tolérance aux pannes) : **chaque type de donnée** reçoit un **contrat de cohérence explicite**, choisi sur le **coût métier d'une lecture obsolète**, pas par défaut.

**La carte de cohérence de TribuZen :**

```
DONNÉE                         MODÈLE              PROFIL     POURQUOI
────────────────────────────────────────────────────────────────────────────
Solde cagnotte / paiements     forte (linéaris.)   PC/EC      argent : refuser > mentir
Statut « place réservée »      forte               PC/EC      pas de survente d'une sortie
Fil de commentaires (ordre)    causale             PA/EL      réponse jamais avant question
Mes préférences de profil      read-your-writes    PA/EL      revoir ce que je viens de régler
Fil d'activité famille         éventuelle          PA/EL      3 s de retard = sans impact
Compteur « participants »      éventuelle          PA/EL      approximatif OK, convergence rapide
```

Décisions concrètes :

- **Le solde de cagnotte est le seul îlot CP** de TribuZen : une lecture pendant une partition **peut échouer** (« réessaie dans un instant ») plutôt que d'afficher un chiffre faux. On assume l'indisponibilité **rare** pour ne **jamais** mentir sur de l'argent.
- **Tout le reste est AP**, avec des **garanties de session** là où l'UI le réclame (mes propres réglages en read-your-writes). Le système reste **disponible** en partition ; la donnée **converge** ensuite.
- **PACELC guide aussi le régime normal** : le fil (PA/EL) lit depuis la réplique locale pour la **latence** ; la cagnotte (PC/EC) paie la coordination à **chaque** lecture pour la justesse.

> **Défère :** le **COMMENT** de tout ceci — réplication leader/leaderless, sharding, hashing cohérent, quorums `W + R > N`, read-repair = **module 10 (next)** ; les **transactions** cagnotte multi-comptes (2PC/saga) = **module 11** ; le **consensus** qui rend le solde linéarisable (Raft) = **module 18** ; les **horloges** qui ordonnent causalement le fil = **module 19** ; la **résolution de conflits** du compteur sous éventuelle (CRDT) = **module 21**. Ici on a **posé les contrats**, pas les mécanismes.

---

## 6. Points clés

1. Un **modèle de cohérence** est un contrat sur *ce que le système a le droit de retourner* ; plus il est **fort**, plus il coûte en **latence** et **disponibilité**.
2. **CAP** : P (partition) est **subie**, pas choisie → **pendant une partition**, on sacrifie **C ou A**. « 2 sur 3 » est faux.
3. **CP** = refuser plutôt que servir obsolète ; **AP** = toujours répondre, converger après. **« CA » distribué n'existe pas** (P imposé dès qu'on réplique).
4. **PACELC** : hors partition (**E**lse), on arbitre encore **Latence vs Cohérence**. Décrire un système = **PA/PC** *et* **EL/EC** (fil TribuZen = PA/EL, cagnotte = PC/EC).
5. **Spectre** (fort→faible, chaque niveau implique le suivant) : **linéarisable ⟹ séquentielle ⟹ causale ⟹ session (read-your-writes, monotonic) ⟹ éventuelle**.
6. **Ligne de partage disponibilité** : séquentielle et au-dessus **ne peuvent pas** rester disponibles en partition (CP) ; **causale est le plus fort modèle qui reste disponible**, en régime **sticky** (le client colle à une réplique) ; **éventuelle** est **totalement disponible** (AP).
7. **Éventuelle** = converge **à terme avec certitude** (pas « peut-être ») ; **garanties de session** = étage utile et bon marché entre forte et éventuelle.
8. Ce module **décide** la garantie selon le **coût métier de l'obsolescence** ; le **COMMENT** (quorums, réplication) = **module 10**.

---

## 7. Seeds Anki

```
Pourquoi l'énoncé « CAP = choisir 2 propriétés sur 3 » est-il faux ?|Parce que P (partition tolerance) n'est pas un choix : les partitions réseau sont subies dans tout système distribué. P est donc toujours présent. Le vrai énoncé : PENDANT une partition, on doit sacrifier soit C, soit A. Hors partition, on peut avoir les deux.
Quelle est la différence entre un système CP et un système AP ?|En partition, un système CP sacrifie la disponibilité : il refuse de répondre (erreur) plutôt que servir une valeur potentiellement obsolète — il reste cohérent. Un système AP sacrifie la cohérence : il répond toujours avec ce qu'il a, quitte à être obsolète, et les répliques convergent plus tard.
Pourquoi un système « CA » n'existe-t-il pas en distribué ?|Parce que dès qu'on réplique une donnée sur plusieurs nœuds, les partitions sont inévitables (P imposé). « Renoncer à P » = faire comme si les partitions n'arrivaient pas ; le jour où elles arrivent, le système perd C ou A sans l'avoir décidé. Un nœud unique n'est pas « CA », il est hors sujet CAP.
Qu'ajoute PACELC au théorème CAP ?|PACELC : si Partition → choisir A ou C (le CAP classique) ; sinon (Else, hors partition) → choisir Latence ou Consistency. Il capture le fait que même sans partition, garantir la cohérence forte coûte de la latence (coordination). Ex : Cassandra/DynamoDB = PA/EL, Spanner/CockroachDB = PC/EC.
Qu'est-ce que la linéarisabilité (cohérence forte) ?|Le modèle le plus fort pour une donnée unique : chaque opération paraît prendre effet instantanément en un point entre son invocation et sa réponse ; le système se comporte comme une seule copie. Dès qu'une écriture est confirmée, toute lecture ultérieure la voit. C'est le C de CAP ; il impose CP (indispo en partition).
Ordonne le spectre de cohérence du plus fort au plus faible.|Linéarisable ⟹ séquentielle ⟹ causale ⟹ garanties de session (read-your-writes, monotonic reads/writes) ⟹ éventuelle. Chaque niveau implique les suivants. La séquentielle et au-dessus ne peuvent pas rester disponibles en partition (CP) ; la causale est le plus fort modèle qui reste disponible mais en régime STICKY (le client colle à une réplique) ; l'éventuelle est totalement disponible.
Que garantit la cohérence causale et pourquoi est-elle intéressante ?|Elle ordonne uniquement les opérations causalement liées (happens-before) : si A cause B, tout processus qui voit B a déjà vu A ; les opérations concurrentes peuvent être vues dans des ordres différents. Intérêt : c'est le modèle le plus fort qui reste disponible en partition, en régime STICKY (le client colle à une réplique) — plus fort que l'éventuelle sans imposer le CP.
Que signifie « cohérence éventuelle » — et que ne garantit-elle pas ?|Elle garantit que si les écritures cessent, toutes les répliques convergent à terme vers la même valeur (avec certitude, pas « peut-être »). Elle ne garantit PAS le délai de convergence ni ce qu'on lit pendant la fenêtre : deux clients peuvent lire deux valeurs différentes temporairement.
Qu'est-ce que la garantie de session read-your-writes ?|Après TES propres écritures, TES lectures suivantes voient au moins cette écriture. Sans elle : tu changes un réglage, tu recharges, l'ancien réapparaît (réplique en retard). C'est une garantie faible et bon marché (elle ne coordonne que ta session), souvent la bonne réponse plutôt que passer en cohérence forte.
Comment choisir le modèle de cohérence d'une donnée TribuZen ?|Selon le COÛT MÉTIER d'une lecture obsolète. Coût élevé (solde de cagnotte = argent) → cohérence forte / CP (refuser plutôt que mentir). Coût nul (fil d'activité) → éventuelle / AP. Coût moyen (ordre d'un fil) → causale. Réglage perso visible → read-your-writes. La donnée dicte le modèle.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-09-coherence-et-theoreme-cap/README.md`. Exercice d'architecture (pas de code) : classer un jeu de données TribuZen par **modèle de cohérence requis** et justifier **CP vs AP** (+ profil PACELC) au regard du **coût métier d'une lecture obsolète**, puis défendre chaque choix face à une objection. Évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur.
