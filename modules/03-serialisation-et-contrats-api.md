---
titre: Sérialisation & contrats d'API (JSON, Protobuf, Avro, évolution de schéma)
cours: 17-distributed-systems
notions: ["sérialisation / désérialisation", "JSON (texte)", "Protobuf (binaire, field numbers)", "Avro (schéma reader/writer)", "MessagePack", "schéma de contrat", "évolution de schéma", "compatibilité backward", "compatibilité forward", "compatibilité full", "versioning de contrat", "schema registry (survol)", "contract-first"]
outcomes:
  - sait comparer JSON, Protobuf, Avro et MessagePack sur taille, schéma, vitesse et évolutivité
  - sait distinguer un changement backward-compatible d'un changement forward-compatible et d'un breaking change
  - sait faire évoluer un schéma Protobuf et un JSON Schema sans casser les consommateurs déployés
  - sait expliquer le rôle d'un schema registry et le principe contract-first
prerequis:
  - "modules 00-02 du cours 17 (fallacies du distribué, communication réseau, découpage en microservices)"
next: 04-communication-synchrone
libs: []
tribuzen: "backbone TribuZen — le contrat d'API entre le service Family et le service Notifications, et son évolution sans coupure"
last-reviewed: 2026-07
---

# Sérialisation & contrats d'API

> **Outcomes — tu sauras FAIRE :** comparer JSON / Protobuf / Avro / MessagePack, classer un changement de schéma en backward / forward / breaking, faire évoluer un contrat Protobuf et un JSON Schema sans casser les consommateurs déployés, expliquer un schema registry et l'approche contract-first.
> **Difficulté :** :star::star::star:
>
> **Portée :** ici on regarde le **format sur le fil** et les **règles d'évolution de contrat** entre services. Le transport (REST vs gRPC, streaming, deadlines) est le **module 04**. La *décision d'architecture* « quel style de communication choisir » relève du **cours 13-architecture** — ici on reste au niveau mécanisme et garanties.

## 1. Cas concret d'abord

TribuZen est découpé en services (module 02). Le service **Family** publie un événement quand un membre rejoint une famille. Le service **Notifications** le consomme pour envoyer un mail de bienvenue. Le contrat, aujourd'hui, c'est ce message :

```jsonc
// Événement "member.joined" — version 1, telle qu'émise par Family
{
  "familyId": "fam_8a3",
  "memberId": "mem_41",
  "displayName": "Alice",
  "joinedAt": "2026-07-06T10:30:00Z"
}
```

Notifications lit `displayName` et `joinedAt` pour composer le mail. Tout marche.

**Sprint suivant**, l'équipe Family veut :
1. renommer `displayName` en `name` (cohérence avec le reste du domaine) ;
2. ajouter `locale` pour envoyer le mail dans la bonne langue ;
3. supprimer `joinedAt` qui n'était finalement pas fiable.

Le piège du distribué : **Family et Notifications ne se déploient pas en même temps.** Pendant plusieurs heures, un Family v2 émet des messages qu'un Notifications v1 (encore déployé) doit lire — et l'inverse pendant le rollback. Chacun des trois changements ci-dessus n'a pas le même risque :

- ajouter `locale` → un vieux consommateur l'ignore : **sans danger** ;
- renommer `displayName` → un vieux consommateur cherche `displayName`, trouve `undefined`, envoie un mail « Bonjour  » : **cassé** ;
- supprimer `joinedAt` → dépend de qui en a besoin et quand.

Ce module te donne le vocabulaire (backward / forward compatible) et les règles précises pour savoir, **avant** de merger, si ton changement va casser la production. Et le format que tu choisis (JSON libre vs Protobuf vs Avro) change radicalement la facilité — ou l'impossibilité — de ces vérifications.

---

## 2. Théorie complète, concise

### 2.1 Sérialisation : le problème de base

Un objet en mémoire (une struct TS) n'existe que dans un processus. Pour l'envoyer à un autre service, il faut le **sérialiser** en octets, le transmettre, puis le **désérialiser** de l'autre côté. Le format de ces octets *est* le contrat : les deux services doivent être d'accord sur son interprétation, sinon corruption ou erreur silencieuse.

Trois familles de formats :
- **texte auto-descriptif** : JSON, XML, YAML. Les noms de champs voyagent avec les données.
- **binaire à schéma** : Protobuf, Avro, Thrift. Un schéma externe décrit la structure ; le fil ne porte (presque) pas les noms.
- **binaire compact sans schéma** : MessagePack, CBOR, BSON. « JSON binaire » — même modèle de données que JSON, encodage plus dense.

### 2.2 JSON — l'universel texte

Natif en JS (`JSON.stringify` / `JSON.parse`), lisible, supporté partout. C'est le défaut pour les API REST publiques. Ses limites en distribué :

```ts
// Piège 1 — pas de type Date : JSON.stringify le rend en string ISO
JSON.parse(JSON.stringify({ at: new Date() })).at // → string, pas Date

// Piège 2 — les entiers > 2^53 perdent en précision
JSON.parse('{"id": 9007199254740993}') // → { id: 9007199254740992 }
// parade : transporter les grands IDs en string

// Piège 3 — undefined disparaît silencieusement
JSON.stringify({ a: 1, b: undefined }) // → '{"a":1}'

// Piège 4 — AUCUN schéma : le message reçu peut être n'importe quoi
```

Le piège 4 est le fond du problème : JSON seul ne dit pas quelle *forme* est attendue. D'où le besoin d'ajouter un schéma **par-dessus** JSON (JSON Schema, ou une lib de validation runtime comme Zod côté TS) pour transformer « du JSON » en « un contrat ».

### 2.3 Protobuf — binaire à field numbers

Protocol Buffers (Google) : on écrit un schéma `.proto`, un compilateur génère le code, le fil est binaire et compact. Point central pour l'évolution : **chaque champ a un numéro**, et c'est le *numéro* — pas le nom — qui est encodé sur le fil.

```protobuf
syntax = "proto3";

message MemberJoined {
  string family_id = 1;   // le "= 1" est le field number, encodé sur le fil
  string member_id = 2;
  string display_name = 3;
  string joined_at = 4;   // RFC3339
}
```

Conséquences (règles officielles proto3, vérifiées) :
- **« Adding new fields is safe. »** Un nouveau champ = un nouveau numéro ; un vieux lecteur ne le connaît pas, le range dans les *unknown fields* et le préserve.
- **« Removing fields is safe »**, MAIS **« you must reserve the deleted field number »**. Un numéro supprimé ne doit **jamais** être réutilisé pour un autre champ.
- **« Field numbers should never be reused. »** Réutiliser un numéro rend le décodage ambigu (corruption, fuite de données).
- **« Changing field numbers for any existing field is not safe. »**
- **« Adding additional values to an enum is safe. »**
- En proto3, un champ scalaire à présence implicite ne distingue pas « absent » de « valeur par défaut » (`0`, `""`, `false`). Pour ce message, désérialiser un champ absent donne la valeur par défaut, pas une erreur.

Le renommage n'est PAS dans la liste des dangers : renommer `display_name` en `name` **en gardant le numéro `3`** ne change pas le fil (le nom n'est pas encodé). C'est un avantage majeur de Protobuf sur JSON.

```protobuf
// Évolution correcte : renommer champ 3, ajouter locale (5), retirer joined_at (4)
message MemberJoined {
  string family_id = 1;
  string member_id = 2;
  string name = 3;          // renommé — numéro 3 conservé → compatible
  reserved 4;               // joined_at supprimé — on GÈLE le numéro 4
  reserved "joined_at";     // et le nom, pour éviter toute réintroduction
  string locale = 5;        // nouveau champ, nouveau numéro → sûr
}
```

### 2.4 Avro — binaire à schéma reader/writer

Avro (Apache, écosystème Kafka/Hadoop) pousse la logique plus loin : la donnée est écrite avec le **schéma du writer**, lue avec le **schéma du reader**, et Avro fait la *résolution de schéma* entre les deux. La clé, ce sont les **valeurs par défaut**. Règles officielles (vérifiées) :

- si le schéma **reader** a un champ **avec default** absent chez le writer → le reader **utilise sa valeur par défaut** ;
- si le **writer** a un champ absent chez le reader → cette valeur est **ignorée** ;
- si le reader a un champ **sans default** absent chez le writer → **erreur**.

D'où, en une phrase : **ajouter/retirer un champ n'est safe en Avro que si ce champ a une valeur par défaut.** Avro supporte aussi les **aliases** pour mapper un ancien nom de champ vers un nouveau (renommage compatible).

```json
{
  "type": "record",
  "name": "MemberJoined",
  "fields": [
    { "name": "familyId", "type": "string" },
    { "name": "memberId", "type": "string" },
    { "name": "name", "type": "string", "aliases": ["displayName"] },
    { "name": "locale", "type": "string", "default": "fr-FR" }
  ]
}
```

### 2.5 MessagePack — JSON binaire, sans schéma

Même modèle de données que JSON (objets, tableaux, primitives), encodage binaire plus dense et plus rapide à parser. **Pas de schéma** → mêmes garanties d'évolution que JSON (c'est-à-dire aucune garantie automatique : à toi de valider). Utile quand tu veux la souplesse de JSON mais moins d'octets (mobile, IoT, cache), sans vouloir la lourdeur d'un compilateur de schéma.

### 2.6 Comparaison

| Critère | JSON | Protobuf | Avro | MessagePack |
|---|---|---|---|---|
| Encodage | Texte | Binaire | Binaire | Binaire |
| Lisible à l'œil | Oui | Non | Non | Non |
| Schéma | Optionnel (externe) | Obligatoire (`.proto`) | Obligatoire (JSON) | Aucun |
| Taille relative | Grosse | Petite | Petite | Moyenne |
| Clé d'évolution | discipline manuelle | field numbers + `reserved` | defaults + aliases | discipline manuelle |
| Écosystème JS | Natif | via lib générée | via lib | via lib |
| Débuggable réseau | Facile | Difficile | Difficile | Difficile |

Règle de tête : **API publique → JSON** (lisible, universel) ; **communication interne haut débit / event streaming → Protobuf ou Avro** (compact + règles d'évolution mécaniques).

### 2.7 Les trois compatibilités — le cœur du module

Un contrat évolue en versions successives. Trois propriétés décrivent qui peut lire quoi. Définitions alignées sur celles d'un schema registry (vérifiées) :

- **Backward compatible** : « un consommateur avec le **nouveau** schéma peut lire les données produites avec l'**ancien** ». Le *reader* est à jour, le *writer* est en retard. Changements permis typiques : **retirer un champ**, **ajouter un champ optionnel / avec default**.
- **Forward compatible** : « les données produites avec le **nouveau** schéma peuvent être lues par un consommateur avec l'**ancien** ». Le *writer* est à jour, le *reader* est en retard. Changements permis typiques : **ajouter un champ**, **retirer un champ optionnel**.
- **Full compatible** : backward **et** forward. En pratique : n'ajouter/retirer que des champs **ayant une valeur par défaut**.

Direction concrète du déploiement :
- tu déploies **les consommateurs d'abord** → tu as besoin de **backward** (nouveaux readers, vieux writers encore là) ;
- tu déploies **les producteurs d'abord** → tu as besoin de **forward** (nouveaux writers, vieux readers encore là) ;
- tu ne contrôles pas l'ordre / rollback possible → vise **full**.

C'est exactement le dilemme du §1 : comme Family et Notifications se déploient dans un ordre incertain avec rollback possible, le contrat doit rester **full compatible** à chaque étape.

### 2.8 Versioning de contrat

Deux stratégies, non exclusives :

1. **Versioning explicite** — on numérote le contrat (`/v1/`, `/v2/`, ou un `schemaVersion` dans le message). Rupture assumée : v2 peut casser v1, on fait tourner les deux en parallèle le temps de la migration. Simple à raisonner, coûteux à maintenir (N versions vivantes).
2. **Évolution implicite (expand/contract)** — une seule version « vivante », qu'on fait évoluer uniquement par changements compatibles. Migration en deux temps :
   - *expand* : ajouter le nouveau champ (optionnel), écrire les deux (`name` **et** `display_name`) ;
   - *contract* : une fois tous les consommateurs migrés vers `name`, retirer `display_name`.

L'expand/contract est le pattern par défaut en microservices : jamais de breaking change, jamais de coupure. Le versioning explicite est réservé aux vraies ruptures inévitables.

### 2.9 Schema registry (survol) & contract-first

Un **schema registry** (ex. Confluent Schema Registry pour Kafka) est un service central qui stocke les schémas, leur attribue des versions, et **refuse d'enregistrer un schéma incompatible** selon un mode configuré : `BACKWARD`, `FORWARD`, `FULL` (et leurs variantes `_TRANSITIVE` qui vérifient contre *toutes* les versions passées, pas seulement la précédente). Le producteur enregistre son schéma, ne poste sur le fil qu'un petit **id de schéma**, et le consommateur va chercher le schéma correspondant. Bénéfice : la compatibilité devient une **règle de build** appliquée par un tiers, pas une revue humaine faillible.

**Contract-first** : on écrit le **contrat d'abord** (`.proto`, JSON Schema, OpenAPI), on le partage/valide entre équipes, puis on génère le code producteur et consommateur à partir de lui. L'inverse — *code-first*, où le contrat est déduit de l'implémentation — fait dériver les services silencieusement. En distribué inter-équipes, contract-first est la posture par défaut : le contrat est l'artefact source, versionné, revu.

---

## 3. Worked examples

### Exemple 1 — Classer chaque changement du §1

Reprenons les trois changements demandés, sur le contrat JSON de `member.joined`, en supposant un déploiement d'ordre incertain (donc objectif : **full compatible**).

| Changement | backward ? | forward ? | Verdict |
|---|---|---|---|
| Ajouter `locale` (optionnel, default `"fr-FR"`) | oui (vieux writer sans `locale` → reader met le default) | oui (vieux reader ignore `locale`) | **full — safe** |
| Renommer `displayName` → `name` | non (vieux writer envoie `displayName`, nouveau reader lit `name` → vide) | non | **breaking** |
| Supprimer `joinedAt` | oui (nouveau reader n'en a plus besoin) | non si un vieux reader le lit encore | **backward only** |

Décision : `locale` passe direct. Le renommage se fait en **expand/contract** (voir Exemple 2). La suppression de `joinedAt` attend que **plus aucun** consommateur ne le lise, sinon on casse forward.

### Exemple 2 — Renommer sans casser : expand/contract sur JSON Schema

But : passer de `displayName` à `name` sans jamais de fenêtre cassée.

```jsonc
// ÉTAPE 0 — contrat v1
{ "displayName": "Alice" }

// ÉTAPE 1 (expand) — le producteur écrit LES DEUX champs.
// Schéma : les deux présents, aucun requis nouveau → full compatible.
{ "displayName": "Alice", "name": "Alice" }
// Vieux consommateur lit displayName ✔  Nouveau consommateur lit name ✔

// ÉTAPE 2 — migrer tous les consommateurs pour lire `name`
//           (avec fallback `name ?? displayName` pendant la transition).

// ÉTAPE 3 (contract) — une fois TOUS les consommateurs sur `name`,
//           le producteur cesse d'écrire displayName.
{ "name": "Alice" }
```

Le JSON Schema associé, à l'étape 1, ne rend `name` ni `displayName` obligatoire — c'est ce qui garde la fenêtre compatible :

```json
{
  "type": "object",
  "properties": {
    "familyId":   { "type": "string" },
    "memberId":   { "type": "string" },
    "displayName":{ "type": "string" },
    "name":       { "type": "string" },
    "locale":     { "type": "string", "default": "fr-FR" }
  },
  "required": ["familyId", "memberId"]
}
```

En Protobuf, le même renommage est plus simple encore : on renomme le champ **en gardant son field number** (§2.3) — le fil ne bouge pas, aucune étape expand/contract nécessaire pour un simple renommage.

### Exemple 3 — Faire évoluer le `.proto` proprement

Sur le schéma proto3 du §2.3, appliquons les trois changements :

```protobuf
// AVANT
message MemberJoined {
  string family_id = 1;
  string member_id = 2;
  string display_name = 3;
  string joined_at = 4;
}

// APRÈS
message MemberJoined {
  string family_id = 1;
  string member_id = 2;
  string name = 3;         // renommé, numéro 3 gardé → wire-compatible
  reserved 4, "joined_at"; // supprimé : numéro ET nom gelés à jamais
  string locale = 5;       // ajouté, nouveau numéro → safe
}
```

Pourquoi `reserved` est non négociable : sans lui, un collègue pourrait plus tard écrire `bool joined_at = 4;` (un booléen sur le numéro 4). Un vieux message portant une *string* sur le champ 4 serait alors décodé comme un booléen → corruption silencieuse. `reserved 4` fait échouer la compilation si quelqu'un tente de réutiliser le numéro.

---

## 4. Pièges & misconceptions

### PIÈGE #1 — Confondre backward et forward
La direction se raisonne toujours **du point de vue du reader avec le nouveau schéma**. *Backward* = le nouveau code lit les vieilles données (je déploie les consommateurs en premier). *Forward* = le vieux code lit les nouvelles données (je déploie les producteurs en premier). Astuce : « **back**ward = je regarde en arrière vers les vieilles données ».

### PIÈGE #2 — Croire qu'ajouter un champ est toujours sûr
Ajouter un champ **optionnel / avec default** est sûr. Ajouter un champ **requis** casse la compatibilité : un vieux writer ne l'émet pas, et un nouveau reader qui l'exige (JSON Schema `required`, ou champ Avro sans default) lève une erreur. « Nouveau champ = optionnel » est la règle de survie.

### PIÈGE #3 — Réutiliser un field number Protobuf
Le pire bug silencieux de Protobuf. Le nom de champ ne voyage pas sur le fil — **seul le numéro compte**. Réutiliser le numéro d'un champ supprimé fait décoder d'anciens octets sous une nouvelle interprétation → corruption. Toujours `reserved` sur un numéro retiré. (Règle officielle : *« Field numbers should never be reused. »*)

### PIÈGE #4 — Renommer un champ JSON en pensant que c'est cosmétique
En JSON/MessagePack, le nom **est** la clé sur le fil. Renommer `displayName` → `name` casse tout consommateur qui lit l'ancien nom. Ce n'est jamais cosmétique : c'est un breaking change, à traiter en expand/contract. (En Protobuf, à l'inverse, c'est sûr car le numéro est conservé.)

### PIÈGE #5 — Oublier la valeur par défaut en Avro
En Avro, un champ ajouté **sans default** rend la lecture d'anciennes données impossible (« an error is signalled »). La compatibilité Avro *repose* sur les defaults : pas de default, pas d'évolution safe. Même logique côté JSON Schema (`required`) et proto3 (présence implicite = default automatique).

### PIÈGE #6 — Croire que le schema registry « choisit » un format
Le registry ne rend pas Protobuf « meilleur ». Il **automatise le contrôle de compatibilité** (BACKWARD/FORWARD/FULL) à l'enregistrement du schéma. Sans registry, la même discipline s'applique — juste à la main, en revue. Le registry transforme une convention humaine en garde-fou de build.

---

## 5. Ancrage TribuZen

Le fil rouge de ce module est le contrat **`member.joined`** entre le service **Family** (producteur) et le service **Notifications** (consommateur), plus tard rejoints par un service **Analytics** (deuxième consommateur).

Choix TribuZen concrets :
- **API front ↔ BFF** (ce que consomme l'app Vue) : **JSON** + validation Zod côté BFF. Lisible, débuggable, standard REST.
- **Événements inter-services** (`member.joined`, `family.updated`, …) publiés sur le bus : **contrat versionné, évolué en expand/contract**, avec objectif **full compatible** car Family, Notifications et Analytics ne se déploient jamais en même temps.
- Le contrat vit **contract-first** : un fichier de schéma partagé dans le repo, revu en PR, source de vérité — pas déduit du code d'un service.

Emplacement cible dans `smaurier/tribuzen` :

```
tribuzen/
  contracts/
    events/
      member-joined.v1.json      ← JSON Schema du contrat (source de vérité)
      member-joined.proto        ← variante Protobuf (bus haut débit)
  services/
    family/         ← producteur : émet member.joined
    notifications/  ← consommateur : lit name + locale
    analytics/      ← consommateur : lit familyId + memberId
```

Quand Analytics arrive comme second consommateur, la règle « ajouter avant de retirer, jamais de champ requis » devient vitale : chaque équipe déploie à son rythme, et le contrat full-compatible est ce qui rend ces déploiements indépendants possibles.

> La *décision* « événementiel vs appel synchrone » entre ces services relève du **cours 13-architecture** et du **module 06 (event-driven)** ; ici on a fixé le **format** et les **règles d'évolution** du contrat, quel que soit le style choisi.

---

## 6. Points clés

1. Sérialiser = transformer un objet en octets ; le format sur le fil **est** le contrat entre services.
2. JSON = texte universel, lisible, mais **aucun** schéma natif → valider par-dessus (JSON Schema / Zod).
3. Protobuf encode des **field numbers**, pas les noms → renommer est sûr, mais réutiliser un numéro est une corruption garantie ; toujours `reserved`.
4. Avro résout entre schéma **writer** et **reader** ; l'évolution safe **dépend des valeurs par défaut** (et des aliases pour renommer).
5. MessagePack = « JSON binaire » plus compact, mais sans schéma → mêmes (non-)garanties que JSON.
6. **Backward** = nouveau reader lit vieilles données (déployer les consommateurs d'abord).
7. **Forward** = vieux reader lit nouvelles données (déployer les producteurs d'abord).
8. **Full** = les deux → n'ajouter/retirer que des champs avec default ; c'est la cible quand l'ordre de déploiement est incertain.
9. Nouveau champ = **toujours optionnel** ; renommage/suppression = **expand/contract** (ajouter avant de retirer).
10. Un **schema registry** applique BACKWARD/FORWARD/FULL au build ; **contract-first** fait du schéma l'artefact source, pas un sous-produit du code.

---

## 7. Seeds Anki

```
Sur le fil, qu'est-ce que Protobuf encode pour chaque champ : le nom ou le numéro ?|Le field number, pas le nom. D'où : renommer un champ en gardant son numéro est sûr, mais réutiliser un numéro supprimé corrompt le décodage (toujours 'reserved').
Pourquoi doit-on 'reserved' un field number supprimé en Protobuf ?|Pour empêcher sa réutilisation future. Un ancien message porterait un type sur ce numéro, un nouveau champ le décoderait autrement → corruption silencieuse. Règle officielle : les numéros ne doivent jamais être réutilisés.
Définis backward compatible.|Un consommateur avec le NOUVEAU schéma peut lire les données produites avec l'ANCIEN. On l'obtient en déployant les consommateurs d'abord. Changements typiques : retirer un champ, ajouter un champ optionnel/avec default.
Définis forward compatible.|Les données produites avec le NOUVEAU schéma peuvent être lues par un consommateur avec l'ANCIEN. On l'obtient en déployant les producteurs d'abord. Changements typiques : ajouter un champ, retirer un champ optionnel.
Quand vise-t-on full compatibility et comment l'obtenir ?|Quand l'ordre de déploiement est incertain / rollback possible (cas microservices). On ne fait qu'ajouter ou retirer des champs AYANT une valeur par défaut.
En Avro, de quoi dépend une évolution de schéma sans erreur ?|Des valeurs par défaut. Champ présent chez le reader mais absent du writer : le default est utilisé. Sans default : erreur. (Aliases pour renommer.)
Renommer un champ JSON de displayName à name : breaking ou pas ?|Breaking. En JSON le nom EST la clé sur le fil : un vieux consommateur lisant displayName obtient undefined. À traiter en expand/contract (écrire les deux, migrer, puis retirer l'ancien).
C'est quoi un schema registry et à quoi sert le mode FULL ?|Un service central qui stocke/versionne les schémas et refuse d'enregistrer un schéma incompatible selon un mode (BACKWARD/FORWARD/FULL). FULL exige compatibilité dans les deux sens : n'ajouter/retirer que des champs avec default.
Contract-first vs code-first ?|Contract-first : on écrit le contrat (.proto, JSON Schema, OpenAPI) en premier, source de vérité versionnée, puis on génère le code. Code-first : le contrat est déduit de l'implémentation → dérive silencieuse entre services.
```

---

## Pont vers le lab

> Lab associé : `labs/lab-03-serialisation-et-contrats-api/README.md`. Tu définis un contrat `member.joined` (JSON Schema + variante Protobuf) pour TribuZen, puis tu le fais évoluer sur trois changements en garantissant la full compatibility — corrigé commenté intégral, sans harnais auto-correcteur.
