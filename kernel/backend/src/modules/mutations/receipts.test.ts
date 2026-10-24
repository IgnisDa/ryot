import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import {
	makeRecordingTracer,
	maxBindParameter,
	recordedStatements,
} from "@ryot-app/testing/recording-tracer";
import { eq, inArray, sql } from "drizzle-orm";
import { DateTime, Deferred, Effect, Fiber, Layer, Schema, type Tracer } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#modules/automations/lifecycle/command";
import { bindParameterLimit, insertChunkSize } from "#platform/db/bind-parameters";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeWorkflowEngine } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import type { MutationReceiptIdentity } from "./receipts";
import { mutationReceiptIdentity, MutationReceipts } from "./receipts";
import { pinReferences, seedPinTargets } from "./receipts.test-support";
import { dispatchAdmittedWorkflow } from "./workflow-dispatch";

const owner = UserId.make("receipt-owner");
const entityId = EntityId.make("receipt-entity");
const command = rootLifecycleCommand({
	source: "api",
	lane: "interactive",
	itemIdentity: "receipt-command",
	initiator: { id: owner, kind: "user" },
	occurredAt: "2026-09-15T00:00:00.000Z",
	executionId: AutomationExecutionId.make("receipt-execution"),
	accountGeneration: { userId: owner, token: "test-account-generation" },
});
const identity = (name: string) =>
	mutationReceiptIdentity({
		command,
		ownerUserId: owner,
		scopeUserId: owner,
		input: { name, entityId },
		commandKind: "entity:create",
	});
const Result = Schema.Struct({ entityId: EntityId });
const setOwner = UserId.make("receipt-set-owner");
const setAccount = { userId: setOwner, token: "receipt-set-generation" };
const setIdentity = (name: string, account: typeof setAccount = setAccount) =>
	mutationReceiptIdentity({
		input: { name },
		ownerUserId: account.userId,
		scopeUserId: account.userId,
		commandKind: "entity:create",
		command: { ...command, itemIdentity: name, accountGeneration: account },
	});
const hit = { dispatch: [], result: { entityId } };
const record = (receipt: MutationReceiptIdentity) => ({
	dispatch: [],
	identity: receipt,
	result: { entityId },
});
const batchPins = (
	prefix: string,
	count: number,
	payload: (index: number) => unknown = (index) => ({ index }),
) =>
	Array.from({ length: count }, (_, index) => ({
		payload: payload(index),
		id: `${prefix}-${String(index).padStart(4, "0")}`,
		references: pinReferences(index % 2 === 0 ? null : setOwner),
	}));
const receiptInsertStatements = (spans: ReadonlyArray<Tracer.Span>) =>
	recordedStatements(spans).filter((text) => text.startsWith('insert into "mutation_receipt"'));

const seedAccount = Effect.fn(function* (account: typeof setAccount) {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		db
			.insert(tables.user)
			.values({
				id: account.userId,
				name: account.userId,
				accountGeneration: account.token,
				email: `${account.userId}@example.test`,
			})
			.onConflictDoNothing(),
	);
});

const waitForAdvisoryWaiters = Effect.fn(function* (count: number) {
	const session = yield* DatabaseSession;
	for (let attempt = 0; attempt < 2_000; attempt += 1) {
		const [row] = yield* session.run((db) =>
			db.execute<{ readonly waiting: number }>(
				sql`select count(*)::int as waiting from pg_locks l join pg_database d on d.oid = l.database
					where l.locktype = 'advisory' and not l.granted and d.datname = current_database()`,
				"objects",
			),
		);
		if ((row?.waiting ?? 0) >= count) {
			return true;
		}
	}
	return false;
});

const holdReceiptLock = Effect.fn(function* (id: string) {
	const session = yield* DatabaseSession;
	const held = yield* Deferred.make<void>();
	const release = yield* Deferred.make<void>();
	const holder = yield* Effect.forkScoped(
		session.transaction(
			Effect.gen(function* () {
				yield* session.run((db) =>
					db.execute(sql`select pg_advisory_xact_lock(hashtext(${`mutation-receipt:${id}`}))`),
				);
				yield* Deferred.succeed(held, undefined);
				yield* Deferred.await(release);
			}),
		),
	);
	yield* Deferred.await(held);
	return { release: Deferred.succeed(release, undefined).pipe(Effect.andThen(Fiber.join(holder))) };
});

const receiptRowIds = Effect.fn(function* (ids: ReadonlyArray<string>) {
	const session = yield* DatabaseSession;
	return (yield* session.run((db) =>
		db
			.select({ id: tables.mutationReceipt.id })
			.from(tables.mutationReceipt)
			.where(inArray(tables.mutationReceipt.id, [...ids])),
	)).map(({ id }) => id);
});

layer(
	MutationReceipts.layer.pipe(Layer.provideMerge(isolatedDatabaseLayer("mutation_receipt_test"))),
)((test) => {
	test.effect(
		"owns a workflow suspended before its first write, fences its old generation, and admits the new generation",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const receipts = yield* MutationReceipts;
				const account = { token: "original", userId: UserId.make("dispatch-generation-owner") };
				yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({
							name: "Owner",
							id: account.userId,
							accountGeneration: account.token,
							email: "dispatch-generation@example.test",
						}),
				);
				const workflow = Workflow.make("GenerationDispatchWorkflow", {
					error: Schema.Never,
					success: Schema.String,
					payload: Schema.Struct({}),
					idempotencyKey: () => "generation",
				});
				const dispatched: Array<string> = [];
				const written: Array<string> = [];
				const instance = WorkflowInstance.initial(workflow, "old-generation");
				const engine = makeWorkflowEngine({
					execute: (_definition, options) =>
						Effect.gen(function* () {
							const owners = yield* session.run((db) =>
								db
									.select()
									.from(tables.mutationReceipt)
									.where(eq(tables.mutationReceipt.executionId, options.executionId)),
							);
							expect(owners).toHaveLength(1);
							expect(owners[0]?.workflowName).toBe(workflow._tag);
							dispatched.push(options.executionId);
							if (options.executionId === "old-generation") {
								return yield* Workflow.suspend(instance);
							}
							written.push(options.executionId);
							return options.executionId;
						}),
				});
				const suspended = yield* Workflow.intoResult(
					dispatchAdmittedWorkflow(
						receipts,
						engine,
						workflow,
						account,
						{ payload: {}, executionId: "old-generation" },
						(admission) => admission,
						(execution) => execution,
					),
				).pipe(Effect.provideService(WorkflowInstance, instance));
				expect(suspended._tag).toBe("Suspended");
				expect(written).toEqual([]);
				yield* session.run((db) =>
					db
						.update(tables.user)
						.set({ accountGeneration: "replacement" })
						.where(eq(tables.user.id, account.userId)),
				);
				expect(
					(yield* Effect.flip(
						dispatchAdmittedWorkflow(
							receipts,
							engine,
							workflow,
							account,
							{ payload: {}, executionId: "old-generation" },
							(admission) => admission,
							(execution) => execution,
						),
					)).message,
				).toBe("Mutation command belongs to a retired account");
				yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					workflow,
					{ ...account, token: "replacement" },
					{ payload: {}, executionId: "new-generation" },
					(admission) => admission,
					(execution) => execution,
				);
				expect(dispatched).toEqual(["old-generation", "new-generation"]);
				expect(written).toEqual(["new-generation"]);
			}),
	);

	test.effect("rechecks admission and ownership when a workflow owner is already recorded", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			const account = { token: "original", userId: UserId.make("registered-workflow-owner") };
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({
						id: account.userId,
						name: "Workflow owner",
						accountGeneration: account.token,
						email: "registered-workflow-owner@example.test",
					}),
			);
			yield* receipts.registerWorkflow(account, "ReplayWorkflow", "registered-workflow");
			yield* receipts.registerWorkflow(account, "ReplayWorkflow", "registered-workflow");
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: "replacement" })
					.where(eq(tables.user.id, account.userId)),
			);
			expect(
				(yield* Effect.flip(
					receipts.registerWorkflow(account, "ReplayWorkflow", "registered-workflow"),
				)).message,
			).toBe("Mutation command belongs to a retired account");
			expect(
				(yield* Effect.flip(
					receipts.registerWorkflow(
						{ ...account, token: "replacement" },
						"ReplayWorkflow",
						"registered-workflow",
					),
				)).message,
			).toBe("Workflow belongs to another account generation");
		}),
	);

	test.effect("allows only one account to own concurrent registrations of a workflow", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			const accounts = [
				{ token: "first", userId: UserId.make("workflow-race-first") },
				{ token: "second", userId: UserId.make("workflow-race-second") },
			];
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values(
						accounts.map((account) => ({
							id: account.userId,
							name: account.token,
							accountGeneration: account.token,
							email: `${account.userId}@example.test`,
						})),
					),
			);
			const exits = yield* Effect.forEach(
				accounts,
				(account) =>
					Effect.exit(
						receipts.registerWorkflow(account, "ConcurrentWorkflow", "workflow-owner-race"),
					),
				{ concurrency: "unbounded" },
			);
			expect(exits.filter((exit) => exit._tag === "Success")).toHaveLength(1);
			expect(exits.filter((exit) => exit._tag === "Failure")).toHaveLength(1);
			const rows = yield* session.run((db) =>
				db
					.select({ userId: tables.mutationReceipt.ownerUserId })
					.from(tables.mutationReceipt)
					.where(eq(tables.mutationReceipt.executionId, "workflow-owner-race")),
			);
			expect(rows).toHaveLength(1);
			const winner = accounts.find((_account, index) => exits[index]?._tag === "Success");
			const loser = accounts.find((_account, index) => exits[index]?._tag === "Failure");
			assert(winner !== undefined && loser !== undefined);
			expect(rows[0]?.userId).toBe(winner.userId);
			yield* receipts.registerWorkflow(winner, "ConcurrentWorkflow", "workflow-owner-race");
			expect(
				(yield* Effect.flip(
					receipts.registerWorkflow(loser, "ConcurrentWorkflow", "workflow-owner-race"),
				)).message,
			).toBe("Workflow belongs to another account generation");
		}),
	);

	test.effect("commits source and receipt together and replays after the source is deleted", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({
						id: owner,
						name: "Owner",
						email: "receipt@example.test",
						accountGeneration: "test-account-generation",
					})
					.onConflictDoNothing(),
			);
			const failed = yield* session
				.transaction(
					Effect.gen(function* () {
						yield* session.run((db) =>
							db
								.insert(tables.entity)
								.values({
									id: entityId,
									userId: owner,
									name: "Record",
									entitySchemaSlug: "record",
								}),
						);
						yield* receipts.insert({
							dispatch: [],
							result: { entityId },
							identity: identity("Record"),
						});
						return yield* new DbError({ message: "Rollback source and receipt" });
					}),
				)
				.pipe(Effect.flip);
			expect(failed.message).toBe("Rollback source and receipt");
			expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
			expect(yield* session.transaction(receipts.lookup(identity("Record"), Result))).toBeNull();

			yield* session.transaction(
				Effect.gen(function* () {
					yield* session.run((db) =>
						db
							.insert(tables.entity)
							.values({ id: entityId, userId: owner, name: "Record", entitySchemaSlug: "record" }),
					);
					yield* receipts.insert({
						dispatch: [],
						result: { entityId },
						identity: identity("Record"),
					});
				}),
			);
			expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual([]);
			expect(yield* session.run((db) => db.select().from(tables.automationRun))).toEqual([]);
			yield* session.run((db) => db.delete(tables.entity).where(eq(tables.entity.id, entityId)));
			expect(yield* session.transaction(receipts.lookup(identity("Record"), Result))).toEqual({
				dispatch: [],
				result: { entityId },
			});
			expect(
				yield* session.transaction(receipts.lookup(identity("Changed"), Result)).pipe(Effect.flip),
			).toMatchObject({
				receiptId: identity("Record").id,
				_tag: "MutationReceiptIdentityConflict",
			});
			expect(yield* session.run((db) => db.select().from(tables.entity))).toEqual([]);
		}),
	);

	test.effect("counts only committed event-item receipts and ignores decision rows", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({ id: owner, name: "Owner", email: "receipt-progress@example.test" })
					.onConflictDoNothing(),
			);
			const eventCommand = { ...command, itemIdentity: "event:0" };
			const eventReceipt = mutationReceiptIdentity({
				ownerUserId: owner,
				scopeUserId: owner,
				command: eventCommand,
				input: { properties: {} },
				commandKind: "event:create",
			});
			const batchId = receipts.batchIdentity({
				command,
				resource: "event",
				ownerUserId: owner,
				identity: ["events"],
			});
			yield* session.transaction(
				Effect.gen(function* () {
					const decision = yield* receipts.beginBatch({ pins: [], maxItems: 2, identity: batchId });
					expect(decision.candidateCount).toBe(0);
					yield* receipts.insert({
						dispatch: [],
						batchIndex: 0,
						batchId: batchId.id,
						identity: eventReceipt,
						result: { eventId: EventId.make("event-0") },
					});
					yield* receipts.insert({
						result: null,
						dispatch: [],
						batchIndex: 1,
						batchId: batchId.id,
						identity: mutationReceiptIdentity({
							input: {},
							ownerUserId: owner,
							scopeUserId: owner,
							commandKind: "event:noop",
							command: { ...command, itemIdentity: "skipped:1" },
						}),
					});
					yield* receipts.sealBatch(batchId, []);
				}),
			);
			expect(yield* receipts.countWrittenEvents(owner, command.causation.executionId)).toEqual({
				dispatch: [],
				writtenCount: 1,
			});
		}),
	);

	test.effect(
		"returns canonical references with decoded payloads and preserves the admitted pins on replay",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const receipts = yield* MutationReceipts;
				const account = { token: "batch-pin-generation", userId: UserId.make("batch-pin-owner") };
				yield* seedAccount(account);
				const batch = receipts.batchIdentity({
					resource: "entity",
					ownerUserId: account.userId,
					identity: ["canonical-pins"],
					command: { ...command, accountGeneration: account },
				});
				yield* seedPinTargets();
				const pins = [null, account.userId].map((scopeUserId, index) => ({
					id: `canonical-pin-${index}`,
					references: pinReferences(scopeUserId),
					payload: { snapshot: `snapshot-${index}` },
				}));
				yield* session.transaction(
					Effect.gen(function* () {
						const decision = yield* receipts.beginBatch({ pins, maxItems: 3, identity: batch });
						expect(yield* receipts.beginBatch({ pins: [], maxItems: 99, identity: batch })).toEqual(
							decision,
						);
						const contents = yield* receipts.batchContents(
							batch,
							Schema.Struct({ snapshot: Schema.String }),
						);
						expect(contents.pins).toEqual(
							pins.map(({ payload, references }) => ({ payload, references })),
						);
						expect(contents.maxItems).toBe(3);
						const rows = yield* session.run((db) =>
							db
								.select()
								.from(tables.mutationReceipt)
								.where(
									inArray(
										tables.mutationReceipt.id,
										pins.map(({ id }) => id),
									),
								)
								.orderBy(tables.mutationReceipt.id),
						);
						expect(
							rows.map(({ result, scopeUserId, ownerUserId }) => ({
								result,
								scopeUserId,
								ownerUserId,
							})),
						).toEqual(
							pins.map(({ payload, references }) => ({
								result: payload,
								ownerUserId: account.userId,
								scopeUserId: references.scopeUserId,
							})),
						);
						yield* receipts.sealBatch(batch, []);
						expect(
							yield* receipts.batchContents(batch, Schema.Struct({ snapshot: Schema.String })),
						).toMatchObject({ pins: [], sealed: true, evidence: [] });
					}),
				);
			}),
	);

	test.effect(
		"inserts zero, multiple, and chunk-boundary candidates with bounded SQL statements",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const receipts = yield* MutationReceipts;
				yield* seedAccount(setAccount);
				yield* seedPinTargets();
				for (const { count, expectedInserts } of [
					{ count: 0, expectedInserts: 1 },
					{ count: 3, expectedInserts: 2 },
					{ expectedInserts: 2, count: insertChunkSize(tables.mutationReceipt) },
					{ expectedInserts: 3, count: insertChunkSize(tables.mutationReceipt) + 1 },
				]) {
					const batch = receipts.batchIdentity({
						resource: "entity",
						ownerUserId: setOwner,
						identity: [`bulk-pins-${count}`],
						command: { ...command, accountGeneration: setAccount },
					});
					const pins = batchPins(`bulk-pins-${count}`, count);
					const spans: Tracer.Span[] = [];
					const decision = yield* session.transaction(
						receipts
							.beginBatch({ pins, maxItems: 1, identity: batch })
							.pipe(Effect.withTracer(makeRecordingTracer(spans))),
					);
					expect(decision).toEqual({
						maxItems: 1,
						dispatch: [],
						sealed: false,
						candidateCount: count,
					});
					const statements = receiptInsertStatements(spans);
					expect(statements).toHaveLength(expectedInserts);
					for (const statement of statements) {
						expect(maxBindParameter(statement)).toBeLessThanOrEqual(bindParameterLimit);
					}
					const contents = yield* session.transaction(
						receipts.batchContents(batch, Schema.Struct({ index: Schema.Int })),
					);
					expect(contents.pins).toEqual(
						pins.map(({ payload, references }) => ({ payload, references })),
					);
					expect(contents.candidateCount).toBe(count);
					const replaySpans: Tracer.Span[] = [];
					expect(
						yield* session.transaction(
							receipts
								.beginBatch({
									maxItems: 99,
									identity: batch,
									pins: batchPins("ignored-replay-pin", 1, () => undefined),
								})
								.pipe(Effect.withTracer(makeRecordingTracer(replaySpans))),
						),
					).toEqual(decision);
					expect(receiptInsertStatements(replaySpans)).toEqual([]);
				}
			}),
	);

	test.effect("decodes every candidate before inserting the decision or any candidates", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			yield* seedAccount(setAccount);
			yield* seedPinTargets();
			const batch = receipts.batchIdentity({
				resource: "entity",
				ownerUserId: setOwner,
				identity: ["invalid-bulk-pin"],
				command: { ...command, accountGeneration: setAccount },
			});
			const lastIndex = insertChunkSize(tables.mutationReceipt);
			const pins = batchPins("invalid-bulk-pin", lastIndex + 1, (index) =>
				index === lastIndex ? undefined : { index },
			);
			const spans: Tracer.Span[] = [];
			expect(
				yield* session
					.transaction(
						receipts
							.beginBatch({ pins, maxItems: 1, identity: batch })
							.pipe(Effect.withTracer(makeRecordingTracer(spans))),
					)
					.pipe(Effect.flip),
			).toMatchObject({ _tag: "DbError", message: expect.stringContaining("Invalid batch pin") });
			expect(receiptInsertStatements(spans)).toEqual([]);
			expect(yield* receiptRowIds([batch.id, ...pins.map(({ id }) => id)])).toEqual([]);
		}),
	);

	test.effect(
		"checks admission and stored identity conflicts before decoding candidate payloads",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const receipts = yield* MutationReceipts;
				yield* seedAccount(setAccount);
				const batch = receipts.batchIdentity({
					resource: "entity",
					ownerUserId: setOwner,
					identity: ["bulk-pin-error-order"],
					command: { ...command, accountGeneration: setAccount },
				});
				yield* session.transaction(receipts.beginBatch({ pins: [], maxItems: 1, identity: batch }));
				const pins = batchPins("bulk-pin-error-order", 1, () => undefined);
				expect(
					yield* session
						.transaction(
							receipts.beginBatch({
								pins,
								maxItems: 1,
								identity: { ...batch, accountGeneration: null, inputFingerprint: "changed" },
							}),
						)
						.pipe(Effect.flip),
				).toMatchObject({
					_tag: "DbError",
					message: "Mutation command account generation is missing",
				});
				expect(
					yield* session
						.transaction(
							receipts.beginBatch({
								pins,
								maxItems: 1,
								identity: { ...batch, inputFingerprint: "changed" },
							}),
						)
						.pipe(Effect.flip),
				).toMatchObject({ receiptId: batch.id, _tag: "MutationReceiptIdentityConflict" });
			}),
	);

	test.effect(
		"rolls back the decision and earlier chunks on duplicate, FK, or conflicting pins",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const receipts = yield* MutationReceipts;
				yield* seedAccount(setAccount);
				yield* seedPinTargets();
				const stored = setIdentity("bulk-pin-existing-conflict");
				yield* session.transaction(receipts.insert(record(stored)));
				for (const failure of ["duplicate", "foreign-key", "conflict"]) {
					const batch = receipts.batchIdentity({
						resource: "entity",
						ownerUserId: setOwner,
						identity: [`failed-bulk-pins-${failure}`],
						command: { ...command, accountGeneration: setAccount },
					});
					const lastIndex = insertChunkSize(tables.mutationReceipt);
					const pins = batchPins(`failed-bulk-pins-${failure}`, lastIndex + 1);
					const first = pins[0];
					assert(first !== undefined);
					const failingPins = pins.map((pin, index) => {
						if (index !== lastIndex) {
							return pin;
						}
						return failure === "foreign-key"
							? {
									...pin,
									references: {
										...pin.references,
										scopeUserId: UserId.make("missing-bulk-pin-owner"),
									},
								}
							: { ...pin, id: failure === "duplicate" ? first.id : stored.id };
					});
					const spans: Tracer.Span[] = [];
					expect(
						yield* session
							.transaction(
								receipts
									.beginBatch({ maxItems: 1, identity: batch, pins: failingPins })
									.pipe(Effect.withTracer(makeRecordingTracer(spans))),
							)
							.pipe(Effect.flip),
					).toMatchObject({ _tag: "DbError", code: failure === "foreign-key" ? "23503" : "23505" });
					expect(receiptInsertStatements(spans)).toHaveLength(3);
					expect(yield* receiptRowIds([batch.id, ...pins.map(({ id }) => id)])).toEqual([]);
					expect(yield* session.transaction(receipts.lookup(stored, Result))).toEqual(hit);
				}
			}),
	);

	test.effect(
		"keeps distinct provider batches separate under one command and rejects changed input",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const receipts = yield* MutationReceipts;
				const refreshedContext = {
					...command,
					population: {
						rootPreviouslyPopulated: true,
						scopeEntity: {
							id: entityId,
							name: "Updated parent",
							entitySchemaPluginId: null,
							entitySchemaSlug: EntitySchemaSlug.make("record"),
						},
					},
				};
				const first = receipts.batchIdentity({
					command,
					resource: "entity",
					ownerUserId: owner,
					commandInput: { mode: "refresh" },
					identity: ["related-group", "artists", "entities"],
				});
				const second = receipts.batchIdentity({
					command,
					resource: "entity",
					ownerUserId: owner,
					commandInput: { mode: "refresh" },
					identity: ["related-group", "albums", "entities"],
				});
				const changed = receipts.batchIdentity({
					command,
					resource: "entity",
					ownerUserId: owner,
					commandInput: { mode: "ensure" },
					identity: ["related-group", "artists", "entities"],
				});
				expect(first.id).not.toBe(second.id);
				expect(first.id).toBe(changed.id);
				expect(
					receipts.batchIdentity({
						resource: "entity",
						ownerUserId: owner,
						command: refreshedContext,
						commandInput: { mode: "refresh" },
						identity: ["related-group", "artists", "entities"],
					}).inputFingerprint,
				).toBe(first.inputFingerprint);
				expect(
					mutationReceiptIdentity({
						ownerUserId: owner,
						scopeUserId: owner,
						command: refreshedContext,
						commandKind: "entity:upsert",
						input: { entityId, name: "Record" },
					}).inputFingerprint,
				).toBe(
					mutationReceiptIdentity({
						command,
						ownerUserId: owner,
						scopeUserId: owner,
						commandKind: "entity:upsert",
						input: { entityId, name: "Record" },
					}).inputFingerprint,
				);
				yield* session.transaction(
					Effect.gen(function* () {
						expect(
							(yield* receipts.beginBatch({ pins: [], maxItems: 10, identity: first })).sealed,
						).toBe(false);
						expect(
							(yield* receipts.beginBatch({ pins: [], maxItems: 10, identity: second })).sealed,
						).toBe(false);
						expect(yield* receipts.lookupBatch(changed).pipe(Effect.flip)).toMatchObject({
							receiptId: first.id,
							_tag: "MutationReceiptIdentityConflict",
						});
					}),
				);
			}),
	);

	test.effect("serializes concurrent attempts for the same receipt identity", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			yield* session.run((db) =>
				db
					.insert(tables.user)
					.values({ id: owner, name: "Owner", email: "receipt-concurrent@example.test" })
					.onConflictDoNothing(),
			);
			const concurrent = mutationReceiptIdentity({
				ownerUserId: owner,
				scopeUserId: owner,
				commandKind: "entity:create",
				input: { entityId, name: "Concurrent" },
				command: { ...command, itemIdentity: "concurrent-command" },
			});
			const inserted = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const started = yield* Deferred.make<void>();
			const finished = yield* Deferred.make<void>();
			const first = yield* Effect.forkScoped(
				session.transaction(
					Effect.gen(function* () {
						expect(yield* receipts.lookup(concurrent, Result)).toBeNull();
						yield* receipts.insert({ dispatch: [], result: { entityId }, identity: concurrent });
						yield* Deferred.succeed(inserted, undefined);
						yield* Deferred.await(release);
					}),
				),
			);
			yield* Deferred.await(inserted);
			const second = yield* Effect.forkScoped(
				session.transaction(
					Effect.gen(function* () {
						yield* Deferred.succeed(started, undefined);
						const replay = yield* receipts.lookup(concurrent, Result);
						yield* Deferred.succeed(finished, undefined);
						return replay;
					}),
				),
			);
			yield* Deferred.await(started);
			expect(yield* Deferred.isDone(finished)).toBe(false);
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(first);
			expect(yield* Fiber.join(second)).toEqual({ dispatch: [], result: { entityId } });
			expect(
				(yield* session.run((db) => db.select().from(tables.mutationReceipt))).filter(
					({ id, receiptType }) => id === concurrent.id && receiptType === "item",
				),
			).toHaveLength(1);
		}),
	);

	test.effect(
		"rejects an old command after account reset cascades its receipt and recreates the same user ID",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const receipts = yield* MutationReceipts;
				const resetOwner = UserId.make("reset-receipt-owner");
				const createdAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-09-15T00:00:00.000Z"));
				const resetCommand = {
					...command,
					itemIdentity: "reset-command",
					causation: { ...command.causation, initiator: { id: resetOwner, kind: "user" as const } },
				};
				const receiptFor = (token: string) =>
					mutationReceiptIdentity({
						input: { entityId },
						scopeUserId: resetOwner,
						ownerUserId: resetOwner,
						commandKind: "event:create",
						command: { ...resetCommand, accountGeneration: { token, userId: resetOwner } },
					});
				const [first] = yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({
							createdAt,
							id: resetOwner,
							name: "First account",
							email: "reset-receipt@example.test",
						})
						.returning({ token: tables.user.accountGeneration }),
				);
				assert(first);
				yield* session.transaction(
					Effect.gen(function* () {
						expect(yield* receipts.lookup(receiptFor(first.token), Result)).toBeNull();
						yield* receipts.insert({
							dispatch: [],
							result: { entityId },
							identity: receiptFor(first.token),
						});
					}),
				);
				yield* session.run((db) => db.delete(tables.user).where(eq(tables.user.id, resetOwner)));
				const [next] = yield* session.run((db) =>
					db
						.insert(tables.user)
						.values({
							createdAt,
							id: resetOwner,
							name: "New account",
							email: "reset-receipt@example.test",
						})
						.returning({ token: tables.user.accountGeneration }),
				);
				assert(next);
				expect(next.token).not.toBe(first.token);
				expect(
					yield* session
						.transaction(receipts.lookup(receiptFor(first.token), Result))
						.pipe(Effect.flip),
				).toMatchObject({ message: "Mutation command belongs to a retired account" });
				expect(
					yield* session
						.transaction(
							receipts.lookup(
								mutationReceiptIdentity({
									input: { entityId },
									ownerUserId: resetOwner,
									scopeUserId: resetOwner,
									commandKind: "event:create",
									command: { ...resetCommand, accountGeneration: null },
								}),
								Result,
							),
						)
						.pipe(Effect.flip),
				).toMatchObject({ message: "Mutation command account generation is missing" });
				expect(
					yield* session.transaction(receipts.lookup(receiptFor(next.token), Result)),
				).toBeNull();
			}),
	);

	test.effect("looks up a set of receipts exactly as sequential lookups would", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			yield* seedAccount(setAccount);
			const [first, second, missing] = ["set-first", "set-second", "set-missing"].map((name) =>
				setIdentity(name),
			);
			assert(first && second && missing);
			yield* session.transaction(receipts.insertMany([record(first), record(second)]));
			const sequential = (identities: ReadonlyArray<MutationReceiptIdentity>) =>
				session.transaction(
					Effect.forEach(identities, (receipt) => receipts.lookup(receipt, Result)),
				);
			const many = (identities: ReadonlyArray<MutationReceiptIdentity>) =>
				session.transaction(receipts.lookupMany(identities, Result));
			const replayed = [first, missing, second, first];
			expect(yield* many(replayed)).toEqual([hit, null, hit, hit]);
			expect(yield* many(replayed)).toEqual(yield* sequential(replayed));
			const conflicted = [first, missing, second, { ...first, inputFingerprint: "changed" }];
			const conflict = yield* many(conflicted).pipe(Effect.flip);
			expect(conflict).toMatchObject({
				receiptId: first.id,
				_tag: "MutationReceiptIdentityConflict",
			});
			expect(conflict).toEqual(yield* sequential(conflicted).pipe(Effect.flip));
			expect(yield* many([])).toEqual([]);
		}),
	);

	test.effect("inserts a set of receipts that a later transaction replays", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			yield* seedAccount(setAccount);
			const identities = ["insert-many-a", "insert-many-b", "insert-many-c"].map((name) =>
				setIdentity(name),
			);
			yield* session.transaction(
				receipts.insertMany(
					identities.map((receipt, batchIndex) => ({ ...record(receipt), batchIndex })),
				),
			);
			expect(yield* session.transaction(receipts.lookupMany(identities, Result))).toEqual([
				hit,
				hit,
				hit,
			]);
			expect(
				yield* session.transaction(receipts.lookupMany(identities.toReversed(), Result)),
			).toEqual([hit, hit, hit]);
		}),
	);

	test.effect("rejects duplicate receipt identities before inserting any of the set", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			yield* seedAccount(setAccount);
			const unique = setIdentity("duplicate-unique");
			const repeated = setIdentity("duplicate-repeated");
			expect(
				yield* session
					.transaction(
						receipts.insertMany([
							record(unique),
							record(repeated),
							record({ ...repeated, inputFingerprint: "changed" }),
						]),
					)
					.pipe(Effect.flip),
			).toMatchObject({ message: "Mutation receipt batch repeats an identity" });
			expect(yield* receiptRowIds([unique.id, repeated.id])).toEqual([]);
		}),
	);

	test.effect("rejects a set after its account generation changes, as lookup does", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			const retired = { token: "retired-generation", userId: UserId.make("receipt-set-retired") };
			yield* seedAccount(retired);
			const receipt = setIdentity("retired-set", retired);
			yield* session.run((db) =>
				db
					.update(tables.user)
					.set({ accountGeneration: "replacement-generation" })
					.where(eq(tables.user.id, retired.userId)),
			);
			const expected = yield* session
				.transaction(receipts.lookup(receipt, Result))
				.pipe(Effect.flip);
			expect(expected).toMatchObject({ message: "Mutation command belongs to a retired account" });
			expect(
				yield* session.transaction(receipts.lookupMany([receipt], Result)).pipe(Effect.flip),
			).toEqual(expected);
			expect(
				yield* session.transaction(receipts.insertMany([record(receipt)])).pipe(Effect.flip),
			).toEqual(expected);
			expect(yield* receiptRowIds([receipt.id])).toEqual([]);
		}),
	);

	test.effect(
		"checks every identity of a shared generation for owner and scope, as lookup and insert do",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const receipts = yield* MutationReceipts;
				yield* seedAccount(setAccount);
				const other = UserId.make("receipt-set-other");
				const valid = setIdentity("shared-generation-valid");
				for (const mismatched of [
					{ ...setIdentity("shared-generation-scope"), scopeUserId: other },
					{ ...setIdentity("shared-generation-owner"), ownerUserId: other },
				]) {
					const expected = yield* session
						.transaction(
							Effect.forEach([valid, mismatched], (receipt) => receipts.lookup(receipt, Result)),
						)
						.pipe(Effect.flip);
					expect(expected).toMatchObject({
						message: "Mutation command account identity does not match its scope",
					});
					expect(
						yield* session
							.transaction(receipts.lookupMany([valid, mismatched], Result))
							.pipe(Effect.flip),
					).toEqual(expected);
					expect(
						yield* session.transaction(receipts.insert(record(mismatched))).pipe(Effect.flip),
					).toEqual(expected);
					expect(
						yield* session
							.transaction(receipts.insertMany([record(valid), record(mismatched)]))
							.pipe(Effect.flip),
					).toEqual(expected);
					expect(yield* receiptRowIds([valid.id, mismatched.id])).toEqual([]);
				}
			}),
	);

	test.effect("raises the earliest error in input order across conflicts and scope checks", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			yield* seedAccount(setAccount);
			const stored = setIdentity("error-order-stored");
			yield* session.transaction(receipts.insert(record(stored)));
			const conflict = { ...stored, inputFingerprint: "changed" };
			const scoped = {
				...setIdentity("error-order-scoped"),
				scopeUserId: UserId.make("receipt-set-other"),
			};
			const lookupMany = (identities: ReadonlyArray<MutationReceiptIdentity>) =>
				session.transaction(receipts.lookupMany(identities, Result)).pipe(Effect.flip);
			const sequential = (identities: ReadonlyArray<MutationReceiptIdentity>) =>
				session
					.transaction(Effect.forEach(identities, (receipt) => receipts.lookup(receipt, Result)))
					.pipe(Effect.flip);
			const conflictFirst = yield* lookupMany([stored, conflict, scoped]);
			expect(conflictFirst).toMatchObject({
				receiptId: stored.id,
				_tag: "MutationReceiptIdentityConflict",
			});
			expect(conflictFirst).toEqual(yield* sequential([stored, conflict, scoped]));
			const scopeFirst = yield* lookupMany([stored, scoped, conflict]);
			expect(scopeFirst).toMatchObject({
				message: "Mutation command account identity does not match its scope",
			});
			expect(scopeFirst).toEqual(yield* sequential([stored, scoped, conflict]));
		}),
	);

	test.effect("locks overlapping sets in sorted order so concurrent transactions finish", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			yield* seedAccount(setAccount);
			const low = { ...setIdentity("overlap-low"), id: "overlap-a" };
			const high = { ...setIdentity("overlap-high"), id: "overlap-b" };
			const { release } = yield* holdReceiptLock(low.id);
			const ascending = yield* Effect.forkScoped(
				session.transaction(receipts.lookupMany([low, high], Result)),
			);
			expect(yield* waitForAdvisoryWaiters(1)).toBe(true);
			const descending = yield* Effect.forkScoped(
				session.transaction(receipts.lookupMany([high, low], Result)),
			);
			expect(yield* waitForAdvisoryWaiters(2)).toBe(true);
			yield* release;
			expect(yield* Fiber.join(ascending)).toEqual([null, null]);
			expect(yield* Fiber.join(descending)).toEqual([null, null]);
		}),
	);

	test.effect("locks receipt keys in code-unit order rather than input or collation order", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			yield* seedAccount(setAccount);
			const lower = { ...setIdentity("lock-order-lower"), id: "lock-order-a" };
			const upper = { ...setIdentity("lock-order-upper"), id: "Lock-order-B" };
			const { release } = yield* holdReceiptLock(lower.id);
			const waiting = yield* Effect.forkScoped(
				session.transaction(receipts.lookupMany([lower, upper], Result)),
			);
			expect(yield* waitForAdvisoryWaiters(1)).toBe(true);
			const [upperLock] = yield* session.transaction(
				session.run((db) =>
					db.execute<{ readonly locked: boolean }>(
						sql`select pg_try_advisory_xact_lock(hashtext(${`mutation-receipt:${upper.id}`})) as locked`,
						"objects",
					),
				),
			);
			expect(upperLock?.locked).toBe(false);
			yield* release;
			expect(yield* Fiber.join(waiting)).toEqual([null, null]);
		}),
	);

	test.effect("serializes a set lookup with a concurrent single lookup of the same receipt", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			yield* seedAccount(setAccount);
			const shared = setIdentity("serialize-lookup-shared");
			const other = setIdentity("serialize-lookup-other");
			const inserted = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const writer = yield* Effect.forkScoped(
				session.transaction(
					Effect.gen(function* () {
						expect(yield* receipts.lookup(shared, Result)).toBeNull();
						yield* receipts.insert(record(shared));
						yield* Deferred.succeed(inserted, undefined);
						yield* Deferred.await(release);
					}),
				),
			);
			yield* Deferred.await(inserted);
			const reader = yield* Effect.forkScoped(
				session.transaction(receipts.lookupMany([other, shared], Result)),
			);
			expect(yield* waitForAdvisoryWaiters(1)).toBe(true);
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(writer);
			expect(yield* Fiber.join(reader)).toEqual([null, hit]);
		}),
	);

	test.effect("takes its own receipt locks when inserting a set without a prior lookup", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const receipts = yield* MutationReceipts;
			yield* seedAccount(setAccount);
			const shared = setIdentity("serialize-insert-shared");
			const inserted = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const writer = yield* Effect.forkScoped(
				session.transaction(
					Effect.gen(function* () {
						yield* receipts.insertMany([
							record(setIdentity("serialize-insert-other")),
							record(shared),
						]);
						yield* Deferred.succeed(inserted, undefined);
						yield* Deferred.await(release);
					}),
				),
			);
			yield* Deferred.await(inserted);
			const reader = yield* Effect.forkScoped(session.transaction(receipts.lookup(shared, Result)));
			expect(yield* waitForAdvisoryWaiters(1)).toBe(true);
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(writer);
			expect(yield* Fiber.join(reader)).toEqual(hit);
		}),
	);
});
