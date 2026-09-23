# Lab 02 — Intervention : une saga/outbox à poser sur un flux existant

> **Outcome :** à la fin, l'événement `SortieCréée` de TribuZen (module 13 : « doit atteindre
> Budget et Notifications SANS JAMAIS être perdu ni traité deux fois ») survit à une panne du
> broker au pire moment possible — juste après que la sortie a été enregistrée. Le bug
> d'origine (dual write) est invisible en usage normal : les deux écritures marchent très
> bien... jusqu'à ce que l'une des deux échoue seule.
> **Vrai geste :** transactional outbox (écriture métier + événement, atomiques) + polling
> publisher (le "message relay") + inbox pattern côté consommateur (dédup, idempotence).
> **Feedback :** `npm run lab:02` — RED tant que `src/outbox.ts` ne satisfait pas l'oracle
> (12 tests, dont un seul passe déjà sur le code existant — le bug est invisible en usage
> normal). `npm run solution:02` prouve l'oracle.

## Prérequis technique

```bash
cd 17-distributed-systems/labs
npm install
```

## Lire avant (une lecture bornée)

- Module [`13-outbox-pattern-reliable-messaging.md`](../../modules/13-outbox-pattern-reliable-messaging.md),
  §2.1 à 2.4 — le dual write problem, le transactional outbox, le polling publisher,
  at-least-once et l'inbox pattern.
- Module [`11-transactions-distribuees-saga.md`](../../modules/11-transactions-distribuees-saga.md) —
  contexte : la saga `createSortie` dont ce lab corrige la première étape.

## Énoncé

Ouvre `src/outbox.ts` : `createSortie` EST L'EXISTANT, EN PRODUCTION. Il compile, il marche
dans le cas nominal — la sortie est enregistrée, l'événement publié. Le bug ne se révèle
QUE si `bus.publish` échoue après que la base a déjà "commité" : la sortie existe, mais
l'événement est perdu à jamais (aucune trace nulle part pour le rejouer).

**Ta mission (findings avant code).** Identifie précisément où les deux écritures se
séparent dans `createSortie` — c'est le dual write. Puis corrige :

1. `createSortie` : plus jamais d'appel direct à `bus` ; écrit la sortie ET une ligne
   `outbox` (`publishedAt: null`) atomiquement.
2. `pollOutboxAndPublish` : le message relay — publie les lignes non publiées, dans l'ordre
   de création, marque `publishedAt` seulement après un `publish` réussi.
3. `applyIdempotent` : le pendant côté consommateur — dédup par `event.id`, pour que
   l'at-least-once de l'outbox ne se traduise jamais par un double effet métier.

**Le piège à éviter.** Ne te contente pas de vérifier que la sortie est créée — ça marche
DÉJÀ sur le code buggé (1 des 12 tests de l'oracle passe sans rien changer). Le vrai test
est : que se passe-t-il quand `bus.publish` échoue exactement au mauvais moment ?

## Étapes (en friction)

1. `npm run lab:02` : RED (11/12 — le test "cas nominal" passe déjà, c'est normal).
2. Corrige `createSortie` : retire l'appel à `bus`, ajoute l'écriture `outbox`.
3. Implémente `pollOutboxAndPublish` : filtre, trie par `createdAt`, publie, marque.
4. Implémente `applyIdempotent` : `Set` d'ids déjà traités.

## Vérifier

```bash
cd 17-distributed-systems/labs
npm run lab:02
npm run solution:02
```

**Ce que l'oracle vérifie (12 tests)**

Non-régression : la sortie est toujours enregistrée, même bus en panne, `createSortie` ne
throw jamais. Découplage : `createSortie` n'appelle jamais `bus` directement, écrit une
ligne outbox non publiée. `pollOutboxAndPublish` : publie et marque, ne republie jamais une
ligne déjà publiée, préserve l'ordre de création (pas l'ordre d'insertion), un échec de
publish s'arrête net sans perdre les lignes déjà publiées ni celles pas encore tentées.
`applyIdempotent` : applique une fois, jamais deux fois le même id, applique bien un id
différent. Intégration : panne du broker à la création → récupération par un poll ultérieur
→ appliqué une seule fois côté consommateur malgré une redelivery simulée.

## Variante J+30 (fading)

Ajoute une deuxième ligne outbox pour une AUTRE sortie créée entre-temps, et vérifie que
`pollOutboxAndPublish` traite les deux dans l'ordre de création exact, même si un troisième
appel `createSortie` intercalé a été fait pour une sortie plus ancienne (`createdAt`
antérieur, insérée plus tard).

## Application TribuZen

Même geste sur le vrai flux `tribuzen-api → createSortie`, remplaçant le dual write par un
outbox réel (table Postgres, module 10) et un relay planifié. Commit :
`fix(saga): événement SortieCréée protégé par transactional outbox, plus jamais perdu`.
