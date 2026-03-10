// =============================================================================
// Lab 04 — Serialisation & Validation Zod (Exercice)
// =============================================================================

import { createTestRunner } from '../test-utils.js';

const { test, assert, assertEqual, assertDeepEqual, assertThrows, summary } = createTestRunner('Lab 04 — Serialisation & Validation');

// =============================================================================
// Exercice 1 : Pieges de la serialisation JSON
// JSON.stringify a des limites : Date devient string, BigInt lance une erreur,
// undefined est supprime. Creer un serialiseur safe.
//
// safeSerialize : utilise un replacer pour encoder Date, BigInt, undefined
// avec des objets { __type, value }
// safeDeserialize : utilise un reviver pour decoder ces objets speciaux
// =============================================================================

interface SafeSerializeOptions {
  handleDates?: boolean;
  handleBigInt?: boolean;
  handleUndefined?: boolean;
}

function safeSerialize(data: unknown, options: SafeSerializeOptions = {}): string {
  // TODO: Utiliser JSON.stringify avec un replacer :
  // - Date -> { __type: 'Date', value: isoString }
  // - BigInt -> { __type: 'BigInt', value: string }
  // - undefined -> { __type: 'undefined' }
  // Les options (defaut true) controlent quels types sont geres
  throw new Error('Not implemented');
}

function safeDeserialize(json: string): unknown {
  // TODO: Utiliser JSON.parse avec un reviver :
  // - { __type: 'Date', value } -> new Date(value)
  // - { __type: 'BigInt', value } -> BigInt(value)
  // - { __type: 'undefined' } -> undefined
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 2 : Definition de schema
// Definir des interfaces TypeScript pour Order et Payment, avec une
// fonction de validation simple.
// =============================================================================

interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

interface Order {
  id: string;
  customerId: string;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'confirmed' | 'shipped' | 'delivered';
  createdAt: string;
}

interface Payment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  method: 'card' | 'bank_transfer' | 'crypto';
  status: 'pending' | 'completed' | 'failed';
}

function validateOrder(data: unknown): { valid: boolean; errors: string[] } {
  // TODO: Valider que data est un objet contenant :
  // - id: string (requis)
  // - customerId: string (requis)
  // - items: array non vide
  // - total: number >= 0
  // - status: un de 'pending', 'confirmed', 'shipped', 'delivered'
  // - createdAt: string (requis)
  // Retourner { valid: true/false, errors: [...messages] }
  throw new Error('Not implemented');
}

function validatePayment(data: unknown): { valid: boolean; errors: string[] } {
  // TODO: Valider que data est un objet contenant :
  // - id: string (requis)
  // - orderId: string (requis)
  // - amount: number > 0
  // - currency: string (requis)
  // - method: 'card' | 'bank_transfer' | 'crypto'
  // - status: 'pending' | 'completed' | 'failed'
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 3 : Validation runtime
// Implementer une fonction de validation generique qui verifie des regles.
//
// Types de regles :
// - required : le champ ne doit pas etre undefined/null/''
// - type : typeof fieldValue doit correspondre a rule.value
// - min : fieldValue >= rule.value (pour les nombres)
// - max : fieldValue <= rule.value (pour les nombres)
// - enum : fieldValue doit etre dans rule.value (tableau)
// - pattern : fieldValue doit matcher rule.value (RegExp)
// =============================================================================

type ValidationRule = {
  field: string;
  type: 'required' | 'type' | 'min' | 'max' | 'enum' | 'pattern';
  value?: unknown;
  message?: string;
};

function validate(data: Record<string, unknown>, rules: ValidationRule[]): { valid: boolean; errors: string[] } {
  // TODO: Parcourir les regles et verifier chacune
  // Utiliser rule.message si fourni, sinon generer un message par defaut
  // Retourner { valid: erreurs.length === 0, errors }
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 4 : Versioning de schema
// Implementer des schemas V1 et V2 avec une fonction de migration.
//
// V1 : { version: 1, id, customer, amount, date }
// V2 : { version: 2, id, customerId, customerEmail?, total, currency, createdAt, updatedAt }
//
// Migration V1->V2 :
// - customer -> customerId
// - amount -> total
// - date -> createdAt et updatedAt
// - currency = 'EUR' par defaut
// =============================================================================

interface OrderV1 {
  version: 1;
  id: string;
  customer: string;
  amount: number;
  date: string;
}

interface OrderV2 {
  version: 2;
  id: string;
  customerId: string;
  customerEmail?: string;
  total: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

function migrateV1toV2(v1: OrderV1): OrderV2 {
  // TODO: Transformer un OrderV1 en OrderV2 selon les regles ci-dessus
  throw new Error('Not implemented');
}

function detectVersion(data: Record<string, unknown>): number {
  // TODO: Detecter la version du schema
  // - Si data.version existe et est un number, le retourner
  // - Sinon, heuristique : 'customer'+'amount' -> 1, 'customerId'+'total' -> 2
  // - Sinon retourner 0
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 5 : Breaking vs non-breaking changes
// Categoriser une liste de changements de schema.
//
// Non-breaking : add_optional_field, add_enum_value
// Breaking : add_required_field, remove_field, rename_field, change_type, remove_enum_value
// =============================================================================

interface SchemaChange {
  description: string;
  type: 'add_optional_field' | 'add_required_field' | 'remove_field' | 'rename_field' | 'change_type' | 'add_enum_value' | 'remove_enum_value';
}

interface ChangeClassification {
  change: SchemaChange;
  breaking: boolean;
  reason: string;
}

function classifyChanges(changes: SchemaChange[]): ChangeClassification[] {
  // TODO: Pour chaque changement, retourner { change, breaking, reason }
  // Suivre les regles de classification ci-dessus
  throw new Error('Not implemented');
}

// =============================================================================
// Exercice 6 : Contract testing
// Implementer un verificateur de contrat consumer-driven.
//
// Un contrat definit les champs attendus par le consumer.
// Le provider a un schema avec des champs.
// Verifier que le provider satisfait le contrat :
// - Champs requis presents
// - Types correspondants
// =============================================================================

interface ContractField {
  name: string;
  type: string;
  required: boolean;
}

interface ConsumerContract {
  consumerName: string;
  providerName: string;
  expectedFields: ContractField[];
}

interface ProviderSchema {
  name: string;
  fields: { name: string; type: string }[];
}

interface ContractVerificationResult {
  consumerName: string;
  providerName: string;
  satisfied: boolean;
  missingFields: string[];
  typeMismatches: string[];
}

function verifyContract(contract: ConsumerContract, provider: ProviderSchema): ContractVerificationResult {
  // TODO: Verifier le contrat :
  // - Pour chaque champ attendu par le consumer :
  //   - S'il est requis et absent du provider -> ajouter a missingFields
  //   - Si present mais avec un type different -> ajouter a typeMismatches
  // - satisfied = pas de missingFields et pas de typeMismatches
  throw new Error('Not implemented');
}

// =============================================================================
// Tests
// =============================================================================

async function main() {
  console.log('\n🔬 Lab 04 — Serialisation & Validation\n');

  // --- Exercice 1 ---
  await test('Ex1: safeSerialize gere les Dates', () => {
    const data = { created: new Date('2024-01-15T10:00:00Z') };
    const json = safeSerialize(data);
    const parsed = safeDeserialize(json) as Record<string, unknown>;
    assert(parsed.created instanceof Date, 'Should deserialize back to Date');
    assertEqual((parsed.created as Date).toISOString(), '2024-01-15T10:00:00.000Z');
  });

  await test('Ex1: safeSerialize gere BigInt', () => {
    const data = { big: BigInt('9007199254740993') };
    const json = safeSerialize(data);
    const parsed = safeDeserialize(json) as Record<string, unknown>;
    assertEqual(typeof parsed.big, 'bigint');
    assertEqual(parsed.big, BigInt('9007199254740993'));
  });

  // --- Exercice 2 ---
  await test('Ex2: validateOrder accepte une commande valide', () => {
    const order = {
      id: 'ORD-1', customerId: 'C-1', items: [{ productId: 'P1', name: 'Book', quantity: 1, unitPrice: 10 }],
      total: 10, status: 'pending', createdAt: '2024-01-15',
    };
    const result = validateOrder(order);
    assertEqual(result.valid, true);
    assertEqual(result.errors.length, 0);
  });

  await test('Ex2: validateOrder rejette une commande invalide', () => {
    const result = validateOrder({ id: 123, items: [] });
    assertEqual(result.valid, false);
    assert(result.errors.length > 0, 'Should have errors');
  });

  // --- Exercice 3 ---
  await test('Ex3: validate verifie les regles required et type', () => {
    const rules: ValidationRule[] = [
      { field: 'name', type: 'required' },
      { field: 'age', type: 'type', value: 'number' },
    ];
    const r1 = validate({ name: 'Alice', age: 30 }, rules);
    assertEqual(r1.valid, true);
    const r2 = validate({ age: 'not a number' }, rules);
    assertEqual(r2.valid, false);
    assert(r2.errors.length >= 2, 'Should have at least 2 errors');
  });

  await test('Ex3: validate verifie min, max et enum', () => {
    const rules: ValidationRule[] = [
      { field: 'price', type: 'min', value: 0 },
      { field: 'price', type: 'max', value: 1000 },
      { field: 'status', type: 'enum', value: ['active', 'inactive'] },
    ];
    const r1 = validate({ price: 50, status: 'active' }, rules);
    assertEqual(r1.valid, true);
    const r2 = validate({ price: -1, status: 'deleted' }, rules);
    assertEqual(r2.valid, false);
    assertEqual(r2.errors.length, 2);
  });

  // --- Exercice 4 ---
  await test('Ex4: migrateV1toV2 migre correctement', () => {
    const v1: OrderV1 = { version: 1, id: 'O-1', customer: 'C-1', amount: 100, date: '2024-01-15' };
    const v2 = migrateV1toV2(v1);
    assertEqual(v2.version, 2);
    assertEqual(v2.customerId, 'C-1');
    assertEqual(v2.total, 100);
    assertEqual(v2.currency, 'EUR');
    assertEqual(v2.createdAt, '2024-01-15');
  });

  await test('Ex4: detectVersion detecte V1 et V2', () => {
    assertEqual(detectVersion({ version: 1, customer: 'C', amount: 10 }), 1);
    assertEqual(detectVersion({ version: 2, customerId: 'C', total: 10 }), 2);
    assertEqual(detectVersion({ customer: 'C', amount: 10 }), 1);
    assertEqual(detectVersion({ customerId: 'C', total: 10 }), 2);
  });

  // --- Exercice 5 ---
  await test('Ex5: classifyChanges identifie les changements breaking', () => {
    const changes: SchemaChange[] = [
      { description: 'Add optional email field', type: 'add_optional_field' },
      { description: 'Remove legacy name field', type: 'remove_field' },
      { description: 'Add required phone field', type: 'add_required_field' },
    ];
    const classified = classifyChanges(changes);
    assertEqual(classified[0].breaking, false);
    assertEqual(classified[1].breaking, true);
    assertEqual(classified[2].breaking, true);
  });

  await test('Ex5: classifyChanges classe rename et change_type comme breaking', () => {
    const changes: SchemaChange[] = [
      { description: 'Rename user to userId', type: 'rename_field' },
      { description: 'Change price from string to number', type: 'change_type' },
      { description: 'Add new status value', type: 'add_enum_value' },
    ];
    const classified = classifyChanges(changes);
    assertEqual(classified[0].breaking, true);
    assertEqual(classified[1].breaking, true);
    assertEqual(classified[2].breaking, false);
  });

  // --- Exercice 6 ---
  await test('Ex6: verifyContract detecte un contrat satisfait', () => {
    const contract: ConsumerContract = {
      consumerName: 'frontend', providerName: 'user-api',
      expectedFields: [
        { name: 'id', type: 'string', required: true },
        { name: 'name', type: 'string', required: true },
      ],
    };
    const provider: ProviderSchema = {
      name: 'user-api',
      fields: [
        { name: 'id', type: 'string' }, { name: 'name', type: 'string' }, { name: 'email', type: 'string' },
      ],
    };
    const result = verifyContract(contract, provider);
    assertEqual(result.satisfied, true);
    assertEqual(result.missingFields.length, 0);
  });

  await test('Ex6: verifyContract detecte les champs manquants et types errones', () => {
    const contract: ConsumerContract = {
      consumerName: 'mobile', providerName: 'order-api',
      expectedFields: [
        { name: 'id', type: 'string', required: true },
        { name: 'total', type: 'number', required: true },
        { name: 'notes', type: 'string', required: false },
      ],
    };
    const provider: ProviderSchema = {
      name: 'order-api',
      fields: [{ name: 'id', type: 'number' }],
    };
    const result = verifyContract(contract, provider);
    assertEqual(result.satisfied, false);
    assertEqual(result.missingFields.length, 1);
    assert(result.missingFields.includes('total'), 'Should miss total');
    assertEqual(result.typeMismatches.length, 1);
  });

  summary();
}

main();
