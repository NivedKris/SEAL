import "server-only";
import type { Db } from "mongodb";
import { db as getDb } from "@/lib/db/mongo";
import {
  COLLECTIONS as C,
  type ContractDoc,
  type DiagnosisDoc,
  type EncounterDoc,
  type MemberDoc,
  type OrderDoc,
  type PatientDoc,
  type PayerDoc,
  type PlanDoc,
  type PriorAuthDoc,
  type ProviderDoc,
} from "@/lib/db/schemas";

/** Everything needed to bill one encounter, read from the EMR feed and the insurance master data. */
export type EncounterBundle = {
  encounter: EncounterDoc;
  patient: PatientDoc;
  member: MemberDoc;
  plan: PlanDoc;
  payer: PayerDoc;
  contract: ContractDoc;
  provider: ProviderDoc;
  /** Orders still on the encounter (removed orders are never billed). */
  orders: OrderDoc[];
  diagnoses: DiagnosisDoc[];
  priorAuths: PriorAuthDoc[];
};

export async function loadEncounterBundle(encounterId: string, database?: Db): Promise<EncounterBundle> {
  const d = database ?? (await getDb());
  const one = async <T,>(col: string, id: string | undefined, what: string): Promise<T> => {
    const doc = id ? await d.collection(col).findOne({ _id: id as never }) : null;
    if (!doc) throw new Error(`${what} ${id ?? "(none)"} not found`);
    return doc as unknown as T;
  };
  const encounter = await one<EncounterDoc>(C.encounters, encounterId, "encounter");
  const [patient, member, provider] = await Promise.all([
    one<PatientDoc>(C.patients, encounter.patientId, "patient"),
    one<MemberDoc>(C.members, encounter.memberId, "insurance membership for encounter"),
    one<ProviderDoc>(C.providers, encounter.providerId, "provider"),
  ]);
  const [plan, payer, contract, orders, diagnoses, priorAuths] = await Promise.all([
    one<PlanDoc>(C.plans, member.planId, "plan"),
    one<PayerDoc>(C.payers, member.payerId, "payer"),
    d.collection(C.contracts).findOne({ payerId: member.payerId }) as Promise<ContractDoc | null>,
    d.collection(C.orders).find({ encounterId, justificationStatus: { $ne: "removed" } }).sort({ orderedAt: 1, _id: 1 }).toArray() as unknown as Promise<OrderDoc[]>,
    d.collection(C.diagnoses).find({ encounterId }).sort({ primary: -1, _id: 1 }).toArray() as unknown as Promise<DiagnosisDoc[]>,
    d.collection(C.priorAuths).find({ memberId: member._id }).toArray() as unknown as Promise<PriorAuthDoc[]>,
  ]);
  if (!contract) throw new Error(`no contract with payer ${member.payerId}`);
  return { encounter, patient, member, plan, payer, contract, provider, orders, diagnoses, priorAuths };
}
