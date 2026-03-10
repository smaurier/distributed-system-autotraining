// =============================================================================
// Lab 20 — Consensus & Raft (Exercise)
// =============================================================================

import { createTestRunner } from '../test-utils';

const { test, assert, assertEqual, assertGreaterThan, summary } = createTestRunner('Lab 20 — Consensus & Raft');

// =============================================================================
// Exercice 1 : Leader Election
// Implementer l'election de leader Raft avec termes, votes et timeouts aleatoires
// =============================================================================

type NodeRole = 'follower' | 'candidate' | 'leader';

interface RaftNode {
  id: string;
  role: NodeRole;
  currentTerm: number;
  votedFor: string | null;
  log: LogEntry[];
  commitIndex: number;
  peers: string[];
}

interface LogEntry {
  term: number;
  index: number;
  command: string;
}

interface VoteRequest {
  term: number;
  candidateId: string;
  lastLogIndex: number;
  lastLogTerm: number;
}

interface VoteResponse {
  term: number;
  voteGranted: boolean;
}

interface AppendEntriesRequest {
  term: number;
  leaderId: string;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommit: number;
}

interface AppendEntriesResponse {
  term: number;
  success: boolean;
  matchIndex: number;
}

// TODO: Implementer createRaftNode(id: string, peers: string[]): RaftNode
// Creer un noeud Raft en tant que follower au terme 0
function createRaftNode(_id: string, _peers: string[]): RaftNode {
  // TODO
  return null as any;
}

// TODO: Implementer startElection(node: RaftNode): { node: RaftNode; voteRequest: VoteRequest }
// 1. Incrementer le terme
// 2. Passer en candidat
// 3. Voter pour soi-meme
// 4. Creer le VoteRequest avec les infos du dernier log entry
function startElection(_node: RaftNode): { node: RaftNode; voteRequest: VoteRequest } {
  // TODO
  return null as any;
}

// =============================================================================
// Exercice 2 : Vote Handling
// Implementer RequestVote RPC
// =============================================================================

// TODO: Implementer handleVoteRequest(node: RaftNode, request: VoteRequest): { node: RaftNode; response: VoteResponse }
// Accorder le vote si :
// 1. Le terme du candidat >= terme courant
// 2. On n'a pas encore vote pour quelqu'un d'autre dans ce terme
// 3. Le log du candidat est au moins aussi a jour (dernier terme >= et dernier index >=)
// Si le terme du candidat > terme courant, mettre a jour le terme et repasser en follower
function handleVoteRequest(_node: RaftNode, _request: VoteRequest): { node: RaftNode; response: VoteResponse } {
  // TODO
  return null as any;
}

// =============================================================================
// Exercice 3 : Log Replication
// Implementer AppendEntries
// =============================================================================

// TODO: Implementer handleAppendEntries(node: RaftNode, request: AppendEntriesRequest): { node: RaftNode; response: AppendEntriesResponse }
// 1. Si le terme du leader < terme courant, rejeter
// 2. Si le terme du leader >= terme courant, mettre a jour le terme et passer en follower
// 3. Verifier la coherence du log (prevLogIndex et prevLogTerm)
// 4. Ajouter les nouvelles entrees
// 5. Mettre a jour le commitIndex si leaderCommit > commitIndex
function handleAppendEntries(_node: RaftNode, _request: AppendEntriesRequest): { node: RaftNode; response: AppendEntriesResponse } {
  // TODO
  return null as any;
}

// =============================================================================
// Exercice 4 : Commit Detection
// Implementer l'avancement du commit index
// =============================================================================

interface LeaderState {
  node: RaftNode;
  matchIndex: Map<string, number>;
  nextIndex: Map<string, number>;
}

// TODO: Implementer createLeaderState(node: RaftNode): LeaderState
// Initialiser matchIndex a 0 et nextIndex a log.length pour chaque peer
function createLeaderState(_node: RaftNode): LeaderState {
  // TODO
  return null as any;
}

// TODO: Implementer updateCommitIndex(state: LeaderState): LeaderState
// Trouver le plus grand N tel que :
// - N > commitIndex
// - Une majorite de matchIndex[peer] >= N
// - log[N-1].term === currentTerm
// Mettre a jour commitIndex a N
function updateCommitIndex(_state: LeaderState): LeaderState {
  // TODO
  return null as any;
}

// =============================================================================
// Exercice 5 : Distributed Lock with Fencing
// Implementer un service de verrou distribue avec fencing tokens
// =============================================================================

interface LockService {
  acquire(clientId: string, resource: string, ttlMs: number): { granted: boolean; fencingToken?: number; expiresAt?: number };
  release(clientId: string, resource: string, fencingToken: number): boolean;
  validateToken(resource: string, token: number): boolean;
}

// TODO: Implementer createLockService(): LockService
// - acquire: accorder le verrou si pas pris ou expire, avec un fencing token croissant
// - release: liberer si le token correspond
// - validateToken: verifier que le token >= dernier token emis pour cette resource
function createLockService(): LockService {
  // TODO
  return null as any;
}

// =============================================================================
// Exercice 6 : Split Brain Prevention
// Implementer un systeme quorum-based qui refuse les operations sans majorite
// =============================================================================

interface QuorumSystem {
  nodes: Map<string, boolean>; // nodeId -> alive
  totalNodes: number;
  execute(operation: string): { success: boolean; error?: string; quorumSize?: number };
  setNodeStatus(nodeId: string, alive: boolean): void;
  getQuorumSize(): number;
}

// TODO: Implementer createQuorumSystem(nodeIds: string[]): QuorumSystem
// - getQuorumSize: majorite = Math.floor(totalNodes / 2) + 1
// - execute: verifier qu'on a le quorum avant d'executer, sinon refuser
// - setNodeStatus: mettre a jour l'etat d'un noeud
function createQuorumSystem(_nodeIds: string[]): QuorumSystem {
  // TODO
  return null as any;
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('🗳️ Lab 20 — Consensus & Raft\n');

  // --- Tests Exercice 1 : Leader Election ---
  await test('Ex1: creation d\'un noeud Raft', () => {
    const node = createRaftNode('node-1', ['node-2', 'node-3']);
    assertEqual(node.role, 'follower');
    assertEqual(node.currentTerm, 0);
    assertEqual(node.votedFor, null);
    assertEqual(node.log.length, 0);
  });

  await test('Ex1: demarrage d\'election', () => {
    const node = createRaftNode('node-1', ['node-2', 'node-3']);
    const { node: candidate, voteRequest } = startElection(node);
    assertEqual(candidate.role, 'candidate');
    assertEqual(candidate.currentTerm, 1);
    assertEqual(candidate.votedFor, 'node-1');
    assertEqual(voteRequest.term, 1);
    assertEqual(voteRequest.candidateId, 'node-1');
  });

  // --- Tests Exercice 2 : Vote Handling ---
  await test('Ex2: vote accorde au candidat valide', () => {
    const node = createRaftNode('node-2', ['node-1', 'node-3']);
    const request: VoteRequest = { term: 1, candidateId: 'node-1', lastLogIndex: 0, lastLogTerm: 0 };
    const { node: updatedNode, response } = handleVoteRequest(node, request);
    assert(response.voteGranted, 'Vote should be granted');
    assertEqual(updatedNode.votedFor, 'node-1');
    assertEqual(updatedNode.currentTerm, 1);
  });

  await test('Ex2: vote refuse si deja vote', () => {
    let node = createRaftNode('node-2', ['node-1', 'node-3']);
    node = { ...node, currentTerm: 1, votedFor: 'node-3' };
    const request: VoteRequest = { term: 1, candidateId: 'node-1', lastLogIndex: 0, lastLogTerm: 0 };
    const { response } = handleVoteRequest(node, request);
    assert(!response.voteGranted, 'Vote should be denied');
  });

  await test('Ex2: vote accorde si terme superieur', () => {
    let node = createRaftNode('node-2', ['node-1', 'node-3']);
    node = { ...node, currentTerm: 1, votedFor: 'node-3' };
    const request: VoteRequest = { term: 2, candidateId: 'node-1', lastLogIndex: 0, lastLogTerm: 0 };
    const { node: updatedNode, response } = handleVoteRequest(node, request);
    assert(response.voteGranted, 'Vote should be granted for higher term');
    assertEqual(updatedNode.currentTerm, 2);
    assertEqual(updatedNode.votedFor, 'node-1');
  });

  // --- Tests Exercice 3 : Log Replication ---
  await test('Ex3: append entries accepte', () => {
    const node = createRaftNode('node-2', ['node-1', 'node-3']);
    const request: AppendEntriesRequest = {
      term: 1, leaderId: 'node-1', prevLogIndex: 0, prevLogTerm: 0,
      entries: [{ term: 1, index: 1, command: 'SET x=1' }], leaderCommit: 0
    };
    const { node: updated, response } = handleAppendEntries(node, request);
    assert(response.success, 'Should accept entries');
    assertEqual(updated.log.length, 1);
    assertEqual(updated.currentTerm, 1);
    assertEqual(response.matchIndex, 1);
  });

  await test('Ex3: append entries rejete si terme inferieur', () => {
    let node = createRaftNode('node-2', ['node-1', 'node-3']);
    node = { ...node, currentTerm: 2 };
    const request: AppendEntriesRequest = {
      term: 1, leaderId: 'node-1', prevLogIndex: 0, prevLogTerm: 0,
      entries: [], leaderCommit: 0
    };
    const { response } = handleAppendEntries(node, request);
    assert(!response.success, 'Should reject stale term');
  });

  await test('Ex3: commit index mis a jour', () => {
    const node = createRaftNode('node-2', ['node-1', 'node-3']);
    const request: AppendEntriesRequest = {
      term: 1, leaderId: 'node-1', prevLogIndex: 0, prevLogTerm: 0,
      entries: [{ term: 1, index: 1, command: 'SET x=1' }], leaderCommit: 1
    };
    const { node: updated } = handleAppendEntries(node, request);
    assertEqual(updated.commitIndex, 1);
  });

  // --- Tests Exercice 4 : Commit Detection ---
  await test('Ex4: commit index avance avec majorite', () => {
    let node = createRaftNode('node-1', ['node-2', 'node-3', 'node-4', 'node-5']);
    node = {
      ...node,
      role: 'leader',
      currentTerm: 1,
      log: [
        { term: 1, index: 1, command: 'SET x=1' },
        { term: 1, index: 2, command: 'SET y=2' },
      ],
      commitIndex: 0,
    };
    const state = createLeaderState(node);
    state.matchIndex.set('node-2', 2);
    state.matchIndex.set('node-3', 2);
    state.matchIndex.set('node-4', 1);
    state.matchIndex.set('node-5', 0);
    const updated = updateCommitIndex(state);
    assertEqual(updated.node.commitIndex, 2);
  });

  await test('Ex4: commit index n\'avance pas sans majorite', () => {
    let node = createRaftNode('node-1', ['node-2', 'node-3', 'node-4', 'node-5']);
    node = {
      ...node,
      role: 'leader',
      currentTerm: 1,
      log: [{ term: 1, index: 1, command: 'SET x=1' }],
      commitIndex: 0,
    };
    const state = createLeaderState(node);
    state.matchIndex.set('node-2', 1);
    state.matchIndex.set('node-3', 0);
    state.matchIndex.set('node-4', 0);
    state.matchIndex.set('node-5', 0);
    const updated = updateCommitIndex(state);
    assertEqual(updated.node.commitIndex, 0);
  });

  // --- Tests Exercice 5 : Distributed Lock with Fencing ---
  await test('Ex5: acquisition et release de verrou', () => {
    const locks = createLockService();
    const result = locks.acquire('client-1', 'resource-A', 5000);
    assert(result.granted, 'Lock should be granted');
    assert(result.fencingToken !== undefined, 'Should have fencing token');
    assertEqual(result.fencingToken, 1);
    const released = locks.release('client-1', 'resource-A', 1);
    assert(released, 'Lock should be released');
  });

  await test('Ex5: fencing token croissant', () => {
    const locks = createLockService();
    const r1 = locks.acquire('client-1', 'resource-A', 5000);
    locks.release('client-1', 'resource-A', r1.fencingToken!);
    const r2 = locks.acquire('client-2', 'resource-A', 5000);
    assertGreaterThan(r2.fencingToken!, r1.fencingToken!);
  });

  await test('Ex5: verrou refuse si deja pris', () => {
    const locks = createLockService();
    locks.acquire('client-1', 'resource-A', 5000);
    const r2 = locks.acquire('client-2', 'resource-A', 5000);
    assert(!r2.granted, 'Lock should be denied');
  });

  await test('Ex5: validation du fencing token', () => {
    const locks = createLockService();
    const r1 = locks.acquire('client-1', 'resource-A', 5000);
    assert(locks.validateToken('resource-A', r1.fencingToken!), 'Current token should be valid');
    assert(!locks.validateToken('resource-A', r1.fencingToken! - 1), 'Old token should be invalid');
  });

  // --- Tests Exercice 6 : Split Brain Prevention ---
  await test('Ex6: operation reussit avec quorum', () => {
    const qs = createQuorumSystem(['n1', 'n2', 'n3', 'n4', 'n5']);
    const result = qs.execute('SET x=1');
    assert(result.success, 'Should succeed with full quorum');
    assertEqual(qs.getQuorumSize(), 3);
  });

  await test('Ex6: operation refuse sans quorum', () => {
    const qs = createQuorumSystem(['n1', 'n2', 'n3', 'n4', 'n5']);
    qs.setNodeStatus('n1', false);
    qs.setNodeStatus('n2', false);
    qs.setNodeStatus('n3', false);
    const result = qs.execute('SET x=1');
    assert(!result.success, 'Should fail without quorum');
  });

  await test('Ex6: operation reussit avec majorite exacte', () => {
    const qs = createQuorumSystem(['n1', 'n2', 'n3', 'n4', 'n5']);
    qs.setNodeStatus('n4', false);
    qs.setNodeStatus('n5', false);
    const result = qs.execute('SET x=1');
    assert(result.success, 'Should succeed with exact majority');
  });

  summary();
}

main();
