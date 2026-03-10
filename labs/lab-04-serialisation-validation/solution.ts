// =============================================================================
// Lab 04 — Serialisation & Validation Zod (Solution)
// =============================================================================

import { createTestRunner } from '../test-utils.js';

const { test, assert, assertEqual, assertDeepEqual, assertThrows, summary } = createTestRunner('Lab 04 — Serialisation & Validation');

// =============================================================================
// Exercice 1 : Pieges de la serialisation JSON
// JSON.stringify a des limites : Date devient string, BigInt lance une erreur,
// undefined est supprime. Creer un serialiseur safe.
// =============================================================================

interface SafeSerializeOptions {
  handleDates?: boolean;
  handleBigInt?: boolean;
  handleUndefined?: boolean;
}

function safeSerialize(data: unknown, options: SafeSerializeOptions = {}): string {
  const { handleDates = true, handleBigInt = true, handleUndefined = true } = options;

  return JSON.stringify(data, function (key, value) {
    // Use `this[key]` to get the raw value before toJSON() conversion
    const rawValue = this[key];
    if (handleDates && rawValue instanceof Date) {
      return { __type: 'Date', value: rawValue.toISOString() };
    }
    if (handleBigInt && typeof rawValue === 'bigint') {
      return { __type: 'BigInt', value: rawValue.toString() };
    }
    if (handleUndefined && rawValue === undefined) {
      return { __type: 'undefined' };
    }
    return value;
  });
}

function safeDeserialize(json: string): unknown {
  return JSON.parse(json, (_key, value) => {
    if (value && typeof value === 'object' && '__type' in value) {
      switch (value.__type) {
        case 'Date': return new Date(value.value);
        case 'BigInt': return BigInt(value.value);
        case 'undefined': return undefined;
      }
    }
    return value;
  });
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
  const errors: string[] = [];
  if (!data || typeof data !== 'object') return { valid: false, errors: ['Data must be an object'] };

  const obj = data as Record<string, unknown>;

  if (!obj.id || typeof obj.id !== 'string') errors.push('id is required and must be a string');
  if (!obj.customerId || typeof obj.customerId !== 'string') errors.push('customerId is required and must be a string');
  if (!Array.isArray(obj.items)) errors.push('items must be an array');
  else if (obj.items.length === 0) errors.push('items must not be empty');
  if (typeof obj.total !== 'number' || obj.total < 0) errors.push('total must be a non-negative number');
  if (!['pending', 'confirmed', 'shipped', 'delivered'].includes(obj.status as string)) {
    errors.push('status must be one of: pending, confirmed, shipped, delivered');
  }
  if (!obj.createdAt || typeof obj.createdAt !== 'string') errors.push('createdAt is required and must be a string');

  return { valid: errors.length === 0, errors };
}

function validatePayment(data: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== 'object') return { valid: false, errors: ['Data must be an object'] };

  const obj = data as Record<string, unknown>;

  if (!obj.id || typeof obj.id !== 'string') errors.push('id is required and must be a string');
  if (!obj.orderId || typeof obj.orderId !== 'string') errors.push('orderId is required and must be a string');
  if (typeof obj.amount !== 'number' || obj.amount <= 0) errors.push('amount must be a positive number');
  if (!obj.currency || typeof obj.currency !== 'string') errors.push('currency is required and must be a string');
  if (!['card', 'bank_transfer', 'crypto'].includes(obj.method as string)) {
    errors.push('method must be one of: card, bank_transfer, crypto');
  }
  if (!['pending', 'completed', 'failed'].includes(obj.status as string)) {
    errors.push('status must be one of: pending, completed, failed');
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// Exercice 3 : Validation runtime
// Implementer une fonction de validation generique qui verifie des regles.
// =============================================================================

type ValidationRule = {
  field: string;
  type: 'required' | 'type' | 'min' | 'max' | 'enum' | 'pattern';
  value?: unknown;
  message?: string;
};

function validate(data: Record<string, unknown>, rules: ValidationRule[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const rule of rules) {
    const fieldValue = data[rule.field];

    switch (rule.type) {
      case 'required':
        if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
          errors.push(rule.message || `${rule.field} is required`);
        }
        break;
      case 'type':
        if (fieldValue !== undefined && fieldValue !== null && typeof fieldValue !== rule.value) {
          errors.push(rule.message || `${rule.field} must be of type ${rule.value}`);
        }
        break;
      case 'min':
        if (typeof fieldValue === 'number' && fieldValue < (rule.value as number)) {
          errors.push(rule.message || `${rule.field} must be >= ${rule.value}`);
        }
        break;
      case 'max':
        if (typeof fieldValue === 'number' && fieldValue > (rule.value as number)) {
          errors.push(rule.message || `${rule.field} must be <= ${rule.value}`);
        }
        break;
      case 'enum':
        if (fieldValue !== undefined && !(rule.value as unknown[]).includes(fieldValue)) {
          errors.push(rule.message || `${rule.field} must be one of: ${(rule.value as unknown[]).join(', ')}`);
        }
        break;
      case 'pattern':
        if (typeof fieldValue === 'string' && !(rule.value as RegExp).test(fieldValue)) {
          errors.push(rule.message || `${rule.field} does not match pattern`);
        }
        break;
    }
  }

  return { valid: errors.length === 0, errors };
}

// =============================================================================
// Exercice 4 : Versioning de schema
// Implementer des schemas V1 et V2 avec une fonction de migration.
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
  return {
    version: 2,
    id: v1.id,
    customerId: v1.customer,
    customerEmail: undefined,
    total: v1.amount,
    currency: 'EUR',
    createdAt: v1.date,
    updatedAt: v1.date,
  };
}

function detectVersion(data: Record<string, unknown>): number {
  if (data.version && typeof data.version === 'number') return data.version;
  // Heuristic: V1 has 'customer' and 'amount', V2 has 'customerId' and 'total'
  if ('customer' in data && 'amount' in data) return 1;
  if ('customerId' in data && 'total' in data) return 2;
  return 0;
}

// =============================================================================
// Exercice 5 : Breaking vs non-breaking changes
// Categoriser une liste de changements de schema.
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
  return changes.map(change => {
    switch (change.type) {
      case 'add_optional_field':
        return { change, breaking: false, reason: 'Adding optional fields is backward compatible' };
      case 'add_required_field':
        return { change, breaking: true, reason: 'Existing consumers do not send this field' };
      case 'remove_field':
        return { change, breaking: true, reason: 'Existing consumers may depend on this field' };
      case 'rename_field':
        return { change, breaking: true, reason: 'Existing consumers reference the old field name' };
      case 'change_type':
        return { change, breaking: true, reason: 'Existing consumers expect the old type' };
      case 'add_enum_value':
        return { change, breaking: false, reason: 'New enum values do not affect existing consumers' };
      case 'remove_enum_value':
        return { change, breaking: true, reason: 'Existing consumers may use the removed value' };
      default:
        return { change, breaking: true, reason: 'Unknown change type is assumed breaking' };
    }
  });
}

// =============================================================================
// Exercice 6 : Contract testing
// Implementer un verificateur de contrat consumer-driven.
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
  const missingFields: string[] = [];
  const typeMismatches: string[] = [];

  for (const expected of contract.expectedFields) {
    const providerField = provider.fields.find(f => f.name === expected.name);

    if (!providerField) {
      if (expected.required) {
        missingFields.push(expected.name);
      }
    } else if (providerField.type !== expected.type) {
      typeMismatches.push(`${expected.name}: expected ${expected.type}, got ${providerField.type}`);
    }
  }

  return {
    consumerName: contract.consumerName,
    providerName: contract.providerName,
    satisfied: missingFields.length === 0 && typeMismatches.length === 0,
    missingFields,
    typeMismatches,
  };
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
