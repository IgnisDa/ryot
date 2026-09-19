import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationChangePayload,
	LifecycleCommand,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { UserId } from "@ryot-app/contract/schema/brands";
import { decodeStoredSchema } from "@ryot-app/contract/schema/core";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { Context, Effect, Layer, Schema } from "effect";

import { LifecycleDispatchPlan } from "#lib/domain/lifecycle";
import { user } from "#lib/infrastructure/db/schema/tables/auth";
import { mutationReceipt } from "#lib/infrastructure/db/schema/tables/mutations";
import { userLifecycleOperation } from "#lib/infrastructure/db/schema/tables/user-lifecycle";
import { DatabaseSession, DatabaseSessionStateError } from "#lib/infrastructure/db/session";

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

export class MutationReceiptIdentityConflict extends Schema.TaggedError<MutationReceiptIdentityConflict>()(
	"MutationReceiptIdentityConflict",
	{ receiptId: Schema.String },
) {}

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
		const admitAccount = Effect.fn("MutationReceipts.admitAccount")(function* (
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
			const [retiring] = yield* session.run((db) =>
				db
					.select({ id: userLifecycleOperation.id })
					.from(userLifecycleOperation)
					.where(
						and(
							eq(userLifecycleOperation.userId, account.userId),
							inArray(userLifecycleOperation.status, ["pending", "running", "failed"]),
							sql`${userLifecycleOperation.metadata}->'user'->>'accountGeneration' = ${account.token}`,
						),
					)
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
			const account = identity.accountGeneration;
			if (account === null) {
				if (identity.ownerUserId !== null || identity.scopeUserId !== null) {
					return yield* new DbError({ message: "Mutation command account generation is missing" });
				}
				return yield* Effect.void;
			}
			if (
				(identity.ownerUserId !== null && identity.ownerUserId !== account.userId) ||
				(identity.scopeUserId !== null && identity.scopeUserId !== account.userId)
			) {
				return yield* new DbError({
					message: "Mutation command account identity does not match its scope",
				});
			}
			yield* admitAccount(account);
			return yield* Effect.void;
		});
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
					yield* admitAccount(account);
					const id = `workflow_owner_${sha256Base64Url(stableStringify([workflowName, executionId]))}`;
					const fingerprint = sha256Base64Url(
						stableStringify([account, workflowName, executionId]),
					);
					const readOwner = session.run((db) =>
						db
							.select({ fingerprint: mutationReceipt.inputFingerprint })
							.from(mutationReceipt)
							.where(eq(mutationReceipt.id, id)),
					);
					let owner = (yield* readOwner)[0];
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
						owner = inserted ?? (yield* readOwner)[0];
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
		const readItem = Effect.fn("MutationReceipts.readItem")(function* <Result>(
			identity: MutationReceiptIdentity,
			result: Schema.Codec<Result, unknown>,
		) {
			const [row] = yield* session.run((db) =>
				db.select().from(mutationReceipt).where(eq(mutationReceipt.id, identity.id)),
			);
			if (!row) {
				return null;
			}
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
				readonly result: unknown;
				readonly executionUserId: UserId | null;
				readonly pluginId: string | null;
				readonly pluginRevisionId: string | null;
				readonly pluginConfigRevisionId: string | null;
				readonly sandboxScriptId: string | null;
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
			for (const pin of input.pins) {
				const result = yield* decodeStoredSchema(pin.result, JsonValue, "Invalid batch pin");
				yield* session.run((db) =>
					db
						.insert(mutationReceipt)
						.values({
							...input.identity,
							result,
							id: pin.id,
							dispatch: [],
							pluginId: pin.pluginId,
							batchId: input.identity.id,
							receiptType: "batch-candidate",
							scopeUserId: pin.executionUserId,
							sandboxScriptId: pin.sandboxScriptId,
							pluginRevisionId: pin.pluginRevisionId,
							pluginConfigRevisionId: pin.pluginConfigRevisionId,
							ownerUserId: pin.executionUserId ?? input.identity.ownerUserId,
							mutationScope: pin.executionUserId === null ? "global" : "user",
						}),
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
				pins: yield* Effect.forEach(rows, (row) =>
					decodeStoredSchema(row.result, pinSchema, `Invalid batch pin ${row.id}`),
				),
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
