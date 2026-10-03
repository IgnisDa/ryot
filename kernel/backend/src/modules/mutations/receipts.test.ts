import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import {
	AutomationExecutionId,
	EntityId,
	EntitySchemaSlug,
	EventId,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { eq } from "drizzle-orm";
import { DateTime, Deferred, Effect, Fiber, Layer, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";

import { mutationReceiptIdentity, MutationReceipts } from "./receipts";
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
});
