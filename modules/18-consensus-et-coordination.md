---
titre: Consensus & coordination
cours: 17-distributed-systems
notions: ["problème du consensus (agreement, validity, integrity, termination)", "impossibilité FLP (1985)", "modèle partiellement synchrone", "leader election", "quorum & majorité (N/2 + 1)", "Raft — décomposition en 3 sous-problèmes", "états follower / candidate / leader", "terme (term) comme horloge logique", "randomized election timeout & split vote", "RequestVote & AppendEntries (heartbeat)", "log replication & commitIndex", "election restriction (log up-to-date : lastLogTerm puis lastLogIndex)", "Log Matching Property", "Leader Completeness & State Machine Safety", "un leader ne commit directement que les entrées de son terme courant", "Paxos (survol : proposer / acceptor / learner, prepare-promise / accept-accepted)", "coordinateurs : etcd (Raft, lease, revision)", "coordinateurs : ZooKeeper (Zab, znode éphémère séquentiel, zxid)", "verrou distribué (distributed lock)", "lease (bail à TTL)", "échec du verrou naïf (GC pause / TTL expiré)", "fencing token (jeton monotone)", "split-brain (deux leaders)"]
outcomes:
  - "sait définir le problème du consensus (agreement/validity/integrity/termination) et expliquer ce que FLP interdit et comment on le contourne en pratique"
  - "sait expliquer pourquoi une décision de quorum exige une majorité stricte (N/2 + 1) et combien de pannes un cluster tolère"
  - "sait décrire Raft en profondeur : rôles, terme comme horloge logique, election restriction, log replication, commitIndex, et nommer les propriétés de sécurité (Log Matching, Leader Completeness, State Machine Safety)"
  - "sait situer Paxos par rapport à Raft en survol (rôles, deux phases) sans l'implémenter"
  - "sait utiliser etcd ou ZooKeeper comme coordinateur (leader election, config, lock) plutôt que réimplémenter le consensus"
  - "sait expliquer pourquoi un verrou distribué naïf à TTL provoque un split-brain et corriger avec un fencing token"
prerequis: ["Module 08 — retries, timeouts, idempotency (heartbeat, deadlines)", "Module 09 — cohérence & théorème CAP (C vs A sous partition)", "Module 10 — réplication & partitionnement (leader/leaderless, quorums)", "Module 11 — transactions distribuées & saga (coordinateur, atomicité)", "Module 14 — failure modes (crash, pause, partition réseau)", "Module 17 — testing distribué (injection de panne, tests de partition)"]
next: 19-temps-ordre-et-horloges
libs: []
tribuzen: "backend TribuZen — plusieurs répliques du service de rappels ; un seul leader élu doit déclencher le cron d'envoi (sinon chaque rappel part N fois), et un verrou distribué avec fencing token protège la génération du rapport budget mensuel contre le double traitement"
last-reviewed: 2026-07
---

# Consensus & coordination

> **Outcomes — tu sauras FAIRE :** définir le consensus et ce que FLP interdit, justifier le quorum majoritaire, décrire Raft en profondeur (terme, election restriction, log replication, propriétés de sécurité), situer Paxos en survol, déléguer la coordination à etcd/ZooKeeper, et corriger un verrou distribué naïf par un fencing token.
> **Difficulté :** :star::star::star::star::star:
>
> **Portée :** ce module est le niveau **mécanismes** de la mise d'accord : comment N nœuds décident **une** valeur malgré les pannes (**consensus**), comment on en tire une **élection de leader**, et comment un **verrou distribué** peut échouer silencieusement. On va **plus profond** que « il existe des outils » : **Raft** en détail (terme comme horloge logique, election restriction, log replication, `commitIndex`, propriétés de sécurité), le **quorum** et sa preuve d'unicité, le **fencing token** contre le split-brain. On **survole** Paxos (référence historique). On **ne** couvre **pas** ici : le théorème **CAP** et les modèles de cohérence → **module 09** ; les **quorums de lecture/écriture** d'une base répliquée → **module 10** ; le **coordinateur de saga / 2PC** (atomicité transactionnelle, pas consensus tolérant aux pannes) → **module 11** ; les **horloges logiques / happens-before** → **module 19 (suivant)** ; le **déploiement** d'un cluster etcd/ZooKeeper (Docker/k8s) → **cours 12-aws & 15-cicd**. Ici : l'algorithme et ses garanties exactes.

## 1. Cas concret d'abord

TribuZen a un **service de rappels** : chaque matin il envoie aux parents « la sortie Accrobranche est dans 3 jours, confirmez les présences ». Pour tenir la charge, tu le déploies en **3 répliques** derrière un load balancer. Le code du cron est trivial :

```ts
// rappels-service — CE QUI PARAÎT ÉVIDENT (et qui est FAUX en multi-réplique)
cron.schedule('0 8 * * *', async () => {           // tous les jours à 8h
  const sorties = await sortiesRepo.findWithinDays(3);
  for (const s of sorties) {
    await notifier.sendRappel(s);                  // ❌ exécuté par LES 3 répliques
  }
});
```

Le problème : à 8h00, les **trois** répliques déclenchent le cron **en même temps**. Chaque parent reçoit **trois** notifications identiques. Tu n'as aucun endroit « central » qui garantirait que **une seule** réplique fait le travail — les trois sont symétriques, elles ne se connaissent même pas.

Le réflexe naïf : « je pose un verrou dans Redis, la première qui l'attrape gagne ».

```ts
// Tentative de verrou naïf — DANGEREUX
const ok = await redis.set('lock:rappels', myId, { NX: true, PX: 60_000 }); // TTL 60s
if (!ok) return;                     // une autre réplique a le verrou → je m'abstiens
await envoyerTousLesRappels();       // ← et si CE traitement dure > 60s ? (GC pause, lenteur DB)
```

Deux bugs se cachent là. **Un :** si la réplique qui tient le verrou subit une **pause GC** de 30 s (ou une lenteur DB) pendant `envoyerTousLesRappels`, son TTL **expire**, une **autre** réplique prend le verrou et se met à envoyer — puis la première **se réveille** et continue **elle aussi** : **deux** répliques envoient en parallèle. C'est un **split-brain**, et aucune erreur n'est levée. **Deux :** ce verrou « premier arrivé » n'a **aucune** garantie de sécurité sous partition réseau — Redis peut perdre le verrou lors d'un failover.

Ce dont tu as besoin, ce n'est pas d'un `SET NX`, c'est d'un **accord** entre les répliques sur **qui est le leader**, accord qui **survit aux pannes** et n'élit **jamais deux** leaders à la fois. C'est le **problème du consensus**. Ce module te donne : ce qu'est le consensus et ce qu'il est **impossible** de garantir (**FLP**), comment **Raft** l'implémente réellement (élection + réplication de log + sécurité), pourquoi on **délègue** ça à etcd/ZooKeeper plutôt que le réécrire, et comment un **fencing token** ferme la porte au split-brain que le verrou naïf laissait ouverte.

---

## 2. Théorie complète, concise

### 2.1 Le problème du consensus

Le **consensus** : amener un ensemble de nœuds à **se mettre d'accord sur une valeur unique**, malgré des pannes. Un protocole de consensus correct garantit quatre propriétés :

- **Agreement** — deux nœuds ne décident **jamais** de valeurs différentes.
- **Validity (integrity)** — la valeur décidée a réellement été **proposée** par un nœud (pas inventée).
- **Integrity** — chaque nœud décide **au plus une fois**.
- **Termination** — tout nœud correct finit par **décider** (propriété de *liveness*, la plus fragile).

Beaucoup de problèmes distribués se **réduisent** au consensus : **élire un leader**, valider une entrée de log répliqué, décider un commit atomique, générer une séquence d'IDs ordonnée. Résous le consensus proprement une fois, tu résous tous ceux-là.

### 2.2 Ce que FLP interdit (et comment on s'en sort)

**Résultat d'impossibilité FLP** (Fischer, Lynch, Paterson, 1985) : dans un système **asynchrone** (aucune borne sur les délais réseau ni la vitesse des processus), il est **impossible** de garantir le consensus si **ne serait-ce qu'un** processus peut tomber en panne. Raison intuitive : sans borne de temps, on **ne peut pas distinguer** un nœud **crashé** d'un nœud simplement **lent** — donc aucun algorithme ne peut décider à la fois *sûrement* et *à coup sûr en temps fini*.

FLP ne dit **pas** « le consensus est impossible en pratique ». Il dit qu'aucun algorithme ne peut garantir **à la fois** la **sécurité** (agreement/validity — jamais deux décisions divergentes) **et** la **terminaison** (liveness) dans le modèle asynchrone pur. Les algorithmes réels (Raft, Paxos, Zab) s'en sortent en adoptant un modèle **partiellement synchrone** : ils gardent **toujours** la **sécurité**, et n'assurent la **terminaison** que quand le réseau se comporte « raisonnablement » (délais bornés assez longtemps). Concrètement, c'est le rôle des **timeouts** : ils tranchent le « crashé ou lent ? » au prix d'un risque d'erreur (relancer une élection pour rien), jamais au prix de la sécurité.

### 2.3 Quorum & majorité — pourquoi N/2 + 1

Le socle de tous ces algorithmes est le **quorum** : une décision n'est valide que si une **majorité stricte** des nœuds l'approuve, soit **⌊N/2⌋ + 1** sur N nœuds (3 sur 5, 2 sur 3).

Pourquoi la **majorité** et pas juste « quelques-uns » ? Parce que deux majorités d'un même ensemble **se recoupent forcément** sur au moins un nœud (*quorum intersection*). Conséquence : deux décisions concurrentes ne peuvent pas être approuvées par deux quorums disjoints — le nœud commun **refuserait** la seconde. C'est **ce recouvrement** qui garantit l'**agreement** et interdit **deux leaders** simultanés.

```
N = 5 nœuds. Quorum = 3.
  Quorum A : { n1, n2, n3 }
  Quorum B : { n3, n4, n5 }
                 ▲ n3 est dans les DEUX → il ne peut pas approuver A et B contradictoires
Tolérance aux pannes : un cluster de N tolère la panne d'une MINORITÉ ⌊(N-1)/2⌋.
  N=3 → tolère 1 panne   |   N=5 → tolère 2 pannes   |   N=7 → tolère 3 pannes
```

D'où deux règles pratiques : on dimensionne les clusters de consensus en **nombre impair** (5 tolère autant que 6 pour moins cher), et un cluster qui **perd son quorum** (3 nœuds sur 5 tombent) **cesse d'accepter des écritures** — il choisit la **cohérence** contre la **disponibilité** (lecture CAP, module 09).

### 2.4 Raft — vue d'ensemble

**Raft** (Ongaro & Ousterhout) est un algorithme de consensus **conçu pour être compréhensible**, « équivalent à Paxos en tolérance aux pannes et en performance » (raft.github.io). Il maintient un **log répliqué** : chaque nœud a une machine à états + un log de commandes, et Raft garantit que tous appliquent **la même séquence** de commandes dans **le même ordre** → mêmes états. Une fois une décision prise, « that decision is final ».

Raft **décompose** le consensus en trois sous-problèmes qu'on peut étudier séparément :

1. **Leader election** — élire un nœud coordinateur unique.
2. **Log replication** — le leader accepte les commandes des clients et les réplique.
3. **Safety** — garantir que les logs ne divergent jamais de façon incohérente.

### 2.5 Rôles, termes, et le terme comme horloge logique

Un nœud Raft est dans **un** des trois états :

```
              timeout d'élection            reçoit une MAJORITÉ de votes
  ┌──────────┐ ───────────────► ┌───────────┐ ────────────────────► ┌────────┐
  │ FOLLOWER │                   │ CANDIDATE │                        │ LEADER │
  └──────────┘ ◄─────────────── └───────────┘ ◄──────────────────── └────────┘
        ▲   découvre un leader        │  découvre un terme SUPÉRIEUR       │
        └── ou un terme supérieur ────┴────────────────────────────────────┘
   Au démarrage : tous FOLLOWER. Au plus UN leader par terme (Election Safety).
```

Le **terme (term)** est un entier **monotone croissant** partagé, qui joue le rôle d'**horloge logique** du cluster. Chaque message porte le terme de son émetteur. Règle d'or : **quand un nœud voit un terme supérieur au sien, il se met à jour et redevient follower**. C'est ce mécanisme qui détecte l'information **périmée** (un vieux leader qui revient d'une partition avec un terme dépassé est immédiatement **rétrogradé**) et synchronise la connaissance du cluster. Un terme = au plus **une** élection ; il commence par une élection et contient soit un leader unique, soit aucun (split vote → nouveau terme).

### 2.6 Leader election — votes, timeouts randomisés, split vote

Un follower qui ne reçoit **aucun heartbeat** du leader dans son **election timeout** conclut « plus de leader » et démarre une élection : il **incrémente son terme**, passe **candidate**, **vote pour lui-même**, et envoie `RequestVote` à tous. Un nœud accorde son vote si (a) le terme du candidat est ≥ au sien, (b) il n'a **pas déjà voté** pour ce terme, et (c) le log du candidat est **au moins aussi à jour** que le sien (§2.8). À la **majorité** de votes → **leader**, il émet aussitôt des heartbeats (`AppendEntries` vides) pour asseoir son autorité.

Le risque est le **split vote** : plusieurs followers deviennent candidats **en même temps**, se partagent les voix, personne n'atteint la majorité → terme perdu, on recommence. La parade est un **election timeout randomisé** (typiquement 150–300 ms tirés au hasard par nœud) : les timeouts **s'échelonnent**, un candidat démarre **avant** les autres et gagne généralement avant qu'un second ne se lance. C'est un contournement **probabiliste** de FLP : la sécurité (jamais deux leaders sur un terme) est **toujours** tenue ; seule la vitesse à converger dépend du timing.

### 2.7 Log replication — AppendEntries, commitIndex, quorum

Une fois leader, le nœud est le **seul** point d'entrée des écritures. Pour chaque commande client :

1. Il **append** l'entrée `{ term, index, command }` à **son** log (pas encore commitée).
2. Il envoie `AppendEntries` aux followers (les mêmes RPC servent de **heartbeat** quand `entries` est vide).
3. Dès que l'entrée est **répliquée sur une majorité** (leader inclus), elle est **commitée** : le leader avance son `commitIndex` et applique la commande à sa machine à états, puis informe les followers (`leaderCommit`) qui appliquent à leur tour.

```
Client ──"SET x=42"──▶ Leader (append idx=5, t=3)
                          │  AppendEntries(prevLogIndex=4, prevLogTerm=3, entries=[idx5])
              ┌───────────┼───────────┐
              ▼           ▼           ▼
          Follower     Follower     Follower
           (ACK)        (ACK)        (crash)
        2 ACK + leader = 3/5 → MAJORITÉ → commitIndex=5, on applique. (le crashé rattrapera)
```

Chaque `AppendEntries` porte `prevLogIndex`/`prevLogTerm` : le follower **n'accepte** les nouvelles entrées que si son log **coïncide** à cet endroit ; sinon il **refuse**, le leader **décrémente** `nextIndex` pour ce follower et **réessaie** plus en arrière jusqu'à trouver le point commun, puis **réécrit** la suite. Ce mécanisme répare les followers en retard ou divergents.

### 2.8 Safety — les cinq propriétés qui empêchent la divergence

Raft garantit cinq propriétés de sécurité (Figure 3 du papier Ongaro/Ousterhout). Les cinq, exactement :

- **Election Safety** — **au plus un leader** par terme.
- **Leader Append-Only** — un leader **n'écrase ni ne supprime** jamais d'entrées de son propre log ; il ne fait qu'ajouter.
- **Log Matching Property** — si deux logs contiennent une entrée de **même index ET même terme**, alors **toutes les entrées précédentes sont identiques**. (C'est ce que la vérif `prevLogIndex`/`prevLogTerm` maintient.)
- **Leader Completeness** — si une entrée est **commitée** à un terme donné, elle est présente dans le log de **tous** les leaders des termes **suivants**.
- **State Machine Safety** — si un nœud a **appliqué** une entrée à un index donné, **aucun** autre nœud n'appliquera jamais une entrée **différente** au même index.

Deux mécanismes concrets font tenir tout ça :

**Election restriction (log up-to-date).** Un votant **refuse** un candidat dont le log est **en retard**. La comparaison se fait sur la **dernière** entrée : on compare d'abord **`lastLogTerm`**, et **à égalité** le **`lastLogIndex`**. Un candidat est « au moins aussi à jour » si son `lastLogTerm` est supérieur, ou égal avec un `lastLogIndex` supérieur ou égal. Effet : **un nœud à qui il manque des entrées commitées ne peut pas être élu** → garantit Leader Completeness (le futur leader a déjà tout ce qui a été commité).

**Un leader ne commit directement que les entrées de son terme courant.** Subtilité clé (Figure 8 du papier) : un leader **ne considère pas** une entrée d'un **terme antérieur** comme commitée juste parce qu'elle est répliquée sur une majorité — une telle entrée pourrait encore être **écrasée**. Il attend qu'une entrée de **son terme courant** soit répliquée sur une majorité ; celle-ci, en étant commitée, **entraîne** indirectement le commit de tout ce qui la précède. Sans cette règle, une entrée « commitée » pourrait être perdue lors d'un changement de leader.

### 2.9 Paxos — survol

**Paxos** (Leslie Lamport, 1989/1998) est l'algorithme de consensus **historique**, celui qui a prouvé qu'on pouvait le faire. Trois rôles — **proposer**, **acceptor**, **learner** — et deux phases :

- **Phase 1 (Prepare / Promise)** — un proposer choisit un numéro `n` et demande aux acceptors de **promettre** de ne plus rien accepter sous `n` ; ils répondent en révélant la valeur déjà acceptée la plus récente.
- **Phase 2 (Accept / Accepted)** — le proposer demande d'**accepter** `(n, v)` (avec `v` = la valeur promise la plus récente, ou la sienne si aucune) ; à la **majorité** d'acceptations, la valeur est **choisie**, les learners l'apprennent.

Paxos **fonctionne** et fournit les mêmes garanties que Raft, mais il est **réputé difficile** : le papier original est notoirement obscur, **Multi-Paxos** (le consensus répété, utile en vrai) est sous-spécifié, et la gestion du leader y est **implicite**. Raft a été créé **explicitement** pour être plus compréhensible à garanties égales. **En pratique tu n'implémentes ni l'un ni l'autre** — tu utilises un coordinateur qui l'a fait pour toi (§2.10).

### 2.10 Coordinateurs prêts à l'emploi : etcd & ZooKeeper

Réimplémenter Raft en prod est une **très mauvaise idée** (le diable est dans la reprise sur crash, la compaction du log, les changements de membres). On délègue à un **coordinateur** dédié, un petit cluster qui fait tourner le consensus et t'expose des primitives simples :

- **etcd** — store clé-valeur distribué (le backing store de Kubernetes), fondé sur **Raft**. Cohérence forte. Deux primitives clés : le **lease** (bail à TTL qu'on doit renouveler ; l'expiration libère automatiquement les clés associées → parfait pour l'élection de leader et les verrous) et la **revision** (compteur global monotone incrémenté à chaque modification — utilisable **directement comme fencing token**, §2.12).
- **ZooKeeper** — service de coordination historique, protocole **Zab** (ZooKeeper Atomic Broadcast, linéarisable). Ses primitives : les **znodes éphémères** (supprimés à la fin de la session client → équivalent d'un lease lié à la connexion) et **séquentiels** (numérotés automatiquement). Le patron de verrou/élection ZooKeeper : chaque client crée un znode éphémère séquentiel sous `/lock/…` ; **celui qui a le plus petit numéro** détient le verrou (ou est leader). Le **zxid** (ZooKeeper transaction id), globalement monotone, sert de **fencing token**.

Règle : pour **élire un leader**, **partager de la config cohérente**, ou **poser un verrou distribué** entre microservices, tu **utilises** etcd/Consul/ZooKeeper — tu ne réécris pas le consensus.

### 2.11 Verrou distribué : pourquoi le naïf échoue (split-brain)

Un **verrou distribué** doit garantir l'**exclusion mutuelle** entre processus sur des machines différentes. Le verrou naïf « `SET NX` avec TTL » (le lease) échoue à cause du problème du §1 :

```
Client A ── acquiert (TTL=10s) ──[==== travaille ====]═══GC PAUSE 15s═══[écrit !!]
                                                  ▲ TTL expiré
Client B ─────────────────────────────── acquiert ─[==== travaille ====][écrit]
                                                         ▲ DEUX clients écrivent → SPLIT-BRAIN
```

Le **TTL** est un compromis inévitable : trop court → le verrou expire pendant un travail légitime ; trop long → un client vraiment crashé bloque tout le monde longtemps. **Aucun** TTL ne résout le fond, parce qu'un processus **pausé** (GC, préemption, lenteur I/O) est **indistinguable** d'un processus crashé (on retombe sur FLP). Le verrou ne peut donc pas empêcher un ancien détenteur **qui se réveille** d'écrire. Kleppmann : Redlock (verrou sur N instances Redis en majorité) **ne protège pas** contre les pauses process, les délais réseau ni les sauts d'horloge.

### 2.12 Fencing token — fermer la porte au split-brain

La parade correcte n'est **pas** un meilleur verrou, c'est un **fencing token** : un **entier monotone croissant** délivré à **chaque** acquisition du verrou, et **vérifié par le stockage protégé**. La ressource **refuse** toute écriture portant un token **inférieur** au plus grand déjà vu.

```
Client A acquiert → token=33 ── GC PAUSE ─────────────── écrit(token=33) → REJETÉ (33 < 34)
Client B acquiert → token=34 ─────────── écrit(token=34) → ACCEPTÉ
Stockage : last_token = 34. Toute écriture < 34 est refusée.
```

Ainsi, même si A **se réveille** en croyant tenir encore le verrou, son écriture est **rejetée** : le split-brain devient **inoffensif** (les deux peuvent croire détenir le verrou, mais **un seul** peut écrire). Le token n'est pas à inventer : avec **etcd** c'est la **revision**, avec **ZooKeeper** le **zxid** — tous deux monotones par construction. C'est la seule façon **sûre** d'utiliser un verrou distribué pour protéger une ressource : verrou **pour la performance** (éviter le travail concurrent le plus souvent) **+** fencing token **pour la correction** (garantir qu'au pire, un seul écrit).

---

## 3. Worked examples

### Exemple 1 — Une élection Raft pas à pas (le cluster de rappels TribuZen)

But : suivre une élection sur **5 répliques** du service de rappels (`n1…n5`), comprendre terme, votes, majorité et election restriction.

**État initial.** Tous followers, `currentTerm = 4`, un leader `n1` (terme 4) envoyait des heartbeats. `n1` **crashe** à 8h00.

```
t0  n1 (leader, t=4) crash. Plus de heartbeat.
t1  n3 atteint son election timeout EN PREMIER (timeouts randomisés).
    n3 : currentTerm 4→5, role=candidate, voteFor=n3, envoie RequestVote(t=5) à tous.
t2  n2, n4, n5 reçoivent RequestVote(t=5) :
      - t=5 > leur terme 4 → ils se mettent à t=5, redeviennent followers.
      - ils n'ont pas encore voté au terme 5.
      - election restriction : le log de n3 est-il aussi à jour que le leur ?
        n3.lastLogTerm=4, lastLogIndex=12 ; les leurs aussi (ils étaient à jour) → OK.
      → chacun accorde son vote.
t3  n3 a { n3, n2, n4 } = 3 votes = MAJORITÉ (3 sur 5). n3 devient LEADER du terme 5.
    n3 émet aussitôt des AppendEntries vides (heartbeats) → n2,n4,n5 restent followers.
t4  n1 redémarre, revient en follower avec currentTerm=4. Il reçoit un heartbeat t=5 :
    5 > 4 → il adopte t=5 et reste FOLLOWER. L'ancien leader ne peut pas régner à nouveau.
```

**Ce qu'on lit :** un **seul** leader par terme (Election Safety, garanti par la majorité) ; le terme tranche l'autorité (l'ancien leader est rétrogradé sans conflit) ; l'election restriction empêcherait un `n5` en retard d'être élu. Côté TribuZen : **seul** le leader du terme courant lance le cron d'envoi → un rappel, une fois.

### Exemple 2 — Le verrou du rapport budget : du naïf au fencing token

But : protéger la **génération du rapport budget mensuel** (job lourd, une seule exécution voulue) contre le double traitement.

**Le bug (verrou naïf, split-brain).**

```
t0  worker-A : lease etcd "lock:rapport", TTL 30s → acquis. Démarre le calcul.
t1  worker-A : GC pause de 40s (gros dataset). Le lease etcd EXPIRE à t=30s.
t2  worker-B : lease "lock:rapport" → acquis (libre). Génère et ÉCRIT rapport-2026-06.
t3  worker-A se réveille (t=42s), croit tenir le verrou, ÉCRIT rapport-2026-06 lui aussi.
    → deux écritures concurrentes, la seconde écrase la première. Rapport potentiellement corrompu.
```

**La correction (fencing token = revision etcd).** On récupère la **revision** de la clé de lease à l'acquisition, on la passe comme token, et le **stockage du rapport** rejette tout token périmé.

```ts
// acquire — le token EST la revision etcd de la clé de lock (monotone par construction)
async function acquireLock(key: string, ttlSec: number): Promise<{ token: bigint } | null> {
  const lease = await etcd.lease(ttlSec);                 // bail à TTL
  const put = await etcd.if(key, 'Create', '==', 0)      // acquiert seulement si libre
    .then(etcd.put(key).value(myId).lease(lease)).commit();
  if (!put.succeeded) return null;                        // déjà tenu
  const meta = await etcd.get(key).exec();               // relit pour obtenir la revision
  return { token: meta.kvs[0].mod_revision };            // ← fencing token monotone
}

// write protégé — REFUSE toute écriture dont le token est < au plus grand déjà vu
async function writeRapport(mois: string, data: Buffer, token: bigint): Promise<boolean> {
  const last = await tokenStore.get(mois);               // dernier token accepté pour ce mois
  if (last !== null && token < last) {
    logger.warn(`écriture rejetée: token ${token} < ${last} (détenteur périmé)`);
    return false;                                        // ← A réveillé après B : REJETÉ
  }
  await tokenStore.set(mois, token);                     // avance le plus grand token vu
  await rapportStore.put(`rapport-${mois}`, data);       // écriture réellement appliquée
  return true;
}
```

**Pourquoi c'est correct :** B acquiert **après** A, donc sa revision est **strictement supérieure** (`token_B > token_A`). Quand A se réveille et tente d'écrire avec `token_A`, le `writeRapport` voit `token_A < token_B` déjà enregistré → **rejet**. Le split-brain **existe** (les deux ont cru tenir le verrou), mais il est **neutralisé** : **une seule** écriture passe. Le verrou seul est une **optimisation** (éviter le double calcul la plupart du temps) ; le fencing token est la **garantie de correction**.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Croire qu'un `SET NX` avec TTL suffit à un verrou distribué

Le lease empêche le cas simple, **pas** le split-brain. Un détenteur **pausé** (GC, préemption) voit son TTL **expirer**, un autre prend le verrou, puis le premier **se réveille et écrit** : deux écrivains. Un TTL ne résout **jamais** ça (FLP : lent = crashé, indiscernable). Il faut un **fencing token** vérifié par la ressource.

### PIÈGE #2 — « FLP prouve que le consensus est impossible »

Non. FLP dit qu'aucun algorithme ne peut garantir **à la fois** sécurité **et** terminaison en asynchrone **pur**. Raft/Paxos gardent **toujours** la sécurité et n'assurent la terminaison que sous **synchronie partielle** (via timeouts). En pratique le consensus **marche** — il « bloque » juste temporairement quand le réseau déraille, il ne se **trompe** pas.

### PIÈGE #3 — Confondre quorum et « quelques nœuds »

Le quorum doit être une **majorité stricte** (⌊N/2⌋+1) précisément pour que **deux quorums se recoupent**. Un « quorum » de N/2 sans le +1 permettrait deux groupes disjoints d'approuver deux décisions contradictoires → deux leaders. Le +1 **est** la garantie d'agreement.

### PIÈGE #4 — Croire qu'une entrée répliquée sur une majorité est toujours commitée

Faux pour une entrée d'un **terme antérieur**. Raft (Figure 8) : un leader **ne commit directement** que les entrées de **son terme courant** ; une vieille entrée pourtant majoritaire peut encore être **écrasée**. Elle n'est réputée commitée qu'**une fois entraînée** par le commit d'une entrée du terme courant. Ignorer ça = croire durable une entrée qui disparaîtra au prochain changement de leader.

### PIÈGE #5 — Comparer les logs sur l'index seul dans l'election restriction

L'« au moins aussi à jour » compare **`lastLogTerm` d'abord**, **puis** `lastLogIndex` à égalité de terme — **pas** l'index seul. Un log plus **long** mais d'un **terme plus ancien** est **moins** à jour qu'un log plus court d'un terme récent. Se tromper d'ordre casse la Leader Completeness (on pourrait élire un nœud à qui manquent des entrées commitées).

### PIÈGE #6 — Vouloir implémenter Raft/Paxos soi-même en prod

Le pseudo-code tient sur une page ; la version **prod** (reprise sur crash, compaction/snapshot du log, changement de membres, tests de partition) est un gouffre. **Utilise etcd/ZooKeeper/Consul.** Réimplémenter le consensus est un projet d'apprentissage (le lab), pas une décision d'architecture.

### PIÈGE #7 — Prendre le 2PC pour du consensus tolérant aux pannes

Le **2PC** (module 11) atteint l'atomicité mais **bloque** si le coordinateur crashe (SPOF, pas de quorum). Le **consensus** (Raft) est **tolérant aux pannes** : il continue tant qu'une **majorité** survit, sans point unique. Ne pas confondre « coordinateur de commit » (2PC) et « algorithme de consensus » (Raft) — le second est ce qui rend un coordinateur **hautement disponible**.

---

## 5. Ancrage TribuZen

TribuZen tourne en **plusieurs répliques** ; dès qu'une tâche doit s'exécuter **une seule fois**, il faut coordonner.

**Élection de leader pour le service de rappels (le cas du §1).** Les 3 répliques utilisent **etcd** : chacune tente de poser une clé `leader/rappels` avec un **lease** (TTL 15 s) qu'elle **renouvelle** tant qu'elle vit. La première qui l'obtient est **leader** et **seule** à déclencher le cron ; si elle crashe, son lease **expire**, une autre prend le relais. Consensus délégué, zéro Raft maison.

```
etcd  leader/rappels ── lease 15s ──▶ réplique-2 (LEADER) ── renouvelle ──▶ …
      réplique-1, réplique-3 : watchent la clé, restent en veille (followers applicatifs)
      réplique-2 crash → lease expire → réplique-1 acquiert → devient leader → cron continue
```

**Verrou + fencing token pour le rapport budget mensuel (worked example 2).** Job lourd, une seule exécution. Verrou etcd **pour** éviter le double calcul, **revision comme fencing token** pour que, même en cas de pause GC + split-brain, **une seule** écriture du rapport soit acceptée.

Décisions concrètes pour TribuZen :

- **Coordinateur = etcd** (déjà présent si on tourne sur Kubernetes) ; on n'écrit pas de consensus.
- **Leader election par lease** pour tout singleton (cron rappels, réconciliation nocturne, purge).
- **Fencing token systématique** dès qu'un verrou protège une **écriture** (rapport, export comptable) — le verrou seul ne suffit **jamais**.
- **Cluster impair** (3 ou 5 nœuds etcd) et conscience qu'une **perte de quorum** rend etcd **indisponible en écriture** (choix C sur A) — les rappels attendront, ils ne partiront pas en double.

> **Défère :** le **théorème CAP** et les modèles de cohérence forte/éventuelle → **module 09** ; les **quorums R/W** d'une base répliquée → **module 10** ; le **coordinateur de saga / 2PC** → **module 11** ; les **horloges logiques** (Lamport, vector clocks) qui formalisent le « happens-before » derrière les termes → **module 19 (suivant)** ; le **déploiement** d'un cluster etcd/ZooKeeper (Docker/k8s) → **cours 12-aws & 15-cicd**. Ici on a posé **l'algorithme de consensus et ses garanties**.

---

## 6. Points clés

1. **Consensus** = mettre N nœuds d'accord sur **une** valeur malgré les pannes ; propriétés : **agreement, validity, integrity, termination**. Élection de leader, log répliqué, commit atomique s'y **réduisent**.
2. **FLP (1985)** : impossible de garantir **sécurité ET terminaison** en asynchrone pur si un nœud peut crasher. Les algos réels gardent **toujours** la sécurité et n'assurent la terminaison qu'en **synchronie partielle** (timeouts).
3. **Quorum = majorité stricte (⌊N/2⌋+1)** : deux majorités **se recoupent** → agreement garanti, jamais deux leaders. Un cluster de N tolère la panne d'une **minorité** ; on le dimensionne **impair**.
4. **Raft** décompose le consensus en **élection**, **réplication de log**, **sécurité**. Un **log répliqué** = mêmes commandes, même ordre, mêmes états.
5. **Terme = horloge logique** monotone ; voir un terme supérieur → **redevenir follower**. **Au plus un leader par terme**.
6. **Élection** : timeout → candidate, +1 terme, vote pour soi, `RequestVote` ; **majorité** → leader. **Timeouts randomisés** contre le **split vote**.
7. **Réplication** : le leader append, `AppendEntries` (heartbeat si vide), **commit à la majorité** (`commitIndex`) ; `prevLogIndex/Term` répare les followers.
8. **Sécurité (5 propriétés)** : Election Safety, Leader Append-Only, **Log Matching**, **Leader Completeness**, **State Machine Safety**. Tenues par l'**election restriction** (`lastLogTerm` puis `lastLogIndex`) et la règle « **un leader ne commit directement que les entrées de son terme courant** ».
9. **Paxos** (survol) : proposer/acceptor/learner, prepare-promise / accept-accepted ; correct mais obscur → Raft, plus compréhensible, à garanties égales. **On n'implémente ni l'un ni l'autre en prod.**
10. **Coordinateurs** : **etcd** (Raft, **lease** + **revision**) et **ZooKeeper** (Zab, **znode éphémère séquentiel** + **zxid**) — leader election, config, locks prêts à l'emploi.
11. **Verrou distribué naïf → split-brain** (pause GC + TTL expiré = deux écrivains). **Fencing token** (revision/zxid) vérifié par la ressource = la seule garantie de correction ; verrou pour la perf, token pour la sûreté.

---

## 7. Seeds Anki

```
Qu'est-ce que le problème du consensus et quelles propriétés doit-il garantir ?|Amener N nœuds à se mettre d'accord sur une valeur unique malgré les pannes. Propriétés : agreement (jamais deux valeurs décidées différentes), validity/integrity (la valeur décidée a été proposée), integrity (chaque nœud décide au plus une fois), termination (tout nœud correct finit par décider). L'élection de leader, le log répliqué et le commit atomique s'y réduisent.
Qu'affirme le résultat d'impossibilité FLP (1985) et comment le contourne-t-on ?|En système asynchrone pur (délais non bornés), il est impossible de garantir À LA FOIS la sécurité (agreement) ET la terminaison si ne serait-ce qu'un nœud peut crasher, car on ne peut pas distinguer un nœud lent d'un nœud crashé. Contournement : modèle partiellement synchrone. Raft/Paxos gardent TOUJOURS la sécurité et n'assurent la terminaison que quand le réseau est raisonnable (via timeouts).
Pourquoi un quorum de consensus exige-t-il une majorité stricte (N/2 + 1) ?|Parce que deux majorités du même ensemble se recoupent forcément sur au moins un nœud (quorum intersection). Ce nœud commun refuse d'approuver deux décisions contradictoires → agreement garanti, jamais deux leaders. Un cluster de N tolère la panne d'une minorité ⌊(N-1)/2⌋ : N=3 tolère 1, N=5 tolère 2. On dimensionne en nombre impair.
Comment fonctionne l'élection de leader dans Raft (terme, votes, split vote) ?|Un follower sans heartbeat atteint son election timeout : il incrémente son terme, passe candidate, vote pour lui-même, envoie RequestVote. On accorde le vote si le terme est ≥, qu'on n'a pas déjà voté ce terme, et si le log du candidat est au moins aussi à jour. Majorité → leader, il émet des heartbeats. Le terme est une horloge logique : voir un terme supérieur → redevenir follower. Timeouts randomisés (ex. 150-300ms) contre le split vote.
Comment Raft réplique et commit une entrée de log ?|Le leader append l'entrée à son log, envoie AppendEntries aux followers (heartbeat si entries vide). Dès que l'entrée est répliquée sur une MAJORITÉ (leader inclus), elle est commitée : il avance commitIndex, applique à sa machine à états, informe les followers via leaderCommit. prevLogIndex/prevLogTerm : le follower refuse si son log ne coïncide pas, le leader décrémente nextIndex et réessaie plus en arrière.
Quelles sont les cinq propriétés de sécurité de Raft ?|Election Safety (au plus un leader par terme) ; Leader Append-Only (un leader n'écrase ni ne supprime, il ajoute) ; Log Matching (même index + même terme → toutes les entrées précédentes identiques) ; Leader Completeness (une entrée commitée est présente dans tous les leaders des termes suivants) ; State Machine Safety (deux nœuds n'appliquent jamais des entrées différentes au même index).
En quoi consiste l'election restriction de Raft et comment compare-t-on deux logs ?|Un votant refuse un candidat dont le log est en retard, ce qui garantit que le leader élu possède toutes les entrées commitées (Leader Completeness). On compare la dernière entrée : d'abord lastLogTerm, puis à égalité lastLogIndex. Un candidat est "au moins aussi à jour" si son lastLogTerm est supérieur, ou égal avec un lastLogIndex ≥. Un log plus long mais de terme plus ancien est MOINS à jour.
Pourquoi un leader Raft ne commit-il directement que les entrées de son terme courant ?|Parce qu'une entrée d'un terme ANTÉRIEUR, même répliquée sur une majorité, pourrait encore être écrasée (Figure 8 du papier). Le leader attend qu'une entrée de son terme courant soit répliquée sur une majorité ; en la commitant, il entraîne indirectement le commit de tout ce qui précède. Sans cette règle, une entrée "commitée" pourrait être perdue lors d'un changement de leader.
Pourquoi un verrou distribué naïf à TTL provoque-t-il un split-brain ?|Un détenteur pausé (GC, préemption, lenteur I/O) voit son TTL expirer ; un autre client acquiert le verrou et travaille ; puis le premier se réveille en croyant toujours le tenir et écrit lui aussi → deux écrivains. Aucun TTL ne résout ça car un processus lent est indistinguable d'un crashé (FLP). Redlock ne protège pas non plus contre les pauses/délais/sauts d'horloge (Kleppmann).
Qu'est-ce qu'un fencing token et comment ferme-t-il le split-brain ?|Un entier monotone croissant délivré à chaque acquisition du verrou et VÉRIFIÉ par la ressource : toute écriture portant un token inférieur au plus grand déjà vu est rejetée. Même si un ancien détenteur se réveille, son écriture (vieux token) est refusée → un seul écrivain effectif. Sources naturelles : la revision d'etcd, le zxid de ZooKeeper. Verrou pour la perf, fencing token pour la correction.
Que fournissent etcd et ZooKeeper comme coordinateurs ?|etcd : store clé-valeur sur Raft (backing store de Kubernetes), avec lease (bail à TTL pour élection/verrou) et revision (compteur monotone = fencing token). ZooKeeper : coordination sur protocole Zab, avec znodes éphémères (liés à la session = lease) et séquentiels (le plus petit numéro détient le verrou), et zxid comme fencing token. On les UTILISE plutôt que de réimplémenter le consensus.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-18-consensus-et-coordination/README.md`. Implémenter, en TypeScript avec un vrai cluster **etcd** (docker-compose fourni), une **élection de leader** par lease pour le service de rappels TribuZen (une seule réplique déclenche le cron), puis un **verrou distribué + fencing token** (revision etcd) protégeant la génération du rapport budget. Provoquer un **split-brain** (simuler une pause GC / lease expiré) pour voir la seconde écriture **rejetée** par le fencing. Exercice évalué par grille + coach, avec variante J+30 — zéro harnais auto-correcteur.
