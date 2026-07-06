# Lab 03 — Sérialisation & contrats d'API

> **Outcome :** à la fin, tu sais définir un contrat d'événement TribuZen (JSON Schema + variante Protobuf) et le faire évoluer sur plusieurs sprints **sans jamais casser un consommateur déployé**, en classant chaque changement en backward / forward / full.
> **Vrai outil :** un fichier `member-joined.v1.json` (JSON Schema) + un `member-joined.proto` (proto3), validés à la main contre des messages d'exemple. Optionnel : `npx ajv-cli validate` (JSON Schema) et `protoc` pour compiler le `.proto`. Aucun test-runner auto-correcteur.
> **Feedback :** le coach valide en session — tu justifies chaque verdict de compatibilité à voix haute.

## Énoncé

Tu es dans l'équipe plateforme de TribuZen. Le service **Family** publie l'événement `member.joined`, consommé par **Notifications** (mail de bienvenue) et bientôt par **Analytics**. Family, Notifications et Analytics **se déploient dans un ordre incertain, avec rollback possible** — donc chaque évolution du contrat doit rester **full compatible**.

Contrat de départ (v1), message d'exemple :

```jsonc
{
  "familyId": "fam_8a3",
  "memberId": "mem_41",
  "displayName": "Alice",
  "joinedAt": "2026-07-06T10:30:00Z"
}
```

Notifications lit `displayName` et `joinedAt`. Analytics (à venir) lira `familyId` et `memberId`.

### Ce que tu produis

1. **`member-joined.v1.json`** — le JSON Schema de la v1 ci-dessus (`familyId`, `memberId`, `displayName`, `joinedAt`, tous requis sauf ce que tu juges optionnel).
2. **`member-joined.proto`** — le même contrat en proto3, avec des field numbers explicites.
3. **`evolution.md`** — pour chacun des trois changements de sprint ci-dessous : le verdict (backward / forward / full / breaking), la justification, et le schéma résultant.

Les trois changements demandés par l'équipe Family :
- **C1** — ajouter `locale` (pour la langue du mail), default `"fr-FR"`.
- **C2** — renommer `displayName` en `name`.
- **C3** — supprimer `joinedAt` (jugé non fiable).

**Contrainte dure :** à aucune étape un message produit ne doit être illisible par un consommateur encore en v1, ni l'inverse. Pas de gap-fill — tu écris les fichiers de zéro.

### Starter minimal

```
lab-03/
  member-joined.v1.json    ← à écrire
  member-joined.proto      ← à écrire
  evolution.md             ← à écrire
  samples/
    v1.json                ← le message d'exemple ci-dessus (fourni)
```

## Étapes (en friction)

1. **Écris `member-joined.v1.json`** — un JSON Schema `type: object`, `properties` pour les 4 champs, `required` réfléchi (qu'est-ce qui est vraiment obligatoire ?).
2. **Écris `member-joined.proto`** — `syntax = "proto3"`, un `message MemberJoined` avec un field number pour chaque champ. Note mentalement : le numéro voyage sur le fil, pas le nom.
3. **Traite C1 (`locale`)** — ajoute le champ dans les deux schémas. Décide : requis ou optionnel ? default ? Classe le changement et écris pourquoi c'est full compatible.
4. **Traite C2 (renommage)** — c'est là que JSON et Protobuf divergent. Pour le JSON Schema : conçois la séquence **expand/contract** (quels champs présents à chaque étape). Pour le `.proto` : montre pourquoi garder le field number suffit.
5. **Traite C3 (suppression)** — sous quelle condition retirer `joinedAt` est-il safe ? Qui doit avoir migré d'abord ? En Protobuf, ajoute la clause `reserved` correcte.
6. **Vérifie** — passe chaque message d'exemple (v1 et « nouvelle version ») mentalement (ou avec `ajv`) contre l'ancien ET le nouveau schéma. Si l'un des deux sens échoue, ton changement n'est pas full.
7. **Cas limite** — un collègue propose de faire `bool joined_at = 4;` plus tard sur le numéro libéré. Explique en une phrase pourquoi ça corrompt les données.

## Corrigé complet commenté

**`member-joined.v1.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "member.joined v1",
  "type": "object",
  "properties": {
    "familyId":    { "type": "string" },
    "memberId":    { "type": "string" },
    "displayName": { "type": "string" },
    "joinedAt":    { "type": "string", "format": "date-time" }
  },
  "required": ["familyId", "memberId", "displayName", "joinedAt"]
}
```

**`member-joined.proto` (v1)**

```protobuf
syntax = "proto3";

message MemberJoined {
  string family_id   = 1;  // le numéro (=1) est ce qui est encodé sur le fil
  string member_id   = 2;
  string display_name = 3;
  string joined_at   = 4;  // RFC3339
}
```

**`evolution.md` — verdicts et schémas**

```md
## C1 — ajouter `locale` (default "fr-FR")
Verdict : FULL compatible.
- Backward : un vieux writer n'émet pas `locale` → le nouveau reader applique le default. OK.
- Forward  : un vieux reader ignore le champ `locale` inconnu. OK.
Règle : nouveau champ = OPTIONNEL (jamais dans `required`), avec default.

JSON Schema : ajouter dans `properties`, PAS dans `required` :
  "locale": { "type": "string", "default": "fr-FR" }
Proto : ajouter un NOUVEAU field number :
  string locale = 5;

## C2 — renommer displayName -> name
Verdict JSON : BREAKING si fait d'un coup → traiter en EXPAND/CONTRACT.
En JSON le NOM est la clé sur le fil ; renommer casse tout reader qui lit l'ancien nom.

  Étape expand   : le producteur écrit displayName ET name (les deux dans properties,
                   ni l'un ni l'autre requis) → full compatible.
  Étape migrate  : tous les consommateurs passent à name (fallback name ?? displayName).
  Étape contract : une fois tous migrés, le producteur cesse d'écrire displayName.

Verdict Proto : NON-BREAKING directement.
Le nom ne voyage pas sur le fil, seul le numéro compte → on renomme en gardant le numéro :
  string name = 3;   // ex-display_name, numéro 3 conservé

## C3 — supprimer joinedAt
Verdict : BACKWARD only tant qu'un consommateur le lit encore ; FULL une fois que
personne ne le lit. Condition : retirer joinedAt SEULEMENT après que tous les
consommateurs ont cessé de le lire (sinon on casse forward).

Proto : geler le numéro ET le nom pour toujours :
  reserved 4;
  reserved "joined_at";
```

**Proto final (après C1+C2+C3)**

```protobuf
syntax = "proto3";

message MemberJoined {
  string family_id = 1;
  string member_id = 2;
  string name      = 3;         // renommé, numéro 3 gardé -> wire-compatible
  reserved 4, "joined_at";      // supprimé : numéro ET nom gelés à jamais
  string locale    = 5;         // ajouté -> nouveau numéro, safe
}
```

**Cas limite (étape 7).** Réutiliser le numéro 4 avec `bool joined_at = 4;` corrompt les données : un ancien message porte une *string* sur le champ 4, un nouveau décodeur l'interprète comme un *booléen* → mauvaise lecture silencieuse. C'est pourquoi `reserved 4` doit rester à vie ; il fait échouer la compilation si quelqu'un tente de réutiliser le numéro.

**Pourquoi ce corrigé est correct :**
- Aucun champ nouveau n'est mis dans `required` → chaque ajout reste full compatible.
- Le renommage JSON passe par expand/contract → jamais de fenêtre où un message est illisible.
- Le renommage Proto exploite l'invariant « le field number est l'identité » → zéro étape intermédiaire.
- `reserved` protège l'invariant Protobuf le plus dangereux (numéros jamais réutilisés).

## Grille d'auto-évaluation

| Critère | Acquis si… |
|---|---|
| JSON Schema v1 | 4 champs typés, `required` justifié, `format: date-time` sur `joinedAt` |
| Proto v1 | field numbers 1..4 explicites, proto3 |
| C1 classé | verdict **full** + `locale` optionnel avec default (pas dans `required`) |
| C2 JSON | séquence **expand → migrate → contract** décrite, pas de renommage brutal |
| C2 Proto | renommage à **numéro conservé**, justification « le nom ne voyage pas » |
| C3 | condition « retirer après migration des lecteurs » + `reserved 4, "joined_at"` |
| Cas limite | explique la corruption liée à la réutilisation du numéro 4 |
| Vocabulaire | tu sais dire, pour chaque changement, backward / forward / full et **pourquoi** |

Score cible : 8/8 sans rouvrir le module.

## Coach — points de contrôle en session

- **Fais verbaliser la direction.** « C1 est backward parce que… et forward parce que… » — si Sylvain n'articule pas les deux sens séparément, il devine au lieu de raisonner.
- **Piège tendu :** propose « mettons `name` en `required` tout de suite, c'est plus propre ». S'il accepte, il vient de casser le backward (vieux writer sans `name`). Bonne réponse : jamais de nouveau champ requis pendant une transition.
- **Vérifie l'invariant Proto :** demande « qu'est-ce qui est encodé sur le fil, le nom ou le numéro ? ». Toute la différence JSON/Proto sur le renommage en découle.
- **Ordre de déploiement :** demande « si tu déploies Notifications avant Family, tu as besoin de quelle compatibilité ? » (réponse : backward). Relie la théorie au geste ops concret.
- **Stop si** il traite C2 comme un simple rename JSON sans expand/contract → revenir au §2.8 du module avant d'avancer.

## Variante J+30 (fading)

**De mémoire, en 25 minutes, sans rouvrir ce corrigé ni le module :**

Un **quatrième** consommateur (`Billing`) arrive et a besoin d'un champ `plan` (`"free" | "premium"`). En parallèle, Family veut **changer le type** de `memberId` de `string` vers un `int64` (Protobuf) / `number` (JSON) pour de meilleures perfs.

1. Classe l'ajout de `plan` (full / backward / forward / breaking ?) et écris-le dans les deux schémas.
2. Classe le **changement de type** de `memberId`. Piège : est-ce jamais compatible ? Sinon, propose une stratégie (nouveau champ `memberIdNum` en expand/contract, ou versioning explicite v2 en parallèle) et justifie.
3. En Protobuf, dis si changer `string member_id = 2` en `int64 member_id = 2` est wire-safe. (Indice : ce n'est **pas** dans la liste des changements sûrs.)

**Critère de réussite :** tu identifies que **changer le type d'un champ existant est un breaking change** dans les deux formats, et tu proposes une migration qui n'exige jamais un déploiement synchronisé de tous les services.

## Application TribuZen

Dans le repo `smaurier/tribuzen`, ces contrats vivent hors des services, en **contract-first** :

```
tribuzen/
  contracts/
    events/
      member-joined.v1.json     ← source de vérité, revue en PR
      member-joined.proto       ← variante bus haut débit
  services/
    family/         ← produit member.joined
    notifications/  ← lit name + locale
    analytics/      ← lit familyId + memberId
```

**Différences avec le lab :**
- En vrai, un **schema registry** (mode `FULL`) refuserait au build tout schéma non full-compatible — le contrôle manuel du lab devient automatique.
- Les types TS des services seraient **générés** depuis le contrat (`json-schema-to-typescript`, ou `protoc` + plugin TS), jamais écrits à la main de chaque côté.
- La validation runtime côté BFF passerait par Zod dérivé du même JSON Schema.

**Commit cible :**
```
feat(contracts): member.joined — schéma versionné + évolution full-compatible (locale, rename, reserved)
```
