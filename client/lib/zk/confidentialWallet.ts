/**
 * Persists a user's own confidential-ledger secret (balance + blinding factor)
 * across sessions (Phase 4).
 *
 * Unlike the auditor view-key (shared with someone else), this secret is the
 * user's OWN access to their funds — losing it means losing access to that
 * confidential balance, similar to a wallet seed phrase. Stored in
 * localStorage for convenience, but every balance-changing action must also
 * trigger downloadWalletBackup() so a cleared cache never silently loses funds.
 */

export interface ConfidentialWalletRecord {
  account: string;             // Stellar address
  token: string;                // token contract address
  balance: string;              // bigint as decimal string (token base units)
  blinding: string;             // bigint as decimal string
  commitmentDecimal: string;    // current on-chain commitment — Poseidon(balance, blinding)
  updatedAt: string;            // ISO timestamp
}

function storageKey(account: string, token: string): string {
  return `payfurt:confidential:${account}:${token}`;
}

export function loadWalletRecord(account: string, token: string): ConfidentialWalletRecord | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(storageKey(account, token));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConfidentialWalletRecord;
  } catch {
    return null;
  }
}

export function saveWalletRecord(record: ConfidentialWalletRecord): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(record.account, record.token), JSON.stringify(record));
}

/** Triggers a browser download of the wallet record as a JSON backup file. */
export function downloadWalletBackup(record: ConfidentialWalletRecord): void {
  const json = JSON.stringify(record, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payfurt-confidential-wallet-${record.account.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Parses and validates an uploaded backup file's contents. */
export function parseWalletBackupFile(json: string): ConfidentialWalletRecord {
  const record = JSON.parse(json) as Partial<ConfidentialWalletRecord>;
  if (!record.account || !record.token || !record.balance || !record.blinding || !record.commitmentDecimal) {
    throw new Error("Invalid backup file — missing required fields");
  }
  return record as ConfidentialWalletRecord;
}

// ── Auto-receive viewing key (account-wide) ──────────────────────────────────
//
// The x25519 viewing key lets a recipient auto-decrypt encrypted payroll notes.
// It is fund-critical when an employer pays via auto-receive only: losing it
// means the encrypted note can't be opened. Backed up like the wallet record.

export interface ViewingKeyRecord {
  account: string;
  privateKeyHex: string;
  publicKeyHex: string;
}

function viewingStorageKey(account: string): string {
  return `payfurt:viewing:${account}`;
}

export function loadViewingKey(account: string): ViewingKeyRecord | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(viewingStorageKey(account));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ViewingKeyRecord;
  } catch {
    return null;
  }
}

export function saveViewingKey(record: ViewingKeyRecord): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(viewingStorageKey(record.account), JSON.stringify(record));
}

export function downloadViewingKeyBackup(record: ViewingKeyRecord): void {
  const json = JSON.stringify(record, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payfurt-viewing-key-${record.account.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseViewingKeyBackup(json: string): ViewingKeyRecord {
  const record = JSON.parse(json) as Partial<ViewingKeyRecord>;
  if (!record.account || !record.privateKeyHex || !record.publicKeyHex) {
    throw new Error("Invalid viewing-key backup — missing required fields");
  }
  return record as ViewingKeyRecord;
}

// ── Payroll records (for later attestations) ─────────────────────────────────
//
// The employer needs the original (salaries, salt) to later prove min-wage /
// pay-equity against a batch's commitment. Persisted per (employer, batchId).

export interface PayrollRecord {
  employer: string;
  batchId: string;
  token: string;
  salaries: string[];   // bigint decimal strings, base units
  salt: string;
  commitmentDecimal: string;
  executedAt: string;
}

function payrollKey(employer: string): string {
  return `payfurt:payrolls:${employer}`;
}

export function loadPayrollRecords(employer: string): PayrollRecord[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(payrollKey(employer));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as PayrollRecord[];
  } catch {
    return [];
  }
}

export function savePayrollRecord(record: PayrollRecord): void {
  if (typeof window === "undefined") return;
  const all = loadPayrollRecords(record.employer).filter((r) => r.batchId !== record.batchId);
  all.push(record);
  window.localStorage.setItem(payrollKey(record.employer), JSON.stringify(all));
}
