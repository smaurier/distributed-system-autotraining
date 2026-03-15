# Lab 02 — Communication réseau

## Objectifs
- Comprendre le fonctionnement des protocoles de communication réseau
- Simuler un handshake TCP avec une machine a états
- Mesurer et agreger la latence des appels réseau
- Implementer des timeouts et des pools de connexions
- Combiner retries et timeouts pour la résilience
- Calculer des metriques de diagnostic (error rate, percentiles)

## Exercices
Le fichier `exercise.ts` contient 6 exercices :
1. **Simulation TCP** — simuler un 3-way handshake (SYN, SYN-ACK, ACK) avec machine a états
2. **Mesure de latence** — mesurer et agreger la latence d'appels réseau simules
3. **Implementation de timeout** — implementer un wrapper de timeout avec Promise.race
4. **Pool de connexions** — implementer un pool basique (acquire/release/max connections)
5. **Retry avec timeout** — combiner la logique de retry avec des timeouts par tentative
6. **Diagnostics réseau** — analyser des résultats de requêtes pour calculer error rate, p50, p95, p99

## Instructions
1. Ouvrez `exercise.ts`
2. Trouvez les commentaires `// TODO` et completez le code
3. Executez : `npx tsx exercise.ts`
4. Comparez avec `solution.ts` si besoin

## Criteres de reussite
Tous les tests passent (coches vertes dans la console).
