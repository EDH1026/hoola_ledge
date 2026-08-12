"use server";

import { revalidatePath } from "next/cache";
import { v4 as uuidv4 } from "uuid";
import { mutateDB, readDB } from "./storage";
import { DB } from "./types";

function nowIso() {
  return new Date().toISOString();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function getDBSnapshot(): Promise<DB> {
  return readDB();
}

// ---------- Participants ----------

export async function addParticipant(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("이름을 입력해 주세요.");

  await mutateDB((db) => {
    db.participants.push({
      id: uuidv4(),
      name: trimmed,
      active: true,
      createdAt: nowIso(),
    });
  });

  revalidatePath("/participants");
  revalidatePath("/games/new");
  revalidatePath("/");
}

export async function renameParticipant(id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("이름을 입력해 주세요.");

  await mutateDB((db) => {
    const p = db.participants.find((p) => p.id === id);
    if (p) p.name = trimmed;
  });

  revalidatePath("/participants");
  revalidatePath("/");
}

export async function setParticipantActive(id: string, active: boolean) {
  await mutateDB((db) => {
    const p = db.participants.find((p) => p.id === id);
    if (p) p.active = active;
  });

  revalidatePath("/participants");
  revalidatePath("/games/new");
}

// ---------- Games ----------

export async function getPreviousAttendeeIds(): Promise<string[]> {
  const db = await readDB();
  if (db.games.length === 0) return [];
  const sorted = [...db.games].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  return sorted[0].attendeeIds;
}

export async function createGame(input: {
  date?: string;
  attendeeIds: string[];
  winnerId: string;
  loserId: string;
  note?: string;
}) {
  if (input.attendeeIds.length < 2) {
    throw new Error("참가자는 2명 이상이어야 합니다.");
  }
  if (!input.attendeeIds.includes(input.winnerId)) {
    throw new Error("1등은 참가자 목록에 포함되어야 합니다.");
  }
  if (!input.attendeeIds.includes(input.loserId)) {
    throw new Error("꼴찌는 참가자 목록에 포함되어야 합니다.");
  }
  if (input.winnerId === input.loserId) {
    throw new Error("1등과 꼴찌는 같은 사람일 수 없습니다.");
  }

  await mutateDB((db) => {
    db.games.push({
      id: uuidv4(),
      date: input.date || todayIso(),
      attendeeIds: input.attendeeIds,
      winnerId: input.winnerId,
      loserId: input.loserId,
      note: input.note?.trim() || undefined,
      createdAt: nowIso(),
    });
  });

  revalidatePath("/games");
  revalidatePath("/games/new");
  revalidatePath("/settlements");
  revalidatePath("/stats");
  revalidatePath("/");
}

export async function deleteGame(id: string) {
  await mutateDB((db) => {
    db.games = db.games.filter((g) => g.id !== id);
  });

  revalidatePath("/games");
  revalidatePath("/settlements");
  revalidatePath("/stats");
  revalidatePath("/");
}

// ---------- Settlements ----------

export async function recordSettlement(input: {
  fromId: string;
  toId: string;
  amount: number;
  note?: string;
}) {
  if (input.amount <= 0) throw new Error("정산 금액은 0보다 커야 합니다.");
  if (input.fromId === input.toId) {
    throw new Error("같은 사람에게 정산할 수 없습니다.");
  }

  await mutateDB((db) => {
    db.settlements.push({
      id: uuidv4(),
      fromId: input.fromId,
      toId: input.toId,
      amount: input.amount,
      date: todayIso(),
      note: input.note?.trim() || undefined,
      createdAt: nowIso(),
    });
  });

  revalidatePath("/settlements");
  revalidatePath("/");
}

export async function deleteSettlement(id: string) {
  await mutateDB((db) => {
    db.settlements = db.settlements.filter((s) => s.id !== id);
  });

  revalidatePath("/settlements");
  revalidatePath("/");
}
