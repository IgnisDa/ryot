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

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";

import { mutationReceiptIdentity, MutationReceipts } from "./receipts";

const owner = UserId.make("receipt-owner");
const entityId = EntityId.make("receipt-entity");
const command = rootLifecycleCommand({
	source: "api",
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
