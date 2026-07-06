# Lab 01 — Communication réseau fondamentale (mesurer la latence, provoquer un partial failure)

> **Outcome :** à la fin, tu sais **mesurer** la latence réelle entre deux services TribuZen, **raisonner** le coût d'un endpoint en RTT, et **provoquer + diagnostiquer** un partial failure (service tombé, réseau lent).
> **Vrai outil :** Docker Compose + Node.js (`fetch` natif, `performance.now()`). Vrai réseau entre vrais conteneurs — **aucun harnais simulé**.
> **Feedback :** le coach valide tes mesures et ton raisonnement en session (pas de test-runner auto-correcteur).

---

## Énoncé

TribuZen vient d'être découpé. On te fournit un mini-cluster de trois services conteneurisés :

- `auth-service` — répond à `GET /verify` (valide un token, ~instantané).
- `family-service` — répond à `GET /dashboard`, qui appelle `auth-service` **par le réseau**.
- `slow-service` — répond à `GET /notifs` avec un délai configurable (simule un service lent/lointain).

Ta mission tient en trois actes :

1. **Mesurer** le RTT vers chaque service et le comparer à un appel « local » (dans le même processus).
2. **Raisonner** le coût de `/dashboard` en RTT, puis le réduire sans changer les données.
3. **Casser** le réseau (couper `auth-service`, ralentir `slow-service`) et **diagnostiquer** ce que tu observes vs ce qui s'est vraiment passé.

Tu n'as **rien à installer** d'autre que Docker. Tu écris toi-même le script de mesure (pas de gap-fill).

### Le cluster fourni (`docker-compose.yml`)

Crée ce fichier à la racine de ton dossier de lab :

```yaml
services:
  auth-service:
    image: node:22-alpine
    working_dir: /app
    command: node -e "require('http').createServer((_,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({userId:'u-42',valid:true}))}).listen(3001,()=>console.log('auth up :3001'))"
    ports: ["3001:3001"]
    networks: [tribuzen]

  slow-service:
    image: node:22-alpine
    working_dir: /app
    # DELAY_MS injecté via l'environnement — simule un service lent/lointain
    environment:
      DELAY_MS: "0"
    command: >
      node -e "const d=+process.env.DELAY_MS||0;require('http').createServer((_,res)=>{setTimeout(()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({unread:3}))},d)}).listen(3003,()=>console.log('slow up :3003 delay='+d))"
    ports: ["3003:3003"]
    networks: [tribuzen]

  family-service:
    image: node:22-alpine
    working_dir: /app
    # /dashboard appelle auth-service PAR LE RÉSEAU (nom DNS = nom du service compose)
    command: >
      node -e "require('http').createServer(async(_,res)=>{try{const a=await fetch('http://auth-service:3001/verify');const u=await a.json();res.setHeader('content-type','application/json');res.end(JSON.stringify({family:'Maurier',user:u.userId}))}catch(e){res.statusCode=502;res.end(JSON.stringify({error:String(e)}))}}).listen(3002,()=>console.log('family up :3002'))"
    ports: ["3002:3002"]
    depends_on: [auth-service]
    networks: [tribuzen]

networks:
  tribuzen:
```

Démarre-le :

```bash
docker compose up
# dans un autre terminal, vérifie que ça répond :
curl http://localhost:3001/verify
curl http://localhost:3002/dashboard
curl http://localhost:3003/notifs
```

> Note : le endpoint importe peu (`/verify`, `/dashboard`, `/notifs` renvoient tous la même réponse par service) — ces serveurs ignorent le chemin. Ce qui compte, c'est le **réseau réel** entre conteneurs.

---

## Étapes (en friction)

### Acte 1 — Mesurer

1. Écris `measure.mjs` (exécuté sur ta machine hôte, Node ≥ 20) qui fait **20 appels** à `http://localhost:3001/verify` et calcule **min / moyenne / p95** en ms avec `performance.now()`. Écris la boucle toi-même.
2. Ajoute un point de comparaison : mesure 20 appels d'une **fonction locale** (`() => ({ userId: 'u-42', valid: true })`) de la même façon. Compare l'ordre de grandeur local vs réseau. Combien de fois plus lent ?
3. Note ton RTT observé vers `auth-service`. Est-il proche de 0,5 ms (même machine) ou plus ?

### Acte 2 — Raisonner en RTT

4. Mesure `http://localhost:3002/dashboard`. Ce endpoint fait **1 appel réseau interne** (`family → auth`). Vérifie que sa latence ≈ RTT(hôte→family) + RTT(family→auth).
5. **Sur papier** (ou en commentaire) : si `/dashboard` devait aussi appeler `slow-service`, et que les deux appels internes sont **indépendants**, quel est le coût en RTT en séquentiel ? en parallèle (`Promise.all`) ? Écris les deux formules.
6. Passe `DELAY_MS` de `slow-service` à `200` (voir Acte 3, étape 7) et re-mesure `/notifs` : confirme que la latence observée ≈ 200 ms + RTT.

### Acte 3 — Casser et diagnostiquer

7. Ralentis `slow-service` : édite `DELAY_MS: "200"` puis `docker compose up -d slow-service`. Re-mesure `/notifs`.
8. **Tue** `auth-service` : `docker compose stop auth-service`. Rappelle `http://localhost:3002/dashboard`. Que se passe-t-il ? Combien de temps avant l'erreur ? (family-service n'a **pas** de timeout — observe le comportement par défaut de `fetch`.)
9. **Le point clé du lab** : pour chacun des cas ci-dessous, écris ce que **le client observe** vs ce qui s'est **réellement passé** côté serveur :
   - (a) `auth-service` est stoppé → family renvoie 502.
   - (b) tu imagines que family-service **a** un timeout de 100 ms mais qu'auth-service répond en 150 ms **après avoir déjà fait le travail** → le client voit un échec, mais le travail a eu lieu.
10. Conclus : un timeout côté family prouve-t-il que `auth-service` n'a rien fait ? (Réponse attendue : non — cf. §2.6 du module.)

---

## Grille d'auto-évaluation

Coche honnêtement avant la session coach :

| Critère | Fait |
|---|---|
| `measure.mjs` calcule min/moy/p95 sur ≥ 20 échantillons | ☐ |
| J'ai un chiffre concret : RTT réseau vs appel local (ratio) | ☐ |
| J'ai vérifié `/dashboard` ≈ somme des RTT de la chaîne | ☐ |
| J'ai écrit les deux formules de coût (séquentiel vs `Promise.all`) | ☐ |
| J'ai observé le comportement de `/dashboard` quand `auth-service` est mort | ☐ |
| Je sais expliquer, avec le cas (b), pourquoi un timeout ≠ « échec certain » | ☐ |
| Je peux nommer le partial failure et l'incertitude qu'il crée | ☐ |

---

## Notes pour le coach

- **Objectif réel** : ancrer l'intuition « appel réseau = autre ordre de grandeur + peut échouer ». Le ratio local/réseau observé (souvent 100×–10 000×) doit **surprendre** l'apprenant — c'est le générateur de mémoire.
- **Seed de relance si silence** : « Ton `/dashboard` répond en X ms. Décompose : quelle part est le hop hôte→family, quelle part family→auth ? »
- **Piège attendu à l'étape 8** : sans timeout, `fetch` de family-service échoue *rapidement* ici (connexion refusée, car le conteneur est stoppé net). Bien distinguer **« service refuse la connexion »** (échec rapide, net) de **« service ne répond jamais »** (timeout, incertitude). Pour reproduire le second cas, faire pointer family vers un port filtré (ex. `sleep`/pause du conteneur) plutôt que `stop`.
- **Question de discrimination** à poser : « Latence ou bande passante ? » sur deux symptômes — (i) 10 petits appels séquentiels lents, (ii) un transfert de 500 Mo lent. L'apprenant doit classer correctement.
- **Ne pas accepter** « il faut mettre un timeout » sans que l'apprenant explique *ce que le timeout ne dit pas* (l'incertitude sur le travail effectué).

---

## Variante J+30 (fading)

**Même cluster, contraintes ajoutées, sans rouvrir ce README ni le module :**

1. Étends `family-service` pour appeler **`auth-service` ET `slow-service`** dans `/dashboard`. Fais-le d'abord **en séquentiel**, mesure ; puis en **`Promise.all`**, mesure. Le gain doit correspondre à ta formule de l'Acte 2.
2. Ajoute un **timeout explicite de 100 ms** sur les appels internes (via `AbortController` + `AbortSignal.timeout(100)`). Mets `DELAY_MS=200` sur `slow-service` et montre que `/dashboard` échoue **proprement** en ~100 ms au lieu d'attendre 200 ms.
3. En une phrase : après ce timeout, que sais-tu de l'état côté `slow-service` ? (Réponse attendue : rien de certain.)

**Critère de réussite :** tu produis le cluster modifié, tu mesures les deux versions, et tu justifies chaque chiffre en RTT — en 30 minutes, de mémoire.

---

## Application TribuZen

Dans `smaurier/tribuzen`, ce lab devient le socle du package partagé de communication inter-services :

```
tribuzen/
  packages/
    rpc-client/
      src/
        withTimeout.ts   ← wrapper fetch : timeout explicite OBLIGATOIRE par défaut
        measure.ts       ← utilitaire de mesure de latence (min/moy/p95)
  services/
    family-service/      ← /dashboard parallélise ses appels (Promise.all)
```

**Différences par rapport au lab :**
- Les timeouts ne seront pas optionnels : `rpc-client` **refuse** un appel sans budget de temps (la règle d'équipe du module).
- Les vrais services renverront de vraies données depuis Postgres — mais le raisonnement RTT et le partial failure sont identiques.
- Les mesures alimenteront plus tard le traçage distribué (cours 16) : chaque hop devient un span.

**Commit cible :**
```
feat(rpc-client): withTimeout + mesure de latence — aucun appel inter-services sans budget
```
