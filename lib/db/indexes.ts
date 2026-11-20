import type { Db, IndexDescription } from "mongodb";
import { COLLECTIONS as C } from "./schemas";
import { EMBEDDING } from "@/config/models";

/** Regular indexes per collection. Kept lean: the free Atlas tier counts index size against storage. */
export const INDEXES: Record<string, IndexDescription[]> = {
  [C.members]: [{ key: { patientId: 1 } }],
  [C.encounters]: [{ key: { patientId: 1, start: -1 } }, { key: { status: 1, start: -1 } }],
  [C.orders]: [{ key: { encounterId: 1 } }],
  [C.diagnoses]: [{ key: { encounterId: 1 } }],
  [C.priorAuths]: [{ key: { memberId: 1 } }, { key: { authNo: 1 } }],
  [C.claims]: [
    { key: { status: 1, createdAt: -1 } },
    { key: { patientId: 1, createdAt: -1 } },
    { key: { encounterId: 1 } },
    { key: { payerId: 1, createdAt: -1 } },
    { key: { claimNo: 1 }, unique: true },
  ],
  [C.findings]: [{ key: { claimId: 1 } }, { key: { encounterId: 1 } }],
  [C.questionSets]: [{ key: { status: 1, providerId: 1 } }, { key: { claimId: 1 } }],
  [C.remittances]: [{ key: { claimId: 1 } }, { key: { receivedAt: 1, readyAt: 1 } }],
  [C.denials]: [{ key: { status: 1, deadline: 1 } }, { key: { claimId: 1 } }],
  [C.outcomes]: [{ key: { payerId: 1, closedAt: -1 } }, { key: { refusedCodes: 1 } }],
  [C.aiCalls]: [{ key: { agent: 1, at: -1 } }, { key: { at: -1 } }],
  [C.events]: [{ key: { seq: 1 }, unique: true }, { key: { "payload.claimId": 1, seq: 1 } }],
  [C.rules]: [{ key: { scope: 1, active: 1 } }],
  [C.mockDhpo]: [{ key: { status: 1, readyAt: 1 } }, { key: { receiverId: 1, status: 1 } }, { key: { claimIds: 1 } }],
};

export const VECTOR_INDEX_NAME = "outcomes_embedding";

/** Atlas Vector Search index on outcomes.embedding, filterable by payer and status. */
export const VECTOR_INDEX = {
  name: VECTOR_INDEX_NAME,
  type: "vectorSearch" as const,
  definition: {
    fields: [
      { type: "vector", path: "embedding", numDimensions: EMBEDDING.dims, similarity: "cosine" },
      { type: "filter", path: "payerId" },
      { type: "filter", path: "firstPassRefused" },
    ],
  },
};

export async function ensureIndexes(db: Db, log: (s: string) => void = () => {}) {
  for (const [name, specs] of Object.entries(INDEXES)) {
    if (specs.length) await db.collection(name).createIndexes(specs);
    log(`indexes: ${name} (${specs.length})`);
  }
  const outcomes = db.collection(C.outcomes);
  const existing = await outcomes.listSearchIndexes(VECTOR_INDEX_NAME).toArray();
  if (!existing.length) {
    await outcomes.createSearchIndex(VECTOR_INDEX);
    log(`search index: ${VECTOR_INDEX_NAME} created (builds asynchronously)`);
  } else {
    const dims = (existing[0] as { latestDefinition?: { fields?: { type: string; numDimensions?: number }[] } }).latestDefinition?.fields?.find((f) => f.type === "vector")?.numDimensions;
    if (dims !== EMBEDDING.dims) {
      await outcomes.updateSearchIndex(VECTOR_INDEX_NAME, VECTOR_INDEX.definition);
      log(`search index: ${VECTOR_INDEX_NAME} updated ${dims} → ${EMBEDDING.dims} dims (rebuilds asynchronously)`);
    } else log(`search index: ${VECTOR_INDEX_NAME} exists`);
  }
}
