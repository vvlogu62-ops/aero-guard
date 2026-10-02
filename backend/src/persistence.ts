import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import type {
  OperatorIdentity,
  OperatorRole,
  SystemSnapshot,
} from "@aeroguard/shared";

export interface StoredOperator extends OperatorIdentity {
  passwordHash: string;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  actorEmail: string;
  action: string;
  targetId: string;
  createdAt: string;
  detail: Record<string, unknown>;
}

export interface PersistentState {
  snapshot: SystemSnapshot;
  operators: StoredOperator[];
  audit: AuditEntry[];
  pushTokens: Array<{ token: string; operatorId: string; updatedAt: string }>;
}

const stateKey = "primary";
const localPath = process.env.AEROGUARD_DATA_PATH || resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../data/aeroguard.json",
);
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : undefined,
    })
  : null;
let state: PersistentState;
let writeQueue = Promise.resolve();

function emptyState(snapshot: SystemSnapshot): PersistentState {
  return { snapshot, operators: [], audit: [], pushTokens: [] };
}

async function persist(next: PersistentState) {
  if (pool) {
    await pool.query(
      "INSERT INTO aeroguard_state (state_key, payload) VALUES ($1, $2::jsonb) ON CONFLICT (state_key) DO UPDATE SET payload = EXCLUDED.payload",
      [stateKey, JSON.stringify(next)],
    );
    return;
  }
  await mkdir(dirname(localPath), { recursive: true });
  const temporaryPath = `${localPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(next), "utf8");
  await rename(temporaryPath, localPath);
}

export async function initializePersistence(
  initialSnapshot: SystemSnapshot,
) {
  if (pool) {
    await pool.query(
      "CREATE TABLE IF NOT EXISTS aeroguard_state (state_key TEXT PRIMARY KEY, payload JSONB NOT NULL)",
    );
    const result = await pool.query<{ payload: PersistentState }>(
      "SELECT payload FROM aeroguard_state WHERE state_key = $1",
      [stateKey],
    );
    state = result.rows[0]?.payload ?? emptyState(initialSnapshot);
  } else {
    try {
      state = JSON.parse(await readFile(localPath, "utf8")) as PersistentState;
    } catch {
      state = emptyState(initialSnapshot);
    }
  }

  const email = (process.env.AEROGUARD_ADMIN_EMAIL || "veera@aeroguard.demo")
    .trim()
    .toLowerCase();
  const password = process.env.AEROGUARD_ADMIN_PASSWORD ||
    (process.env.NODE_ENV === "production" ? "" : "VeeraDemo2026!");
  if (!password)
    throw new Error("AEROGUARD_ADMIN_PASSWORD must be configured in production");
  if (!state.operators.some((operator) => operator.email === email)) {
    const admin: StoredOperator = {
      id: randomUUID(),
      email,
      name: process.env.AEROGUARD_ADMIN_NAME || "Veera",
      role: "supervisor",
      passwordHash: await bcrypt.hash(password, 12),
    };
    state = { ...state, operators: [...state.operators, admin] };
  }
  await persist(state);
}

export function currentState() {
  return state;
}

export async function saveState(next: PersistentState) {
  state = next;
  writeQueue = writeQueue.then(() => persist(next));
  await writeQueue;
}

export async function findOperator(email: string, password: string) {
  const operator = state.operators.find(
    (candidate) => candidate.email === email.trim().toLowerCase(),
  );
  if (!operator || !(await bcrypt.compare(password, operator.passwordHash)))
    return null;
  const { passwordHash: _passwordHash, ...identity } = operator;
  return identity;
}

export function listOperators() {
  return state.operators.map(({ passwordHash: _passwordHash, ...identity }) => identity);
}

export async function createOperator(
  operator: Omit<StoredOperator, "id" | "passwordHash">,
  password: string,
) {
  const email = operator.email.trim().toLowerCase();
  if (state.operators.some((candidate) => candidate.email === email))
    throw new Error("An operator with this email already exists");
  const stored: StoredOperator = {
    ...operator,
    id: randomUUID(),
    email,
    passwordHash: await bcrypt.hash(password, 12),
  };
  await saveState({ ...state, operators: [...state.operators, stored] });
  const { passwordHash: _passwordHash, ...identity } = stored;
  return identity;
}

export function hasRole(
  identity: OperatorIdentity,
  roles: readonly OperatorRole[],
) {
  return roles.includes(identity.role);
}

export async function appendAudit(
  actor: OperatorIdentity,
  action: string,
  targetId: string,
  detail: Record<string, unknown> = {},
) {
  const entry: AuditEntry = {
    id: randomUUID(),
    actorId: actor.id,
    actorEmail: actor.email,
    action,
    targetId,
    createdAt: new Date().toISOString(),
    detail,
  };
  await saveState({ ...state, audit: [...state.audit, entry].slice(-1000) });
  return entry;
}

export async function registerPushToken(operatorId: string, token: string) {
  const pushTokens = state.pushTokens.filter((entry) => entry.token !== token);
  pushTokens.push({ token, operatorId, updatedAt: new Date().toISOString() });
  await saveState({ ...state, pushTokens });
}