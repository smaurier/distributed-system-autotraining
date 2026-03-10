// =============================================================================
// Lab 20 — Consensus & Raft (Solution)
// =============================================================================

import { createTestRunner } from '../test-utils';

const { test, assert, assertEqual, assertGreaterThan, summary } = createTestRunner('Lab 20 — Consensus & Raft');

// =============================================================================
// Exercice 1 : Leader Election
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

function createRaftNode(id: string, peers: string[]): RaftNode {
  return {
    id,
    role: 'follower',
    currentTerm: 0,
    votedFor: null,
    log: [],
    commitIndex: 0,
    peers: [...peers],
  };
}

function startElection(node: RaftNode): { node: RaftNode; voteRequest: VoteRequest } {
  const newTerm = node.currentTerm + 1;
  const lastLogIndex = node.log.length;
  const lastLogTerm = node.log.length > 0 ? node.log[node.log.length - 1].term : 0;

  const updatedNode: RaftNode = {
    ...node,
    currentTerm: newTerm,
    role: 'candidate',
    votedFor: node.id,
  };

  const voteRequest: VoteRequest = {
    term: newTerm,
    candidateId: node.id,
    lastLogIndex,
    lastLogTerm,
  };

  return { node: updatedNode, voteRequest };
}

// =============================================================================
// Exercice 2 : Vote Handling
// =============================================================================

function handleVoteRequest(node: RaftNode, request: VoteRequest): { node: RaftNode; response: VoteResponse } {
  let updatedNode = { ...node };

  // If candidate's term is higher, update our term and become follower
  if (request.term > updatedNode.currentTerm) {
    updatedNode.currentTerm = request.term;
    updatedNode.votedFor = null;
    updatedNode.role = 'follower';
  }

  // Reject if candidate's term is lower
  if (request.term < updatedNode.currentTerm) {
    return { node: updatedNode, response: { term: updatedNode.currentTerm, voteGranted: false } };
  }

  // Check if we can vote for this candidate
  const canVote = updatedNode.votedFor === null || updatedNode.votedFor === request.candidateId;

  // Check if candidate's log is at least as up-to-date
  const lastLogTerm = updatedNode.log.length > 0 ? updatedNode.log[updatedNode.log.length - 1].term : 0;
  const lastLogIndex = updatedNode.log.length;
  const logUpToDate = request.lastLogTerm > lastLogTerm ||
    (request.lastLogTerm === lastLogTerm && request.lastLogIndex >= lastLogIndex);

  if (canVote && logUpToDate) {
    updatedNode.votedFor = request.candidateId;
    return { node: updatedNode, response: { term: updatedNode.currentTerm, voteGranted: true } };
  }

  return { node: updatedNode, response: { term: updatedNode.currentTerm, voteGranted: false } };
}

// =============================================================================
// Exercice 3 : Log Replication
// =============================================================================

function handleAppendEntries(node: RaftNode, request: AppendEntriesRequest): { node: RaftNode; response: AppendEntriesResponse } {
  let updatedNode = { ...node, log: [...node.log] };

  // Reject if leader's term is less than current term
  if (request.term < updatedNode.currentTerm) {
    return {
      node: updatedNode,
      response: { term: updatedNode.currentTerm, success: false, matchIndex: 0 }
    };
  }

  // Update term and become follower
  updatedNode.currentTerm = request.term;
  updatedNode.role = 'follower';
  updatedNode.votedFor = null;

  // Check log consistency
  if (request.prevLogIndex > 0) {
    if (updatedNode.log.length < request.prevLogIndex) {
      return {
        node: updatedNode,
        response: { term: updatedNode.currentTerm, success: false, matchIndex: 0 }
      };
    }
    const prevEntry = updatedNode.log[request.prevLogIndex - 1];
    if (prevEntry && prevEntry.term !== request.prevLogTerm) {
      return {
        node: updatedNode,
        response: { term: updatedNode.currentTerm, success: false, matchIndex: 0 }
      };
    }
  }

  // Append new entries (remove conflicting entries first)
  if (request.entries.length > 0) {
    const startIndex = request.prevLogIndex;
    updatedNode.log = updatedNode.log.slice(0, startIndex);
    updatedNode.log.push(...request.entries);
  }

  // Update commit index
  if (request.leaderCommit > updatedNode.commitIndex) {
    updatedNode.commitIndex = Math.min(request.leaderCommit, updatedNode.log.length);
  }

  return {
    node: updatedNode,
    response: { term: updatedNode.currentTerm, success: true, matchIndex: updatedNode.log.length }
  };
}

// =============================================================================
// Exercice 4 : Commit Detection
// =============================================================================

interface LeaderState {
  node: RaftNode;
  matchIndex: Map<string, number>;
  nextIndex: Map<string, number>;
}

function createLeaderState(node: RaftNode): LeaderState {
  const matchIndex = new Map<string, number>();
  const nextIndex = new Map<string, number>();
  for (const peer of node.peers) {
    matchIndex.set(peer, 0);
    nextIndex.set(peer, node.log.length + 1);
  }
  return { node: { ...node }, matchIndex, nextIndex };
}

function updateCommitIndex(state: LeaderState): LeaderState {
  const updatedState = { ...state, node: { ...state.node } };
  const logLength = updatedState.node.log.length;

  for (let n = logLength; n > updatedState.node.commitIndex; n--) {
    // Check that the entry is from the current term
    if (updatedState.node.log[n - 1].term !== updatedState.node.currentTerm) continue;

    // Count how many nodes have replicated up to index n (including the leader)
    let replicatedCount = 1; // leader itself
    for (const peer of updatedState.node.peers) {
      if ((updatedState.matchIndex.get(peer) || 0) >= n) {
        replicatedCount++;
      }
    }

    // Check if majority
    const totalNodes = updatedState.node.peers.length + 1;
    if (replicatedCount > totalNodes / 2) {
      updatedState.node.commitIndex = n;
      break;
    }
  }

  return updatedState;
}

// =============================================================================
// Exercice 5 : Distributed Lock with Fencing
// =============================================================================

interface LockService {
  acquire(clientId: string, resource: string, ttlMs: number): { granted: boolean; fencingToken?: number; expiresAt?: number };
  release(clientId: string, resource: string, fencingToken: number): boolean;
  validateToken(resource: string, token: number): boolean;
}

function createLockService(): LockService {
  const locks = new Map<string, { clientId: string; fencingToken: number; expiresAt: number }>();
  let nextToken = 1;

  return {
    acquire(clientId: string, resource: string, ttlMs: number) {
      const existing = locks.get(resource);
      if (existing && existing.expiresAt > Date.now()) {
        return { granted: false };
      }
      const fencingToken = nextToken++;
      const expiresAt = Date.now() + ttlMs;
      locks.set(resource, { clientId, fencingToken, expiresAt });
      return { granted: true, fencingToken, expiresAt };
    },

    release(clientId: string, resource: string, fencingToken: number) {
      const existing = locks.get(resource);
      if (!existing) return false;
      if (existing.clientId !== clientId || existing.fencingToken !== fencingToken) return false;
      locks.delete(resource);
      return true;
    },

    validateToken(resource: string, token: number) {
      const existing = locks.get(resource);
      if (!existing) return token >= nextToken - 1;
      return token >= existing.fencingToken;
    },
  };
}

// =============================================================================
// Exercice 6 : Split Brain Prevention
// =============================================================================

interface QuorumSystem {
  nodes: Map<string, boolean>;
  totalNodes: number;
  execute(operation: string): { success: boolean; error?: string; quorumSize?: number };
  setNodeStatus(nodeId: string, alive: boolean): void;
  getQuorumSize(): number;
}

function createQuorumSystem(nodeIds: string[]): QuorumSystem {
  const nodes = new Map<string, boolean>();
  for (const id of nodeIds) {
    nodes.set(id, true);
  }
  const totalNodes = nodeIds.length;

  return {
    nodes,
    totalNodes,

    getQuorumSize(): number {
      return Math.floor(totalNodes / 2) + 1;
    },

    setNodeStatus(nodeId: string, alive: boolean): void {
      if (nodes.has(nodeId)) {
        nodes.set(nodeId, alive);
      }
    },

    execute(operation: string): { success: boolean; error?: string; quorumSize?: number } {
      let aliveCount = 0;
      for (const [, alive] of nodes) {
        if (alive) aliveCount++;
      }
      const quorumSize = this.getQuorumSize();
      if (aliveCount < quorumSize) {
        return {
          success: false,
          error: `No quorum: ${aliveCount}/${totalNodes} alive, need ${quorumSize}`,
          quorumSize,
        };
      }
      return { success: true, quorumSize };
    },
  };
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
