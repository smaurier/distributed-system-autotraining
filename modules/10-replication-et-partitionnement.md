---
titre: Réplication & partitionnement
cours: 17-distributed-systems
notions: ["réplication", "single-leader (primary/replica)", "multi-leader", "leaderless (Dynamo-style)", "réplication synchrone", "réplication asynchrone", "semi-synchrone", "replication lag", "read-your-writes", "failover", "quorum", "N (nombre de répliques)", "W (quorum d'écriture)", "R (quorum de lecture)", "W + R > N", "W > N/2", "read repair", "anti-entropy", "sloppy quorum", "hinted handoff", "partitionnement / sharding", "partitionnement par plage (range)", "partitionnement par hash", "consistent hashing", "noeud virtuel (vnode)", "rééquilibrage (rebalancing)", "hotspot / hot partition", "clé de partition"]
outcomes:
  - "sait distinguer réplication single-leader, multi-leader et leaderless (Dynamo-style) et nommer le compromis de chacune"
  - "sait expliquer réplication synchrone vs asynchrone, le replication lag et ce qu'un failover asynchrone peut perdre"
  - "sait poser et interpréter les inégalités de quorum W + R > N (lecture à jour) et W > N/2 (pas d'écritures concurrentes en conflit)"
  - "sait calculer un quorum concret (N, W, R) et régler le curseur cohérence/disponibilité"
  - "sait distinguer partitionnement par plage et par hash et nommer le risque de hotspot de chacun"
  - "sait dessiner un consistent hash ring, expliquer la fraction de clés déplacée à l'ajout d'un noeud, et le rôle des noeuds virtuels"
prerequis: ["Module 00 — pourquoi le distribué, fallacies", "Module 01 — réseau, latence, partial failure", "Module 05 — communication asynchrone, garanties de livraison", "Module 08 — retries, timeouts, idempotency", "Module 09 — cohérence & théorème CAP (cohérence forte→éventuelle, PACELC)"]
next: 11-transactions-distribuees-saga
libs: []
tribuzen: "backend TribuZen — répliquer la base des familles (1 leader + 2 followers asynchrones, lag assumé) et sharder le journal d'activité par familyId sur un consistent hash ring pour scaler l'écriture"
last-reviewed: 2026-07
---

# Réplication & partitionnement

> **Outcomes — tu sauras FAIRE :** distinguer single-leader / multi-leader / leaderless et leur compromis, expliquer réplication sync/async + replication lag + ce qu'un failover perd, poser et calculer les quorums `W + R > N` et `W > N/2`, distinguer partitionnement par plage et par hash et leurs hotspots, dessiner un consistent hash ring et le rôle des noeuds virtuels.
> **Difficulté :** :star::star::star::star:
>
> **Portée :** ce module traite des **deux façons de distribuer les données** — les **copier** (réplication : la même donnée sur plusieurs noeuds) et les **découper** (partitionnement/sharding : chaque noeud n'a qu'un morceau). Il s'appuie sur le **module 09** (CAP, cohérence forte→éventuelle) : ici on voit les **mécanismes** qui produisent ces cohérences (leader, quorums, lag). On **ne** couvre **pas** ici : le **consensus** (élection de leader, Raft, comment le système *décide* qui est leader) → **module 18** ; la **résolution de conflits** profonde (CRDTs, vector clocks) → **modules 19 et 21** ; les **transactions** réparties (2PC, saga) → **module 11 (next)**. Ici : où vivent les copies, combien de noeuds doivent répondre, et comment on répartit les clés sans tout re-mélanger.

## 1. Cas concret d'abord

Le backend de TribuZen tourne sur **une seule** base PostgreSQL. Deux problèmes remontent en même temps :

**Problème A — un seul noeud, un seul point de défaillance.** Si cette base tombe (crash disque, reboot du serveur), **tout TribuZen est down** : plus de lecture, plus d'écriture. Et les lectures explosent : chaque parent qui ouvre l'app lit la liste des familles, des sorties, des routines. La base sature en lecture aux heures de pointe (le soir), alors que **99 % du trafic est de la lecture**.

**Problème B — une table qui grossit sans fin.** Le **journal d'activité** (`activity_log` : « Alice a validé la routine du soir », « Bob a créé une sortie ») grandit de millions de lignes par mois. Bientôt, elle **ne tient plus sur un seul disque**, et les écritures deviennent lentes car l'index est énorme. Aucune réplique ne résout ça : répliquer, c'est copier le problème sur chaque noeud.

Deux problèmes, **deux réponses différentes** :

```
Problème A (lecture + panne)          Problème B (table trop grosse)
  → RÉPLICATION                          → PARTITIONNEMENT (sharding)
  copier la MÊME donnée                  découper la donnée en MORCEAUX
  sur plusieurs noeuds                   répartis sur plusieurs noeuds

  ┌────┐  copie  ┌────┐                  ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ DB │────────▶│ DB │                  │ shard A  │ │ shard B  │ │ shard C  │
  │leader│      │follow│                 │ familles │ │ familles │ │ familles │
  └────┘        └────┘                   │  0–999   │ │1000–1999 │ │2000–2999 │
   ▲ tolérance panne + lecture           └──────────┘ └──────────┘ └──────────┘
                                          chaque noeud ne stocke qu'un tiers
```

La **réplication** répond à A : plusieurs copies → si une tombe, une autre prend le relais ; et on répartit les lectures sur les répliques. Le **partitionnement** répond à B : on coupe la table en tranches, chaque noeud n'en garde qu'une → la donnée totale dépasse un seul disque, et les écritures se répartissent. Les deux se **combinent** presque toujours (chaque shard est lui-même répliqué). Ce module te donne les mécanismes exacts : **qui accepte les écritures** (leader ou pas), **combien de noeuds doivent répondre** (le quorum `W + R > N`), et **comment répartir les clés** sans tout re-mélanger à chaque ajout de serveur (consistent hashing).

---

## 2. Théorie complète, concise

### 2.1 Pourquoi répliquer — et le prix caché

**Répliquer** = garder la **même** donnée sur plusieurs noeuds. Trois bénéfices : **tolérance aux pannes** (un noeud tombe, un autre sert), **scalabilité en lecture** (répartir les lectures sur les répliques), **proximité géographique** (une copie près de l'utilisateur → latence réduite).

Le **prix caché** : dès qu'une donnée **change**, il faut propager le changement à **toutes** les copies. Tout le reste du module découle de **comment** et **quand** on propage ce changement. La question centrale : **qui a le droit d'accepter une écriture ?** Trois réponses → trois architectures.

### 2.2 Single-leader (primary / replica) — le modèle par défaut

**Un seul** noeud, le **leader** (primary), accepte les **écritures**. Il propage chaque changement (via un **replication log**) aux **followers** (replicas), qui ne servent que des **lectures**.

```
      écritures                lectures            lectures
          │                        │                   │
          ▼                        ▼                   ▼
     ┌─────────┐   log    ┌──────────┐        ┌──────────┐
     │ LEADER  │─────────▶│ FOLLOWER │        │ FOLLOWER │
     │  R + W  │─────────▶│  R only  │        │  R only  │
     └─────────┘          └──────────┘        └──────────┘
```

C'est le modèle de **PostgreSQL, MySQL, MongoDB** en configuration standard. Avantage : **pas de conflit d'écriture** possible (un seul point d'entrée décide de l'ordre). Limites : le leader est un **goulot d'étranglement en écriture** (tout passe par lui) et un **point de défaillance** — s'il tombe, il faut un **failover** (promouvoir un follower en nouveau leader, §2.4).

### 2.3 Réplication synchrone, asynchrone, semi-synchrone

**Quand** le leader considère-t-il une écriture comme « faite » ? C'est le curseur le plus important.

- **Synchrone** — le leader attend que le(s) follower(s) aient **confirmé** avoir appliqué le changement **avant** de répondre au client. Garantie : le follower a une copie **à jour**. Coût : l'écriture est **aussi lente que le follower le plus lent** ; si un follower ne répond pas, l'écriture **bloque**.
- **Asynchrone** — le leader répond au client **immédiatement** après avoir écrit localement, et propage **en arrière-plan**. Rapide, tolère un follower lent/absent. Coût : les followers sont **en retard** (§2.4) et un **failover peut perdre** les écritures pas encore propagées.
- **Semi-synchrone** — compromis courant : **un** follower synchrone (garantit qu'au moins une copie à jour existe ailleurs), les **autres** asynchrones. Si le follower synchrone ralentit, un asynchrone est promu synchrone.

> Règle : la réplication **totalement synchrone** sur tous les followers est rare en pratique — un seul follower lent gèle toutes les écritures. Le défaut réel est **asynchrone** ou **semi-synchrone**.

### 2.4 Replication lag, read-your-writes, et ce qu'un failover perd

En asynchrone, les followers sont **en retard** sur le leader : c'est le **replication lag** (souvent quelques millisecondes, parfois secondes sous charge). Conséquence directe : une lecture sur un follower peut renvoyer une valeur **périmée** (stale) — c'est la **cohérence éventuelle** vue au module 09, ici on en voit la cause mécanique.

Le piège concret est **read-your-writes** (ou *read-after-write*) : un parent modifie le nom de sa famille (écriture → leader), puis recharge la page (lecture → un follower **en retard**) et **ne voit pas** son propre changement. Parades : lire depuis le **leader** juste après une écriture de l'utilisateur, ou router ses lectures vers un follower **assez à jour**.

Et le **failover** : si le leader tombe, on promeut un follower. En asynchrone, les écritures que le leader avait acceptées **mais pas encore propagées** sont **perdues** — le nouveau leader ne les a jamais vues. C'est le compromis assumé de l'async : vitesse contre risque de perte au failover.

### 2.5 Multi-leader — plusieurs points d'écriture

**Plusieurs** leaders acceptent les écritures (typiquement **un par datacenter**), et se synchronisent entre eux. Utile pour la **distribution géographique** (écrire localement, à faible latence) et le **fonctionnement hors-ligne** (l'app mobile est son propre « leader » local qui se resynchronise).

```
   Datacenter EU              Datacenter US
   ┌──────────┐   sync bidir  ┌──────────┐
   │ Leader EU │◀────────────▶│ Leader US │
   └──────────┘   CONFLITS ↑  └──────────┘
```

Le prix : les **conflits d'écriture**. Deux leaders peuvent modifier la **même** clé **en même temps** avec des valeurs différentes → il faut **résoudre le conflit**. Stratégie simple mais lossy : **Last-Write-Wins (LWW)** — on garde la valeur au timestamp le plus récent, on **jette** l'autre (donc on perd une écriture). Résolution sans perte (CRDTs) = **module 21**. La détection de « qui a écrit avant qui » sans horloge fiable = **module 19** (vector clocks). Ici, retiens : multi-leader = faible latence géo **au prix des conflits**.

### 2.6 Leaderless (Dynamo-style) — pas de leader, on vote

**Aucun** noeud n'est leader. Le client (ou un coordinateur) envoie **chaque écriture et chaque lecture à plusieurs répliques en parallèle**. C'est le modèle introduit par **Amazon Dynamo** (2007), repris par **Cassandra, Riak, ScyllaDB**.

L'idée clé : on n'attend **pas** *toutes* les répliques, seulement un **quorum** (§2.7). Comme certaines répliques peuvent rater une écriture (elles étaient down), le système **répare** en continu :

- **Read repair** — à la lecture, le client interroge plusieurs répliques **en parallèle**, détecte les réponses **périmées** (via un numéro de version) et **réécrit la valeur récente** sur les répliques en retard. La lecture soigne au passage.
- **Anti-entropy** — un **processus de fond** compare en permanence les données entre répliques et copie ce qui manque. Il n'a pas d'ordre garanti et peut prendre du temps, mais finit par tout réconcilier.
- **Sloppy quorum + hinted handoff** — si une réplique cible est down, l'écriture est acceptée par un **autre** noeud disponible (pas dans le jeu de répliques « normal »), qui garde un **hint** (« ceci appartient au noeud X ») et le **relivre** au retour du noeud X. Ça augmente la **disponibilité en écriture** ; en contrepartie, une lecture peut rester **périmée** tant que le hinted handoff n'est pas terminé.

Compromis leaderless : très **résilient et disponible**, **cohérence réglable** (par les quorums), mais **complexe** (conflits possibles, réconciliation en continu).

### 2.7 Quorums : `W + R > N` et `W > N/2` (le coeur du module)

Dans un système leaderless (et dans la logique de tout système répliqué qui « vote »), on pose **trois nombres** :

- **N** — le nombre de **répliques** d'une donnée (facteur de réplication, ex. 3).
- **W** — le **quorum d'écriture** : combien de répliques doivent **confirmer** une écriture pour qu'elle soit considérée réussie.
- **R** — le **quorum de lecture** : combien de répliques doivent **répondre** à une lecture pour qu'on prenne la réponse.

La condition fondatrice (Gifford, 1979), vérifiée sur les définitions classiques du quorum :

> **`W + R > N`** garantit qu'un jeu de lecture et un jeu d'écriture **se chevauchent sur au moins une réplique** — donc toute lecture voit **au moins une** réplique qui a la version la plus récente. C'est la condition de **cohérence forte / read-your-writes** dans un système à quorum.
>
> **`W > N/2`** garantit que **deux écritures ne peuvent pas réussir en même temps** sur la même donnée (leurs jeux se chevaucheraient) — **pas d'écritures concurrentes en conflit**.

Le **raisonnement de recouvrement** (intuition à retenir) : si j'écris sur `W` répliques et lis sur `R` répliques parmi `N`, et que `W + R > N`, alors par principe des tiroirs les deux ensembles **partagent forcément au moins un noeud** — ce noeud a la valeur fraîche, la lecture la voit (on prend la version la plus récente parmi les réponses).

**Le curseur cohérence ↔ disponibilité se règle par W et R** (illustre CAP du module 09) :

| Réglage (N=3) | Effet |
|---|---|
| `W=3, R=1` | écritures lentes/fragiles (attend les 3), lectures rapides et **à jour** — bon pour du **read-heavy** |
| `W=1, R=3` | écritures rapides et dispos, lectures lentes mais **à jour** — bon pour du **write-heavy** |
| `W=2, R=2` | équilibré : `2+2=4 > 3` ✅ cohérent, tolère **1** noeud down en lecture **et** en écriture |
| `W=1, R=1` | ultra-dispo et rapide, mais `1+1=2 ≯ 3` ❌ → **cohérence éventuelle** seulement (lecture peut être périmée) |

Règle mnémotechnique : **`W + R > N` = cohérent** ; en dessous, on a troqué la cohérence contre de la disponibilité/latence. Le choix classique **`W = R = (N+1)/2`** (quorum majoritaire, ex. `2` pour `N=3`) satisfait les deux inégalités à la fois.

### 2.8 Partitionnement (sharding) : couper, pas copier

Répliquer ne suffit pas quand la donnée **totale** dépasse un seul noeud (Problème B du §1) : chaque copie porterait le même volume. Il faut **partitionner** (= *sharder*) : découper les données en **partitions** (shards), chacune sur un noeud (ou groupe de noeuds). Chaque noeud ne détient qu'un **sous-ensemble**. Objectif : **scalabilité en écriture** et **volume** — réparti sur M noeuds, chacun fait `1/M` du travail.

Le nerf : la **clé de partition** — l'attribut qui décide **dans quel shard** va chaque enregistrement (ex. `familyId`). Deux grandes stratégies pour mapper clé → shard.

### 2.9 Partitionnement par plage (range) vs par hash

**Par plage (range).** Chaque shard détient un **intervalle contigu** de clés (ex. familles `A–I`, `J–R`, `S–Z`). Avantage : les **range scans** sont efficaces (« toutes les familles de M à P » = un seul shard, clés triées). Inconvénient : **hotspots** si les écritures se concentrent sur un intervalle — le cas classique est une **clé temporelle** (`createdAt`) : *toutes* les nouvelles lignes tombent dans le **dernier** shard, qui devient brûlant pendant que les autres dorment. Ex. HBase, Spanner.

**Par hash.** On applique une **fonction de hash** à la clé, et le hash décide du shard (ex. `hash(familyId) % M`). Avantage : distribution **uniforme** (le hash « éparpille » même des clés séquentielles). Inconvénient : on **perd les range scans** (deux clés voisines finissent sur des shards différents). Ex. Cassandra, DynamoDB.

```
 RANGE                                    HASH
 [A–I]│[J–R]│[S–Z]                        hash(clé) éparpille
  ▲ range scan facile                      ▲ distribution uniforme
  ▲ hotspot si clés temporelles            ▲ pas de range scan
```

Piège du `hash(clé) % M` **naïf** : dès qu'on **change M** (ajout/retrait d'un noeud), le modulo change pour **presque toutes** les clés → **quasi tout doit migrer**. C'est exactement ce que le consistent hashing évite.

### 2.10 Consistent hashing : rééquilibrer sans tout re-mélanger

Le **consistent hashing** place noeuds **et** clés sur un **anneau** (l'espace de hash, 0 → 2³²−1, refermé sur lui-même). Une clé est stockée sur le **premier noeud rencontré dans le sens horaire** à partir de sa position.

```
              0 / 2^32
                 │
        NodeC ───┼─── NodeA
       /         │         \
      │   k3     │    k1     │   chaque clé → 1er noeud horaire
      │          │           │  k1 → NodeA, k2 → NodeB, k3 → NodeC
       \        k2          /
        NodeB ───┼─────────
```

Propriété clé (vérifiée sur les définitions de référence) : quand on **ajoute** un noeud, **seule une fraction des clés** change de propriétaire — **en moyenne `n/m`** clés doivent bouger (`n` = nombre de clés, `m` = nombre de noeuds/slots), et l'ajout du **n-ième** noeud ne déplace qu'une fraction **`1/n`** des données. Les autres clés **ne bougent pas**. À comparer au `hash % M` naïf où **presque tout** migre. C'est **le** gain du consistent hashing : rééquilibrage **minimal** à l'ajout/retrait.

**Le problème de distribution & les noeuds virtuels.** Avec **un** point par noeud sur l'anneau, la répartition est **inégale** (un noeud peut hériter d'un grand arc). Parade : chaque noeud physique est représenté par **plusieurs points** sur l'anneau — les **noeuds virtuels** (*vnodes*, souvent 100–200 par noeud physique). Plus de points → arcs plus fins et plus nombreux → distribution **quasi uniforme**, et le nombre de vnodes sert aussi à **pondérer** un noeud plus puissant (plus de vnodes = plus de clés). C'est ce que fait Cassandra/DynamoDB en interne.

### 2.11 Rééquilibrage & hotspots

**Rééquilibrage (rebalancing)** = redistribuer les partitions quand on ajoute/retire des noeuds. Avec consistent hashing, seule une **fraction** des clés migre (§2.10). Bonnes pratiques : rééquilibrer **progressivement** (pas tout d'un coup, sous peine de saturer le réseau), et éviter le rééquilibrage **automatique agressif** (une panne transitoire prise pour un départ définitif déclenche une migration massive inutile).

**Hotspot (hot partition)** = une clé ou une partition qui reçoit une charge **disproportionnée**, même avec un bon hash — typiquement une **clé très populaire** (la famille d'un influenceur, une célébrité, un compte partagé). Le hash répartit les *clés* uniformément, pas le *trafic par clé*. Parades : **ajouter un suffixe/salt** à la clé chaude pour l'éclater sur plusieurs partitions (`famille:42:s3` — au prix de lectures qui doivent recoller les morceaux), **cache** devant les partitions chaudes, ou **split** dynamique de la partition saturée.

---

## 3. Worked examples

### Exemple 1 — Régler N, W, R pour deux besoins TribuZen

TribuZen passe la couche « famille » sur un store leaderless à **N = 3** répliques. Deux besoins, deux réglages.

**Besoin 1 — le profil de famille (nom, avatar) : lecture très fréquente, cohérence attendue.**
Un parent modifie le nom, recharge, doit **voir** son changement (read-your-writes). Il faut donc `W + R > N`. On veut aussi des **lectures rapides et à jour** (read-heavy) → petit R.

- Choix : **`W = 3, R = 1`**. Vérif : `3 + 1 = 4 > 3` ✅ cohérent. La lecture (R=1) est rapide **et** à jour car **toute** réplique a la dernière écriture (W a attendu les 3).
- Coût assumé : l'écriture attend les 3 répliques → plus lente, et **échoue si un noeud est down**. Acceptable : on modifie un profil rarement.

**Besoin 2 — le compteur de « vues » d'une sortie : écriture très fréquente, cohérence molle OK.**
Perdre une vue de temps en temps est sans conséquence ; il faut surtout **encaisser** les écritures même si un noeud est down (write-heavy, haute dispo).

- Choix : **`W = 1, R = 1`**. Vérif : `1 + 1 = 2 ≯ 3` ❌ → **cohérence éventuelle** assumée (une lecture peut sous-compter un instant, read repair/anti-entropy réconcilient).
- Bénéfice : écriture ultra-dispo (un seul noeud suffit), latence minimale.

**Lecture transversale :** le **même cluster** (N=3) sert deux cohérences **différentes** juste en bougeant W et R par type de donnée. C'est CAP (module 09) rendu **réglable** au niveau de la requête.

### Exemple 2 — Ajouter un shard au journal d'activité sans tout re-mélanger

Le `activity_log` de TribuZen est sharder par `familyId`. On part de **3 noeuds** (A, B, C) et on veut ajouter **D** parce que le volume explose.

**Étape 1 — pourquoi PAS `hash(familyId) % M`.** Avec 3 noeuds, `familyId=1042 → 1042 % 3 = 1 → node B`. Si on passe à 4 noeuds, `1042 % 4 = 2 → node C`. **Presque toutes** les familles changent de noeud → migration massive, cluster à genoux. Rejeté.

**Étape 2 — consistent hash ring.** On place A, B, C sur l'anneau (avec ~150 vnodes chacun pour lisser). Chaque `familyId` est hashé → va au **premier noeud horaire**.

```
Avant (A,B,C) :          Ajout de D entre C et A sur l'anneau :
  arc→A : familles ...     seules les familles de l'arc [C→D]
  arc→B : familles ...     basculent de A vers D.
  arc→C : familles ...     Les arcs →B et →C ne bougent PAS.
```

**Étape 3 — ce qui migre.** À l'ajout du 4ᵉ noeud, on déplace **~1/4** des clés (celles tombant dans le nouvel arc de D), **pas** les 3/4 autres. Migration bornée, cluster stable.

**Étape 4 — surveiller le hotspot.** Une famille virale (mille membres actifs) peut surcharger **son** shard même avec un hash parfait. Si le monitoring le montre : suffixer sa clé (`famille:42:s0..s3`) pour l'éclater, ou mettre un cache devant. On ne le fait **que** pour les clés chaudes identifiées, pas par défaut (ça complique lectures/écritures).

**Bilan :** consistent hashing = on ajoute de la capacité en **déplaçant le minimum** ; le range aurait donné des range scans faciles sur `familyId` mais un **hotspot temporel** garanti (les nouvelles familles toutes sur le dernier shard).

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire que « répliqué » veut dire « toujours à jour partout »

Faux dès que la réplication est **asynchrone** (le défaut réel). Les followers ont un **replication lag** : une lecture sur un follower peut renvoyer une valeur **périmée**. Le cas visible est **read-your-writes** : l'utilisateur modifie une donnée puis ne la voit pas au rechargement. Parade : router **sa** lecture vers le leader (ou un follower assez à jour) juste après son écriture. Répliqué ≠ synchrone.

### PIÈGE #2 — Confondre réplication et partitionnement

« On a mis 3 serveurs, la donnée est répartie. » Répartie **comment** ? **Répliquer** = la **même** donnée sur les 3 (tolérance panne + lecture, mais chaque noeud porte **tout** le volume). **Partitionner** = **découper** la donnée en 3 (chaque noeud porte 1/3 → scale le volume/écriture, mais un noeud perdu = un tiers de données indisponible s'il n'est pas lui-même répliqué). Ce sont deux axes **orthogonaux** qu'on **combine** (chaque shard est répliqué). Répliquer ne résout **jamais** un problème de volume.

### PIÈGE #3 — Oublier le sens de l'inégalité de quorum

`W + R > N` est **strict** (`>`, pas `≥`). Avec `N=3`, `W=1, R=1` donne `2`, qui **n'est pas** `> 3` → **pas** de recouvrement garanti → lecture potentiellement périmée. Beaucoup croient « un quorum, c'est juste la majorité » : la **cohérence** vient précisément du **chevauchement** `W + R > N`, et l'**absence d'écritures conflictuelles** de `W > N/2`. Toujours **calculer** l'inégalité, ne pas la supposer.

### PIÈGE #4 — Le `hash(clé) % M` naïf pour partitionner

`hash(clé) % M` répartit bien… **tant que M ne change pas**. Ajoute ou retire un noeud (M change) et le modulo remappe **presque toutes** les clés → migration quasi totale. C'est le problème que **consistent hashing** résout : à l'ajout d'un noeud, seule une fraction (`~1/n`) des clés bouge. N'utilise `% M` que pour un nombre de partitions **fixe** ; sinon, anneau.

### PIÈGE #5 — Un seul point par noeud sur l'anneau

« Consistent hashing = un noeud, un point sur l'anneau. » Ça **marche** mais **distribue mal** : un noeud peut hériter d'un arc énorme (charge inégale), et retirer un noeud renvoie **tout son arc** à son seul voisin. Les **noeuds virtuels** (100–200 points par noeud physique) lissent la distribution et étalent la charge d'un noeud disparu sur **plusieurs** voisins. Ils servent aussi à **pondérer** un noeud plus puissant. Sans vnodes, l'anneau tient mal ses promesses.

### PIÈGE #6 — Croire que le hash tue les hotspots

Le hash répartit uniformément les **clés**, **pas** le trafic **par clé**. Une clé unique très sollicitée (la famille d'une célébrité) sature **sa** partition même avec un hash parfait — c'est une **hot key**, pas un défaut de distribution. Aucun hash n'y peut rien : il faut **éclater la clé** (salt/suffixe), la **cacher**, ou **splitter** la partition. Diagnostic par le **monitoring**, traitement ciblé sur les clés chaudes seulement.

### PIÈGE #7 — Croire qu'un failover asynchrone ne perd rien

En réplication asynchrone, le leader confirme au client **avant** d'avoir propagé. S'il tombe et qu'un follower en retard est promu, les écritures **acceptées mais non propagées** sont **perdues** — le nouveau leader ne les a jamais reçues. C'est le prix **assumé** de l'async (vitesse contre durabilité au failover). Si cette perte est inacceptable pour une donnée, il faut du **synchrone** (ou semi-sync) sur cette donnée — et en payer la latence.

---

## 5. Ancrage TribuZen

TribuZen distribue ses données sur **les deux axes** — répliquer pour tenir la charge de lecture et les pannes, sharder pour encaisser le volume d'écriture du journal.

**Axe réplication — la base `familles` (single-leader, asynchrone).**

```
   POST /familles (write)          GET /familles (read, ×N)
          │                                │
          ▼                                ▼
     ┌─────────┐   WAL log     ┌──────────┐   ┌──────────┐
     │ LEADER  │──────────────▶│ FOLLOWER │   │ FOLLOWER │
     │ (Postgres)│  async       │ (replica)│   │ (replica)│
     └─────────┘──────────────▶└──────────┘   └──────────┘
       toutes les écritures      lag ~ms, sert les lectures
```

Décisions concrètes :
- **Single-leader** : pas de conflit d'écriture, simple à raisonner. Un failover (promotion d'un follower) est géré par l'orchestrateur — **comment** on élit le nouveau leader relève du **consensus, module 18**.
- **Asynchrone + read-your-writes** : les lectures publiques (liste des sorties d'une famille) partent sur les followers (lag de quelques ms acceptable). **Mais** juste après qu'un parent modifie **sa** donnée, on route **sa** lecture vers le **leader** pour qu'il voie son changement.
- **Perte au failover assumée** pour ces données non critiques ; les données **critiques** (paiement d'un abonnement) exigeraient du **semi-synchrone**.

**Axe partitionnement — le `activity_log` (sharding par `familyId` sur consistent hash ring).**
- **Clé de partition = `familyId`** : toute l'activité d'une famille sur le **même** shard → les lectures « historique de MA famille » restent locales à un shard.
- **Consistent hashing + vnodes** : ajouter un shard quand le volume grossit **ne déplace qu'une fraction** des familles, pas tout le journal.
- **Hotspot** : une famille très active peut surcharger son shard → monitoring, puis salt de la clé si nécessaire.
- **Chaque shard est lui-même répliqué** (les deux axes combinés) : volume **et** tolérance aux pannes.

> **Défère :** l'**élection** du nouveau leader et l'accord entre noeuds = **consensus, module 18** ; la **résolution** des conflits multi-leader/leaderless sans perte = **CRDTs, module 21** ; « qui a écrit avant qui » sans horloge fiable = **horloges logiques, module 19** ; écrire de façon **transactionnelle** à travers plusieurs shards = **transactions distribuées & saga, module 11 (next)** ; le **choix de cohérence** (forte vs éventuelle, PACELC) = **module 09 (prérequis)**. Ici on a posé **où vivent les copies et comment on répartit les clés**.

---

## 6. Points clés

1. **Deux axes orthogonaux** : **répliquer** = même donnée sur plusieurs noeuds (panne + lecture) ; **partitionner** = découper la donnée en shards (volume + écriture). On les **combine**.
2. **Trois modèles de réplication** : **single-leader** (un point d'écriture, pas de conflit, mais SPOF + goulot) ; **multi-leader** (faible latence géo, mais **conflits**) ; **leaderless / Dynamo** (résilient, cohérence réglable, mais réconciliation continue).
3. **Sync vs async** : synchrone = follower à jour mais lent (aussi lent que le plus lent) ; **asynchrone** (le défaut) = rapide mais **replication lag** et **perte possible au failover**. Semi-sync = un follower sync, les autres async.
4. **Quorums** : **`W + R > N`** garantit le **chevauchement** lecture/écriture → lecture à jour (cohérence forte) ; **`W > N/2`** interdit les **écritures concurrentes en conflit**. En dessous → cohérence éventuelle. On règle le curseur CAP par **W et R**.
5. **Leaderless répare en continu** : **read repair** (la lecture réécrit les répliques périmées), **anti-entropy** (fond), **sloppy quorum + hinted handoff** (dispo en écriture, au prix de lectures périmées transitoires).
6. **Range vs hash** : **par plage** = range scans faciles mais **hotspot** sur clé temporelle ; **par hash** = distribution uniforme mais **pas de range scan**. `hash % M` naïf = migration quasi totale quand M change.
7. **Consistent hashing** : anneau, clé → premier noeud horaire ; à l'ajout d'un noeud seule **~1/n** des clés migre (vs tout avec `% M`). Les **noeuds virtuels** lissent la distribution et pondèrent. Le hash ne tue **pas** les **hotspots** de clé chaude (salt/cache/split ciblés).

---

## 7. Seeds Anki

```
Quelle est la différence entre répliquer et partitionner (sharder) des données ?|Répliquer = garder la MÊME donnée sur plusieurs noeuds (tolérance aux pannes + scalabilité en lecture ; chaque noeud porte tout le volume). Partitionner/sharder = DÉCOUPER la donnée en morceaux répartis (chaque noeud ne porte qu'un sous-ensemble → scale le volume et l'écriture). Axes orthogonaux qu'on combine : chaque shard est lui-même répliqué.
Quels sont les trois modèles de réplication et leur compromis ?|Single-leader : un seul noeud accepte les écritures (pas de conflit, simple, mais SPOF + goulot d'écriture). Multi-leader : plusieurs points d'écriture, souvent un par datacenter (faible latence géo, mais CONFLITS d'écriture à résoudre). Leaderless/Dynamo-style : aucun leader, écriture/lecture à plusieurs répliques + quorum (résilient, cohérence réglable, mais réconciliation continue).
Réplication synchrone vs asynchrone : que garantit et que risque chacune ?|Synchrone : le leader attend la confirmation du follower avant de répondre → follower à jour, mais écriture aussi lente que le follower le plus lent (bloque si un follower est absent). Asynchrone (le défaut) : le leader répond immédiatement et propage en arrière-plan → rapide, mais replication lag (followers en retard) et un failover peut PERDRE les écritures non encore propagées.
Que garantit W + R > N et que garantit W > N/2 dans un système à quorum ?|W + R > N garantit que le jeu de lecture et le jeu d'écriture se CHEVAUCHENT sur au moins une réplique → toute lecture voit au moins une copie à jour (cohérence forte / read-your-writes). W > N/2 garantit que deux écritures ne peuvent pas réussir en même temps sur la même donnée → pas d'écritures concurrentes en conflit. Inégalité STRICTE : avec N=3, W=1 R=1 donne 2, pas > 3 → cohérence éventuelle seulement.
Comment régler N, W, R pour du read-heavy vs du write-heavy (N=3) ?|Read-heavy et à jour : W=3, R=1 (3+1=4>3 ✅) — lecture rapide car toute réplique a la dernière écriture, mais écriture lente/fragile. Write-heavy et très dispo : W=1, R=1 (1+1=2 ≯ 3 ❌) — écriture ultra-dispo mais cohérence éventuelle. Équilibré cohérent : W=2, R=2 (majorité, tolère 1 noeud down). Le curseur CAP se règle par W et R.
Comment un store leaderless (Dynamo) répare-t-il les répliques en retard ?|Read repair : à la lecture (plusieurs répliques en parallèle), le client détecte les réponses périmées via un numéro de version et réécrit la valeur récente sur les répliques en retard. Anti-entropy : processus de fond qui compare en continu les répliques et copie ce qui manque. Sloppy quorum + hinted handoff : si une réplique cible est down, un autre noeud accepte l'écriture et garde un hint qu'il relivre au retour du noeud (dispo en écriture au prix de lectures périmées transitoires).
Partitionnement par plage vs par hash : avantage et risque de chacun ?|Par plage (range) : chaque shard détient un intervalle contigu → range scans efficaces, MAIS hotspot si les écritures se concentrent sur un intervalle (clé temporelle : tout va au dernier shard). Par hash : hash(clé) éparpille → distribution uniforme, MAIS on perd les range scans (clés voisines sur shards différents). Piège : hash(clé) % M remappe presque toutes les clés dès que M change.
Que résout le consistent hashing et à quoi servent les noeuds virtuels ?|Consistent hashing place noeuds et clés sur un anneau ; une clé va au premier noeud dans le sens horaire. À l'ajout d'un noeud, seule une fraction (~1/n) des clés migre (vs quasi tout avec hash % M) → rééquilibrage minimal. Les noeuds virtuels (100-200 points par noeud physique) lissent une distribution sinon inégale et permettent de pondérer un noeud plus puissant.
Le hash uniforme suffit-il à éliminer les hotspots ?|Non. Le hash répartit uniformément les CLÉS, pas le trafic PAR clé. Une clé unique très sollicitée (famille d'une célébrité) sature sa partition même avec un hash parfait — c'est une hot key. Parades : ajouter un salt/suffixe pour l'éclater sur plusieurs partitions, cache devant, ou split de la partition. Ciblé sur les clés chaudes identifiées par monitoring uniquement.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-10-replication-et-partitionnement/README.md`. Concevoir sur papier la stratégie de réplication + sharding de TribuZen : choisir un modèle de réplication et un mode sync/async par type de donnée, **calculer** des quorums (poser `W + R > N` et `W > N/2` pour deux besoins), et **dessiner** un consistent hash ring avec l'impact de l'ajout d'un noeud. Exercice de conception évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur.
