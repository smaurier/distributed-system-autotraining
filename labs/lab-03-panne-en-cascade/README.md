# Lab 03 — Intervention : une panne en cascade à reproduire et contenir

> **Outcome :** à la fin, une requête Notifications encore en cours (module 14 : « le service
> Notifications devient lent ; sans protection il sature le pool de connexions de l'API-
> gateway et fait tomber tout TribuZen ») ne peut plus jamais faire échouer une AUTRE requête
> parfaitement saine qui n'a rien demandé à Notifications. Le bug est invisible sur un appel
> isolé — il ne se révèle que sous charge, sur un pool partagé.
> **Vrai geste :** bulkhead par dépendance (isolation, fail-fast) + classification
> critique/non-critique + fallback (dégradation gracieuse).
> **Feedback :** `npm run lab:03` — RED tant que `src/cascade.ts` ne satisfait pas l'oracle
> (7 tests, dont 4 passent déjà sur le code existant — les bugs sont invisibles en usage
> normal ou isolé). `npm run solution:03` prouve l'oracle.

## Prérequis technique

```bash
cd 17-distributed-systems/labs
npm install
```

## Lire avant (une lecture bornée)

- Module [`14-failure-modes-et-circuit-breaker.md`](../../modules/14-failure-modes-et-circuit-breaker.md),
  §2.2 (panne en cascade), §2.4 (bulkhead), §2.6 (fail-fast, dégradation gracieuse, fallback),
  §2.7 (ordre de composition), piège #8 (rendre les permis).

## Énoncé

Ouvre `src/cascade.ts` : `getHomePage` EST L'EXISTANT, EN PRODUCTION. Il compile, il marche
sur un appel isolé. Le bug : les TROIS dépendances (Sorties, Budget, Notifications) prennent
leur permis dans le MÊME pool (`pools.sorties`) — copier-coller resté là. Sous charge, une
requête Notifications encore en cours peut épuiser ce pool et faire échouer une AUTRE
requête, dont les trois dépendances sont pourtant parfaitement saines.

**Ta mission (findings avant code).** Identifie où les trois appels convergent vers le même
pool. Puis corrige :

1. **Isolation** : chaque dépendance prend son permis dans SON PROPRE pool
   (`pools.sorties`/`pools.budget`/`pools.notifications`).
2. **Classification** : Sorties et Budget restent CRITIQUES (leur échec fait échouer toute
   la page — comportement déjà correct, ne pas y toucher). Notifications devient NON
   CRITIQUE : son échec (rejet, ou bulkhead plein) déclenche un fallback (`notifications:
   null`), la page s'affiche sans le badge.

**Le piège à éviter.** Ne teste pas seulement un appel isolé — ça marche DÉJÀ sur le code
buggé (4 des 7 tests de l'oracle passent sans rien changer). Le vrai test : que se passe-t-il
quand une AUTRE requête, en cours au même moment, tient encore un permis dans le pool
partagé ?

## Étapes (en friction)

1. `npm run lab:03` : RED (3/7 — les 4 tests qui passent déjà le font parce que le bug est
   invisible en usage normal ou isolé, c'est normal).
2. Change `pools.sorties` en `pools.budget` pour l'appel Budget, et en `pools.notifications`
   pour l'appel Notifications.
3. Enveloppe l'appel Notifications d'un `.catch(() => null)` — dégradation gracieuse.

## Vérifier

```bash
cd 17-distributed-systems/labs
npm run lab:03
npm run solution:03
```

**Ce que l'oracle vérifie (7 tests)**

Cas nominal. Classification : Sorties/Budget critiques (échec propage), Notifications non
critique (échec → fallback `null`, la page ne tombe pas). Piège #8 : des échecs Sorties
répétés ne font jamais fuir un permis (pool toujours revenu à sa capacité). **La panne en
cascade** : une requête saine échoue à cause d'un pool partagé encore occupé par une autre
requête en cours (starter) / n'échoue jamais (solution, pools isolés) — le test central du
lab. Containment explicite : un bulkhead Notifications plein déclenche le fallback SANS
jamais toucher aux résultats Sorties/Budget.

## Variante J+30 (fading)

Ajoute un **circuit breaker** (module 14 §2.5, réutilisé du lab 01) AU-DESSUS du bulkhead
Notifications : après N échecs consécutifs, les appels suivants fail-fast directement sans
même tenter d'acquérir un permis — et prouve, par un test, que la classification critique/
non-critique reste inchangée (Sorties/Budget toujours critiques, Notifications toujours en
fallback, même avec le breaker ouvert).

## Application TribuZen

Même geste sur le vrai `getHomePage` de `tribuzen-api`, remplaçant un pool de connexions
unique partagé entre tous les appels aval par un bulkhead par dépendance, avec Notifications
explicitement classée non critique. Commit :
`fix(resilience): panne en cascade contenue — bulkhead par dépendance + fallback Notifications`.
