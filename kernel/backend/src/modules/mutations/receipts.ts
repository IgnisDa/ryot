import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationChangePayload,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { PluginId, UserId } from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer, Result, Schema } from "effect";

import { LifecycleDispatchPlan } from "#modules/automations/lifecycle/planning";
import { DatabaseSession, DatabaseSessionStateError } from "#platform/db/session";
import { user } from "#schema/tables/auth";
import { mutationReceipt } from "#schema/tables/mutations";
import { userLifecycleOperation } from "#schema/tables/user-lifecycle";

export const mutationReceiptIdentity = (input: {
	command: LifecycleCommand;
	commandKind: string;
	ownerUserId: UserId | null;
	scopeUserId: UserId | null;
	input: unknown;
}) => ({
	commandKind: input.commandKind,
	ownerUserId: input.ownerUserId,
	scopeUserId: input.scopeUserId,
	itemIdentity: input.command.itemIdentity,
	executionId: input.command.causation.executionId,
	accountGeneration: input.command.accountGeneration,
	rootExecutionId: input.command.causation.rootExecutionId,
	mutationScope: input.scopeUserId === null ? ("global" as const) : ("user" as const),
	id: `receipt_${sha256Base64Url(
		stableStringify([
			input.command.causation.executionId,
			input.command.itemIdentity,
			input.ownerUserId,
			input.scopeUserId,
			input.commandKind,
		]),
	)}`,
	inputFingerprint: sha256Base64Url(
		stableStringify([
			input.ownerUserId,
			input.scopeUserId,
			input.commandKind,
			input.command.itemIdentity,
			input.command.occurredAt,
			input.command.accountGeneration,
			input.command.causation,
			input.input,
		]),
	),
});

export const mutationReceiptOwner = (command: LifecycleCommand, scopeUserId: UserId | null) =>
	command.accountGeneration?.userId ??
	(command.causation.source !== "automation" && command.causation.initiator.kind === "user"
		? command.causation.initiator.id
		: scopeUserId);

export const MutationReceiptIdentity = Schema.Struct({
	id: Schema.String,
	commandKind: Schema.String,
	itemIdentity: Schema.String,
	inputFingerprint: Schema.String,
	ownerUserId: Schema.NullOr(UserId),
	scopeUserId: Schema.NullOr(UserId),
	mutationScope: Schema.Literals(["global", "user"]),
	accountGeneration: LifecycleCommand.fields.accountGeneration,
	executionId: LifecycleCommand.fields.causation.fields.executionId,
	rootExecutionId: LifecycleCommand.fields.causation.fields.rootExecutionId,
});
export type MutationReceiptIdentity = typeof MutationReceiptIdentity.Type;

const MutationBatchPinReferences = Schema.Struct({
	pluginId: Schema.NullOr(PluginId),
	scopeUserId: Schema.NullOr(UserId),
	sandboxScriptId: Schema.NullOr(Schema.String),
	pluginRevisionId: Schema.NullOr(Schema.String),
	pluginConfigRevisionId: Schema.NullOr(Schema.String),
});
export type MutationBatchPin<Payload> = {
	readonly references: typeof MutationBatchPinReferences.Type;
	readonly payload: Payload;
};

const WorkflowOwnerState = Schema.Struct({
	retiring: Schema.Boolean,
	fingerprint: Schema.NullOr(Schema.String),
});

// Keep receipt rows below PostgreSQL's 65,535 bind-parameter limit per statement.
const batchCandidateChunkSize = 1000;

const retiringAccountFilter = (account: AccountGeneration) =>
	and(
		eq(userLifecycleOperation.userId, account.userId),
		inArray(userLifecycleOperation.status, ["pending", "running", "failed"]),
		sql`${userLifecycleOperation.metadata}->'user'->>'accountGeneration' = ${account.token}`,
	);

const generationMismatch = (identity: MutationReceiptIdentity) => {
	const account = identity.accountGeneration;
	if (account === null) {
		return identity.ownerUserId === null && identity.scopeUserId === null
			? undefined
			: new DbError({ message: "Mutation command account generation is missing" });
	}
	return (identity.ownerUserId !== null && identity.ownerUserId !== account.userId) ||
		(identity.scopeUserId !== null && identity.scopeUserId !== account.userId)
		? new DbError({ message: "Mutation command account identity does not match its scope" })
		: undefined;
};

export class MutationReceiptIdentityConflict extends Schema.TaggedError<
	MutationReceiptIdentityConflict,
	{ readonly brand: unique symbol }
>()("MutationReceiptIdentityConflict", { receiptId: Schema.String }) {}

const batchIdentity = (input: {
	command: LifecycleCommand;
	resource: "entity" | "event" | "relationship";
	identity: ReadonlyArray<string>;
	ownerUserId: UserId | null;
	commandInput?: unknown;
}) =>
	mutationReceiptIdentity({
		scopeUserId: null,
		commandKind: `batch:${input.resource}`,
		ownerUserId: mutationReceiptOwner(input.command, input.ownerUserId),
		input: { identity: input.identity, commandInput: input.commandInput ?? null },
		command: {
			...input.command,
			itemIdentity: stableStringify([input.command.itemIdentity, input.identity]),
		},
	});

export class MutationReceipts extends Context.Service<MutationReceipts>()("MutationReceipts", {
	make: Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const requireTransaction = session.requireTransaction.pipe(
			Effect.mapError(() => new DbError({ message: "Mutation receipt requires a transaction" })),
		);
		const getCommittedItems = Effect.fn("MutationReceipts.getCommittedItems")(function* (input: {
			userId: UserId;
			accountGeneration: AccountGeneration;
			rootExecutionId: string;
			itemIdentities: ReadonlyArray<string>;
		}) {
			if (input.itemIdentities.length === 0) {
				return [];
			}
			if (input.itemIdentities.length > 1000 || input.accountGeneration.userId !== input.userId) {
				return yield* new DbError({ message: "Invalid committed ingestion fact query" });
			}
			return yield* session.run((db) =>
				db
					.select()
					.from(mutationReceipt)
					.where(
						and(
							eq(mutationReceipt.receiptType, "item"),
							eq(mutationReceipt.ownerUserId, input.userId),
							eq(mutationReceipt.rootExecutionId, input.rootExecutionId),
							eq(mutationReceipt.accountGeneration, input.accountGeneration),
							inArray(mutationReceipt.itemIdentity, [...input.itemIdentities]),
							sql`exists (select 1 from ${user} where ${user.id} = ${input.userId} and ${user.accountGeneration} = ${input.accountGeneration.token})`,
						),
					),
			);
		});
		const inTransaction = <A, E, R>(
			work: Effect.Effect<A, E, R>,
		): Effect.Effect<A, E | DbError, R> =>
			Effect.flatMap(session.isTransactionActive, (active): Effect.Effect<A, E | DbError, R> =>
				active
					? work
					: session
							.transaction(work)
							.pipe(
								Effect.mapError((error) =>
									error instanceof DatabaseSessionStateError
										? new DbError({ message: "Mutation admission transaction could not start" })
										: error,
								),
							),
			);
		const lockAccount = Effect.fn("MutationReceipts.lockAccount")(function* (
			account: AccountGeneration,
		) {
			yield* requireTransaction;
			// Reset takes the exclusive account row lock before publishing retirement.
			const [current] = yield* session.run((db) =>
				db
					.select({ token: user.accountGeneration })
					.from(user)
					.where(eq(user.id, account.userId))
					.for("share"),
			);
			if (!current || current.token !== account.token) {
				return yield* new DbError({ message: "Mutation command belongs to a retired account" });
			}
			return yield* Effect.void;
		});
		const admitAccount = Effect.fn("MutationReceipts.admitAccount")(function* (
			account: AccountGeneration,
		) {
			yield* lockAccount(account);
			const [retiring] = yield* session.run((db) =>
				db
					.select({ id: userLifecycleOperation.id })
					.from(userLifecycleOperation)
					.where(retiringAccountFilter(account))
					.limit(1),
			);
			if (retiring) {
				return yield* new DbError({ message: "Mutation command account is being retired" });
			}
			return yield* Effect.void;
		});
		const currentAccount = Effect.fn("MutationReceipts.currentAccount")(function* (userId: UserId) {
			const [current] = yield* session.run((db) =>
				db.select({ token: user.accountGeneration }).from(user).where(eq(user.id, userId)),
			);
			if (!current) {
				return yield* new DbError({ message: "Mutation command account is unavailable" });
			}
			const account = { userId, token: current.token };
			yield* inTransaction(admitAccount(account));
			return account;
		});
		const requireCurrentGeneration = Effect.fnUntraced(function* (
			identity: MutationReceiptIdentity,
		) {
			const mismatch = generationMismatch(identity);
			if (mismatch) {
				return yield* mismatch;
			}
			if (identity.accountGeneration !== null) {
				yield* admitAccount(identity.accountGeneration);
			}
			return yield* Effect.void;
		});
		const firstGenerationFailure = Effect.fnUntraced(function* (
			identities: ReadonlyArray<MutationReceiptIdentity>,
		) {
			const admitted = new Set<string>();
			for (const [index, identity] of identities.entries()) {
				const mismatch = generationMismatch(identity);
				if (mismatch) {
					return { index, error: mismatch };
				}
				const account = identity.accountGeneration;
				if (account === null) {
					continue;
				}
				const key = stableStringify([account.userId, account.token]);
				if (admitted.has(key)) {
					continue;
				}
				const admission = yield* Effect.result(admitAccount(account));
				if (Result.isFailure(admission)) {
					return { index, error: admission.failure };
				}
				admitted.add(key);
			}
			return undefined;
		});
		const lockReceipts = (ids: ReadonlyArray<string>) =>
			session.run((db) =>
				db.execute(
					sql`select pg_advisory_xact_lock(hashtext(k)) from unnest(array[${sql.join(
						[...new Set(ids)].sort().map((id) => sql`${`mutation-receipt:${id}`}`),
						sql`, `,
					)}]::text[]) with ordinality t(k, n) order by n`,
				),
			);
		const registerWorkflow = Effect.fn("MutationReceipts.registerWorkflow")(function* (
			account: AccountGeneration | null,
			workflowName: string,
			executionId: string,
		) {
			if (account === null) {
				return;
			}
			yield* inTransaction(
				Effect.gen(function* () {
					yield* lockAccount(account);
					const id = `workflow_owner_${sha256Base64Url(stableStringify([workflowName, executionId]))}`;
					const fingerprint = sha256Base64Url(
						stableStringify([account, workflowName, executionId]),
					);
					const readOwner = Effect.gen(function* () {
						const [state] = yield* session.run((db) =>
							db.execute<typeof WorkflowOwnerState.Type>(
								sql`select
									(select ${mutationReceipt.inputFingerprint} from ${mutationReceipt}
										where ${mutationReceipt.id} = ${id}) as fingerprint,
									exists(select 1 from ${userLifecycleOperation}
										where ${retiringAccountFilter(account)}) as retiring`,
								"objects",
							),
						);
						if (state?.retiring) {
							return yield* new DbError({ message: "Mutation command account is being retired" });
						}
						return state?.fingerprint ? { fingerprint: state.fingerprint } : undefined;
					});
					let owner = yield* readOwner;
					if (!owner) {
						const [inserted] = yield* session.run((db) =>
							db
								.insert(mutationReceipt)
								.values({
									id,
									executionId,
									workflowName,
									dispatch: [],
									commandKind: "workflow",
									mutationScope: "global",
									accountGeneration: account,
									itemIdentity: workflowName,
									ownerUserId: account.userId,
									rootExecutionId: executionId,
									inputFingerprint: fingerprint,
									receiptType: "workflow-owner",
								})
								.onConflictDoNothing()
								.returning({ fingerprint: mutationReceipt.inputFingerprint }),
						);
						// A competing insert is visible only to the next statement's snapshot.
						owner = inserted ?? (yield* readOwner);
					}
					if (owner?.fingerprint !== fingerprint) {
						return yield* new DbError({
							message: "Workflow belongs to another account generation",
						});
					}
					return yield* Effect.void;
				}),
			);
		});
		const decodeItem = Effect.fnUntraced(function* <Result>(
			identity: MutationReceiptIdentity,
			row: typeof mutationReceipt.$inferSelect,
			result: Schema.Codec<Result, unknown>,
		) {
			if (
				row.receiptType !== "item" ||
				row.inputFingerprint !== identity.inputFingerprint ||
				row.executionId !== identity.executionId ||
				row.rootExecutionId !== identity.rootExecutionId ||
				row.ownerUserId !== identity.ownerUserId ||
				row.mutationScope !== identity.mutationScope ||
				row.scopeUserId !== identity.scopeUserId
			) {
				return yield* new MutationReceiptIdentityConflict({ receiptId: identity.id });
			}
			return {
				result: yield* decodeStoredSchema(row.result, result, `Invalid mutation result ${row.id}`),
				dispatch: yield* decodeStoredSchema(
					row.dispatch,
					Schema.Array(LifecycleDispatchPlan),
					`Invalid mutation dispatch ${row.id}`,
				),
			};
		});
		const readItem = Effect.fn("MutationReceipts.readItem")(function* <Result>(
			identity: MutationReceiptIdentity,
			result: Schema.Codec<Result, unknown>,
		) {
			const [row] = yield* session.run((db) =>
				db.select().from(mutationReceipt).where(eq(mutationReceipt.id, identity.id)),
			);
			return row ? yield* decodeItem(identity, row, result) : null;
		});
		const lookup = Effect.fn("MutationReceipts.lookup")(function* <Result>(
			identity: MutationReceiptIdentity,
			result: Schema.Codec<Result, unknown>,
		) {
			yield* requireTransaction;
			yield* requireCurrentGeneration(identity);
			yield* session.run((db) =>
				db.execute(
					sql`select pg_advisory_xact_lock(hashtext(${`mutation-receipt:${identity.id}`}))`,
				),
			);
			return yield* readItem(identity, result);
		});
		const insert = Effect.fn("MutationReceipts.insert")(function* (input: {
			identity: MutationReceiptIdentity;
			result: unknown;
			dispatch: ReadonlyArray<LifecycleDispatchPlan>;
			evidence?: (typeof mutationReceipt.$inferInsert)["evidence"];
			batchId?: string;
			batchIndex?: number;
		}) {
			yield* requireTransaction;
			yield* requireCurrentGeneration(input.identity);
			const result = yield* decodeStoredSchema(input.result, JsonValue, "Invalid mutation result");
			yield* session.run((db) =>
				db
					.insert(mutationReceipt)
					.values({
						...input.identity,
						result,
						receiptType: "item",
						dispatch: [...input.dispatch],
						batchId: input.batchId ?? null,
						evidence: input.evidence ?? null,
						batchIndex: input.batchIndex ?? null,
					}),
			);
		});
		const lookupMany = Effect.fn("MutationReceipts.lookupMany")(function* <Result>(
			identities: ReadonlyArray<MutationReceiptIdentity>,
			result: Schema.Codec<Result, unknown>,
		) {
			yield* requireTransaction;
			const failure = yield* firstGenerationFailure(identities);
			// Sequential lookups stop at the first failing identity; earlier conflicts still win.
			const checked = identities.slice(0, failure?.index ?? identities.length);
			const ids = checked.map(({ id }) => id);
			const rows = ids.length
				? yield* Effect.andThen(
						lockReceipts(ids),
						session.run((db) =>
							db.select().from(mutationReceipt).where(inArray(mutationReceipt.id, ids)),
						),
					)
				: [];
			const rowsById = new Map(rows.map((row) => [row.id, row]));
			const items = yield* Effect.forEach(checked, (identity) => {
				const row = rowsById.get(identity.id);
				return row ? decodeItem(identity, row, result) : Effect.succeed(null);
			});
			if (failure) {
				return yield* failure.error;
			}
			return items;
		});
		const insertMany = Effect.fn("MutationReceipts.insertMany")(function* (
			records: ReadonlyArray<Parameters<typeof insert>[0]>,
		) {
			yield* requireTransaction;
			if (records.length === 0) {
				return yield* Effect.void;
			}
			const ids = records.map(({ identity }) => identity.id);
			if (new Set(ids).size !== ids.length) {
				return yield* new DbError({ message: "Mutation receipt batch repeats an identity" });
			}
			const failure = yield* firstGenerationFailure(records.map(({ identity }) => identity));
			const values = yield* Effect.forEach(
				records.slice(0, failure?.index ?? records.length),
				Effect.fnUntraced(function* (input) {
					return {
						...input.identity,
						receiptType: "item" as const,
						dispatch: [...input.dispatch],
						batchId: input.batchId ?? null,
						evidence: input.evidence ?? null,
						batchIndex: input.batchIndex ?? null,
						result: yield* decodeStoredSchema(input.result, JsonValue, "Invalid mutation result"),
					};
				}),
			);
			if (failure) {
				return yield* failure.error;
			}
			yield* lockReceipts(ids);
			yield* session.run((db) => db.insert(mutationReceipt).values(values));
			return yield* Effect.void;
		});
		const lookupBatch = Effect.fn("MutationReceipts.lookupBatch")(function* (
			identity: MutationReceiptIdentity,
		) {
			yield* requireTransaction;
			yield* requireCurrentGeneration(identity);
			const [row] = yield* session.run((db) =>
				db.select().from(mutationReceipt).where(eq(mutationReceipt.id, identity.id)).for("update"),
			);
			if (!row) {
				return null;
			}
			if (
				row.receiptType !== "batch-decision" ||
				row.inputFingerprint !== identity.inputFingerprint ||
				row.executionId !== identity.executionId ||
				row.rootExecutionId !== identity.rootExecutionId ||
				row.ownerUserId !== identity.ownerUserId ||
				row.scopeUserId !== identity.scopeUserId
			) {
				return yield* new MutationReceiptIdentityConflict({ receiptId: identity.id });
			}
			const decision =
				row.result === "sealed"
					? { maxItems: 0, candidateCount: 0 }
					: yield* decodeStoredSchema(
							row.result,
							Schema.Struct({ maxItems: Schema.Int, candidateCount: Schema.Int }),
							`Invalid batch decision ${row.id}`,
						);
			return {
				...decision,
				sealed: row.result === "sealed",
				dispatch: yield* decodeStoredSchema(
					row.dispatch,
					Schema.Array(LifecycleDispatchPlan),
					`Invalid batch dispatch ${row.id}`,
				),
			};
		});
		const peekBatch = Effect.fn("MutationReceipts.peekBatch")(function* (
			identity: MutationReceiptIdentity,
		) {
			yield* requireCurrentGeneration(identity);
			const [row] = yield* session.run((db) =>
				db
					.select({
						receiptType: mutationReceipt.receiptType,
						inputFingerprint: mutationReceipt.inputFingerprint,
					})
					.from(mutationReceipt)
					.where(eq(mutationReceipt.id, identity.id)),
			);
			if (!row) {
				return false;
			}
			if (
				row.receiptType !== "batch-decision" ||
				row.inputFingerprint !== identity.inputFingerprint
			) {
				return yield* new MutationReceiptIdentityConflict({ receiptId: identity.id });
			}
			return true;
		}, inTransaction);
		const beginBatch = Effect.fn("MutationReceipts.beginBatch")(function* (input: {
			identity: MutationReceiptIdentity;
			maxItems: number;
			pins: ReadonlyArray<{
				readonly id: string;
				readonly payload: unknown;
				readonly references: typeof MutationBatchPinReferences.Type;
			}>;
		}) {
			yield* requireTransaction;
			yield* requireCurrentGeneration(input.identity);
			yield* session.run((db) =>
				db.execute(
					sql`select pg_advisory_xact_lock(hashtext(${`mutation-receipt:${input.identity.id}`}))`,
				),
			);
			const existing = yield* lookupBatch(input.identity);
			if (existing) {
				return existing;
			}
			const candidates = yield* Effect.forEach(
				input.pins,
				Effect.fnUntraced(function* (pin) {
					const row: typeof mutationReceipt.$inferInsert = {
						...input.identity,
						...pin.references,
						id: pin.id,
						dispatch: [],
						batchId: input.identity.id,
						receiptType: "batch-candidate",
						ownerUserId: pin.references.scopeUserId ?? input.identity.ownerUserId,
						mutationScope: pin.references.scopeUserId === null ? "global" : "user",
						result: yield* decodeStoredSchema(pin.payload, JsonValue, "Invalid batch pin"),
					};
					return row;
				}),
			);
			yield* session.run((db) =>
				db
					.insert(mutationReceipt)
					.values({
						...input.identity,
						dispatch: [],
						receiptType: "batch-decision",
						result: { maxItems: input.maxItems, candidateCount: input.pins.length },
					}),
			);
			for (let offset = 0; offset < candidates.length; offset += batchCandidateChunkSize) {
				yield* session.run((db) =>
					db
						.insert(mutationReceipt)
						.values(candidates.slice(offset, offset + batchCandidateChunkSize)),
				);
			}
			return {
				dispatch: [],
				sealed: false,
				maxItems: input.maxItems,
				candidateCount: input.pins.length,
			};
		});
		const batchContents = Effect.fn("MutationReceipts.batchContents")(function* <Pin>(
			identity: MutationReceiptIdentity,
			pinSchema: Schema.Codec<Pin, unknown>,
		) {
			yield* requireTransaction;
			const decision = yield* lookupBatch(identity);
			if (!decision) {
				return yield* new DbError({ message: `Missing batch decision ${identity.id}` });
			}
			if (decision.sealed) {
				return { ...decision, pins: [], maxItems: 0, evidence: [] };
			}
			const rows = yield* session.run((db) =>
				db
					.select()
					.from(mutationReceipt)
					.where(
						and(
							eq(mutationReceipt.batchId, identity.id),
							eq(mutationReceipt.receiptType, "batch-candidate"),
						),
					)
					.orderBy(asc(mutationReceipt.id)),
			);
			if (rows.length !== decision.candidateCount) {
				return yield* new DbError({ message: `Missing pinned batch hooks for ${identity.id}` });
			}
			const items = yield* session.run((db) =>
				db
					.select()
					.from(mutationReceipt)
					.where(
						and(
							eq(mutationReceipt.batchId, identity.id),
							eq(mutationReceipt.receiptType, "item"),
							isNotNull(mutationReceipt.evidence),
						),
					)
					.orderBy(asc(mutationReceipt.batchIndex), asc(mutationReceipt.id)),
			);
			return {
				...decision,
				maxItems: decision.maxItems,
				evidence: yield* Effect.forEach(items, (row) =>
					decodeStoredSchema(
						row.evidence,
						AutomationChangePayload,
						`Invalid batch evidence ${row.id}`,
					).pipe(
						Effect.map((payload) => ({
							payload,
							scopeUserId: row.scopeUserId === null ? null : UserId.make(row.scopeUserId),
						})),
					),
				),
				pins: yield* Effect.forEach(rows, (row) =>
					decodeStoredSchema(
						{
							payload: row.result,
							references: {
								pluginId: row.pluginId,
								scopeUserId: row.scopeUserId,
								sandboxScriptId: row.sandboxScriptId,
								pluginRevisionId: row.pluginRevisionId,
								pluginConfigRevisionId: row.pluginConfigRevisionId,
							},
						},
						Schema.Struct({ payload: pinSchema, references: MutationBatchPinReferences }),
						`Invalid batch pin ${row.id}`,
					),
				),
			};
		});
		const sealBatch = Effect.fn("MutationReceipts.sealBatch")(function* (
			identity: MutationReceiptIdentity,
			dispatch: ReadonlyArray<LifecycleDispatchPlan>,
		) {
			yield* requireTransaction;
			yield* requireCurrentGeneration(identity);
			yield* session.run((db) =>
				db
					.update(mutationReceipt)
					.set({ result: "sealed", dispatch: [...dispatch] })
					.where(
						and(
							eq(mutationReceipt.id, identity.id),
							eq(mutationReceipt.receiptType, "batch-decision"),
						),
					),
			);
			yield* session.run((db) =>
				db
					.update(mutationReceipt)
					.set({ evidence: null })
					.where(
						and(eq(mutationReceipt.batchId, identity.id), eq(mutationReceipt.receiptType, "item")),
					),
			);
			yield* session.run((db) =>
				db
					.delete(mutationReceipt)
					.where(
						and(
							eq(mutationReceipt.batchId, identity.id),
							eq(mutationReceipt.receiptType, "batch-candidate"),
						),
					),
			);
		});
		const retireUserPins = Effect.fn("MutationReceipts.retireUserPins")(function* (
			userId: UserId,
			privatePluginIds: ReadonlyArray<string>,
		) {
			yield* requireTransaction;
			const rows = yield* session.run((db) =>
				db
					.select({ id: mutationReceipt.id })
					.from(mutationReceipt)
					.where(
						and(
							eq(mutationReceipt.receiptType, "batch-candidate"),
							or(
								eq(mutationReceipt.ownerUserId, userId),
								eq(mutationReceipt.scopeUserId, userId),
								privatePluginIds.length
									? inArray(mutationReceipt.pluginId, privatePluginIds)
									: undefined,
							),
						),
					),
			);
			if (rows.length) {
				yield* session.run((db) =>
					db.delete(mutationReceipt).where(
						inArray(
							mutationReceipt.id,
							rows.map(({ id }) => id),
						),
					),
				);
			}
		});
		const countWrittenEvents = Effect.fn("MutationReceipts.countWrittenEvents")(function* (
			ownerUserId: UserId,
			executionId: string,
		) {
			const rows = yield* session.run((db) =>
				db
					.select({ id: mutationReceipt.id, dispatch: mutationReceipt.dispatch })
					.from(mutationReceipt)
					.where(
						and(
							eq(mutationReceipt.executionId, executionId),
							eq(mutationReceipt.ownerUserId, ownerUserId),
							eq(mutationReceipt.commandKind, "event:create"),
							eq(mutationReceipt.receiptType, "item"),
						),
					)
					.orderBy(asc(mutationReceipt.itemIdentity)),
			);
			const batches = yield* session.run((db) =>
				db
					.select({ id: mutationReceipt.id, dispatch: mutationReceipt.dispatch })
					.from(mutationReceipt)
					.where(
						and(
							eq(mutationReceipt.executionId, executionId),
							eq(mutationReceipt.ownerUserId, ownerUserId),
							eq(mutationReceipt.commandKind, "batch:event"),
							eq(mutationReceipt.receiptType, "batch-decision"),
						),
					)
					.orderBy(asc(mutationReceipt.id)),
			);
			const batchDispatch = (yield* Effect.forEach(batches, (batch) =>
				decodeStoredSchema(
					batch.dispatch,
					Schema.Array(LifecycleDispatchPlan),
					`Invalid event batch dispatch ${batch.id}`,
				),
			)).flat();
			return yield* Effect.forEach(rows, (row) =>
				decodeStoredSchema(
					row.dispatch,
					Schema.Array(LifecycleDispatchPlan),
					`Invalid dispatch ${row.id}`,
				),
			).pipe(
				Effect.map((dispatch) => ({
					writtenCount: rows.length,
					dispatch: [...dispatch.flat(), ...batchDispatch],
				})),
			);
		});
		return {
			lookup,
			insert,
			peekBatch,
			sealBatch,
			insertMany,
			lookupMany,
			beginBatch,
			lookupBatch,
			admitAccount,
			batchIdentity,
			batchContents,
			currentAccount,
			retireUserPins,
			registerWorkflow,
			getCommittedItems,
			countWrittenEvents,
			peek: <Result>(identity: MutationReceiptIdentity, result: Schema.Codec<Result, unknown>) =>
				inTransaction(
					requireCurrentGeneration(identity).pipe(Effect.andThen(readItem(identity, result))),
				),
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
