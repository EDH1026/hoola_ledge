import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { DB, emptyDB } from "./types";

// Storage adapter: in local development (no Blob token configured) we keep the
// data as a plain JSON file on disk. When deployed to Vercel, the filesystem
// is read-only/ephemeral, so we transparently switch to Vercel Blob storage
// (still just a JSON "file", just stored in the cloud instead of on disk).

const BLOB_PATHNAME = "game-ledger/db.json";
const LOCAL_DB_PATH = path.join(process.cwd(), "data", "db.json");

const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

async function readLocal(): Promise<DB> {
  try {
    const raw = await fs.readFile(LOCAL_DB_PATH, "utf-8");
    return JSON.parse(raw) as DB;
  } catch {
    return emptyDB();
  }
}

async function writeLocal(db: DB): Promise<void> {
  await fs.mkdir(path.dirname(LOCAL_DB_PATH), { recursive: true });
  // Write to a temp file then rename, so a crash mid-write can't corrupt or
  // truncate the existing db.json (rename is atomic on the same filesystem).
  const tmpPath = `${LOCAL_DB_PATH}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(db, null, 2), "utf-8");
  await fs.rename(tmpPath, LOCAL_DB_PATH);
}

async function readBlob(): Promise<DB> {
  const { get } = await import("@vercel/blob");
  const result = await get(BLOB_PATHNAME, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return emptyDB();
  const text = await new Response(result.stream).text();
  try {
    return JSON.parse(text) as DB;
  } catch {
    return emptyDB();
  }
}

async function writeBlob(db: DB): Promise<void> {
  const { put } = await import("@vercel/blob");
  await put(BLOB_PATHNAME, JSON.stringify(db, null, 2), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function readDB(): Promise<DB> {
  return USE_BLOB ? readBlob() : readLocal();
}

export async function writeDB(db: DB): Promise<void> {
  return USE_BLOB ? writeBlob(db) : writeLocal(db);
}

// Simple read-modify-write store meant for a small friend-group app. Two
// requests hitting mutateDB at the same moment could otherwise race (both
// read the same "before" state, then the second write clobbers the first),
// so within a single server process we serialize mutations through this
// promise chain. That covers local dev and a single warm Vercel instance,
// which is the realistic scale here; it does not cover multiple concurrent
// Vercel instances writing at once, but that's an acceptable tradeoff for a
// private, low-traffic shared-password app.
let mutationQueue: Promise<unknown> = Promise.resolve();

export function mutateDB<T>(fn: (db: DB) => T | Promise<T>): Promise<T> {
  const run = async () => {
    const db = await readDB();
    const result = await fn(db);
    await writeDB(db);
    return result;
  };

  const result = mutationQueue.then(run, run);
  // Keep the queue alive even if this mutation rejects, without leaking the
  // rejection into the chain (each caller still gets it via `result`).
  mutationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}
