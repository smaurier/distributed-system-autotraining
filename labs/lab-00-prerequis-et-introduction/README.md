# Lab 00 — Auditer un design TribuZen naïf : fallacies & défis fondamentaux

> **Outcome :** à la fin, tu sais lire un design distribué et pointer, ligne par ligne, quelle **fallacy** il suppose et quel **défi fondamental** (partial failure / concurrence / horloge) il ignore — puis proposer la parade.
> **Vrai outil :** ta tête + le radar à fallacies du module 00. C'est un lab d'**analyse de design**, pas de code : le vrai livrable d'un ingénieur distribué, c'est de repérer le problème *avant* de l'écrire.
> **Feedback :** le coach valide ton audit en session (pas de test-runner — un design ne se compile pas).

---

## Énoncé

L'équipe TribuZen a décidé (trop tôt) de découper le monolithe en services. Un dev junior a livré ce premier jet du service `familles`, qui orchestre trois autres services (`auth`, `notif`, `paiement`). Il « marche sur sa machine ».

Ta mission : **auditer ce design** et produire un rapport. Tu ne corriges pas le code — tu **diagnostiques**.

```ts
// familles-service — POST /families/:id/upgrade-premium
// Passe une famille en offre premium : vérifie le propriétaire, débite,
// met à jour le quota de membres, envoie une confirmation.
async function upgradePremium(familyId: string, ownerId: string) {
  // 1. Résoudre le propriétaire auprès du service auth
  const owner = await fetch(`http://192.168.1.20:3001/users/${ownerId}`)
    .then(r => r.json())

  // 2. Charger l'état complet de la famille + l'historique de toutes les familles
  //    (pour calculer une "position" dans le classement premium)
  const toutes = await fetch(`http://familles-service/families/all`)
    .then(r => r.json()) // ~500 000 familles

  const famille = toutes.find((f: any) => f.id === familyId)

  // 3. Débiter la carte via le service paiement (un seul essai)
  await fetch(`http://paiement-service/charge`, {
    method: 'POST',
    body: JSON.stringify({ userId: ownerId, amount: 4900 }),
  })

  // 4. Mettre à jour le quota de membres de la famille
  //    (lecture puis écriture, sans verrou)
  famille.maxMembers = famille.maxMembers + 20
  await fetch(`http://familles-service/families/${familyId}`, {
    method: 'PUT',
    body: JSON.stringify(famille),
  })

  // 5. Marquer premium avec l'heure LOCALE de ce service comme "source de vérité"
  famille.premiumSince = Date.now()

  // 6. Envoyer la confirmation
  await fetch(`http://notif-service/send`, {
    method: 'POST',
    body: JSON.stringify({ to: owner.email, template: 'premium-ok' }),
  })

  return { ok: true }
}
```

**Livrable attendu (un tableau + un paragraphe de synthèse) :**

1. **Tableau d'audit** — pour chaque numéro d'étape problématique : la/les **fallacy(ies)** violée(s), le **défi fondamental** exposé (partial failure / concurrence / horloge / — s'il n'y en a pas), et la **parade** en une phrase (le pattern, pas le code).
2. **Synthèse** — réponds à : *« Ce découpage était-il seulement justifié ? »* en appliquant l'heuristique « quand NE PAS distribuer » du module.

---

## Étapes (en friction)

Fais-le **sans regarder le corrigé**. Produis d'abord, compare ensuite.

1. **Numérote et relis** chaque étape (1 à 6). Pour chacune, pose-toi la question radar : *« quelle hypothèse cette ligne fait-elle sur le réseau / les autres services / le temps ? »*
2. **Remplis le tableau d'audit** à la main (papier ou fichier). Force-toi à nommer la fallacy **par son numéro et son intitulé**, pas « le réseau peut planter ».
3. **Repère le scénario de panne partielle** le plus dangereux : quelle séquence d'échec laisse la famille dans un état incohérent (ex. débitée mais pas premium) ? Décris-la en une phrase.
4. **Repère le bug de concurrence** : que se passe-t-il si deux `upgradePremium` (ou un upgrade + un ajout de membre) tournent en parallèle sur la même famille à l'étape 4 ?
5. **Repère le piège d'horloge** : pourquoi `premiumSince = Date.now()` à l'étape 5 est-il fragile dès qu'un autre service compare cette date à la sienne ?
6. **Tranche la question du découpage** avec l'heuristique du module (charge / équipe / dispo / données).

---

## Grille d'auto-évaluation

Coche ce que ton audit a réellement trouvé. **Objectif : 8/10.**

- [ ] Étape 1 → **Fallacy 5** (topologie stable) : IP `192.168.1.20` en dur.
- [ ] Étape 2 → **Fallacy 3** (bande passante infinie) **+ Fallacy 2** (latence nulle) : rapatrier 500 000 familles pour en trouver une.
- [ ] Étape 3 → **Fallacy 1** (réseau fiable) + **partial failure** : débit sans timeout/retry/idempotence → risque de double débit ou de débit perdu.
- [ ] Étape 4 → **concurrence sans mémoire partagée** : lecture-modification-écriture sans verrou → *lost update* du `maxMembers`.
- [ ] Étape 5 → **pas d'horloge globale** : `Date.now()` local non comparable entre services (drift).
- [ ] Étape 6 → **Fallacy 1** encore : confirmation envoyée sans garantie ; si elle échoue après un débit réussi, le client paie sans confirmation.
- [ ] **Fallacy 4** (réseau sécurisé) identifiée globalement : aucun appel inter-services n'est authentifié/chiffré.
- [ ] **Absence de transaction** relevée : débit (étape 3) + mise à jour (étape 4) ne sont pas atomiques ; pas de saga/compensation.
- [ ] Le **scénario de panne partielle** « débité mais pas premium » est décrit explicitement.
- [ ] La **synthèse** applique l'heuristique et prend position sur la pertinence du découpage.

---

## Corrigé complet commenté

### Tableau d'audit

| Étape | Fallacy(ies) violée(s) | Défi fondamental | Parade (pattern, pas code) |
|---|---|---|---|
| 1 | **5** — topologie stable (IP en dur) | — | Service discovery / DNS interne (`http://auth-service/...`), jamais d'IP littérale. |
| 2 | **3** bande passante + **2** latence | — | Filtrer côté serveur : `GET /families/{id}` ou un endpoint de classement dédié. Ne jamais rapatrier tout un dataset pour un `find`. |
| 3 | **1** — réseau fiable | **Partial failure** | Timeout + retry avec backoff + **clé d'idempotence** sur le débit (module 08), sinon double débit possible. |
| 4 | — | **Concurrence** (lost update) | Écriture conditionnelle / versioning optimiste (compare-and-set) ou incrément atomique côté service, pas read-modify-write client. |
| 5 | — | **Pas d'horloge globale** | Horloge logique ou timestamp **attribué par le service propriétaire** de la donnée ; ne pas comparer des `Date.now()` de services différents. |
| 6 | **1** — réseau fiable | **Partial failure** | Notification asynchrone via queue/outbox (at-least-once + idempotence) — la confirmation ne doit pas bloquer ni compromettre le débit. |
| global | **4** — réseau sécurisé | — | mTLS / token de service sur tous les appels inter-services (cours 14). |
| global | — (atomicité) | **Partial failure** | Débit + upgrade forment une opération métier : **saga** avec compensation (rembourser si l'upgrade échoue) — modules 11/13. |

### Scénario de panne partielle le plus dangereux

> À l'étape 3 le débit **réussit** côté service paiement, mais la réponse se **perd** au retour (timeout). Le code croit l'appel échoué (ou, s'il n'y a pas de retry, poursuit quand même). Deux issues : soit un retry naïf **re-débite** (double paiement, car pas d'idempotence), soit l'exécution s'arrête et la famille est **débitée mais jamais passée premium** (étapes 4-6 non exécutées). Dans les deux cas : client lésé, aucun rollback automatique. C'est *la* signature de la panne partielle : un timeout ne dit pas si le débit a eu lieu.

### Bug de concurrence (étape 4)

> Deux requêtes parallèles (upgrade premium + ajout de membre par un admin) lisent `maxMembers = 30`, calculent chacune leur nouvelle valeur, et écrivent. La dernière écriture écrase la première : un des deux ajustements est **perdu** (*lost update*). En monolithe, une transaction/verrou l'empêchait. En distribué, il faut un incrément atomique côté service ou une écriture conditionnelle sur version.

### Piège d'horloge (étape 5)

> `premiumSince = Date.now()` prend l'heure **locale** du service familles. Dès que `notif-service` ou `paiement-service` compare cette date à sa propre horloge (ex. « la confirmation est-elle postérieure au passage premium ? »), le **drift** entre horloges peut inverser l'ordre réel. Les timestamps physiques de nœuds distincts ne sont pas comparables pour établir un ordre causal.

### Synthèse — le découpage était-il justifié ?

> Rien dans l'énoncé ne suggère que les trois moteurs du distribué mordaient : pas de charge mentionnée qui dépasse une instance, une seule opération métier, pas de SLA de dispo. Découper `upgradePremium` en 4 appels réseau a **transformé une transaction ACID locale simple en une saga distribuée fragile** — sans le bénéfice. Le bon geste aurait été de **rester monolithe** pour cette opération (débit + upgrade dans une transaction locale), et de n'extraire en asynchrone que la **notification** (non critique, tolère l'échec et le retry). On distribue un point de douleur *mesuré*, pas une fonction entière par principe.

---

## Variante J+30 (fading)

**Même exercice, contraintes ajoutées :**

1. On te donne un **nouveau** design (invente-le ou demande-le au coach) : un service `evenements` TribuZen qui, à la réservation d'une activité familiale, appelle `calendrier`, `paiement` et `notif`.
2. Fais l'audit **de mémoire, en 15 minutes**, sans rouvrir le module 00 ni ce corrigé.
3. Contrainte supplémentaire : pour **chaque** ligne fautive, tu dois citer la fallacy **par son numéro** ET nommer le module du cours qui apporte la parade (ex. « Fallacy 1 → module 08 »).

**Critère de réussite :** au moins 6 problèmes distincts identifiés, chacun rattaché à sa fallacy/défi et à un module de parade, en 15 min.

---

## Application TribuZen

Ce lab ne touche pas encore le code de `smaurier/tribuzen` — mais son livrable est **réutilisable** : garde ton tableau d'audit comme **checklist de revue** pour chaque futur découpage.

- Quand tu extrairas réellement un service au **module 02**, repasse chaque appel réseau dans cette grille avant de merger.
- Crée dans le repo un fichier `docs/adr/0001-decoupage-services.md` (Architecture Decision Record) où tu consignes : *quelle* opération tu distribues, *pourquoi* (le moteur mesuré), et *quels* patterns de parade tu t'engages à appliquer. C'est la trace que la décision était réfléchie, pas subie.

**Commit cible (documentation, pas encore de service) :**
```
docs(adr): audit fallacies du 1er découpage familles — décision de rester monolithe sauf notifications
```
