import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { DbError } from "@ryot-app/contract/errors";
import { ChangeSet } from "@ryot-app/contract/modules/changes/change-set";
import { EventBadRequest } from "@ryot-app/contract/modules/events/schemas";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { EntityId, EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { eq, sql } from "drizzle-orm";
import { Effect, Exit, Layer, Schema } from "effect";

import {
	commitEventChanges,
	createEvents,
	eventDelete,
} from "#modules/changes/change-sets.test-support";
import { ChangeSets } from "#modules/changes/service";
import { Folds } from "#modules/derived-values/service";
import { unfoldedFolds } from "#modules/derived-values/test-support";
import { EntitiesRepository } from "#modules/entities/repository";
import { command } from "#modules/relationships/lifecycle.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import {
	commitChanges,
	commitUserCommand,
	eventGroupFixture,
	eventGroupWorkflowLayer,
} from "./event-groups.test-support";
import { EventMutations } from "./mutations";

const compound = Effect.fnUntraced(function* (memberCount?: number) {
	const fixture = yield* eventGroupFixture();
	const input = yield* Schema.decodeUnknownEffect(ChangeSet)({
		entity: {
			properties: {},
			name: "Session",
			target: { kind: "create" },
			entitySchemaSlug: "session",
		},
		events: {
			changes: [
				{
					kind: "create",
					itemIdentity: "anchor",
					session: { kind: "root" },
					eventSchemaSlug: "anchor",
					entity: { kind: "existing", entityId: fixture.subjectId },
					properties: { position: 0, kind: "primary", evidence: "recorded" },
				},
				...Array.from({ length: memberCount ?? 1 }, (_, index) => ({
					kind: "create" as const,
					eventSchemaSlug: "member",
					itemIdentity: `member-${index}`,
					session: { kind: "root" as const },
					entity: { kind: "existing", entityId: fixture.subjectId },
					properties: { position: 0, amount: index, kind: "primary" },
				})),
			],
		},
	});
	const result = yield* commitUserCommand({ ...fixture, input });
	return { ...fixture, input, result };
});

layer(Layer.provideMerge(eventGroupWorkflowLayer, BunCrypto.layerSecureRandom))((test) => {
	test.effect(
		"folds a commit's subjects after the commit, outside any transaction, and keeps the write when that fails",
		() =>
			Effect.gen(function* () {
				const fixture = yield* eventGroupFixture();
				const session = yield* DatabaseSession;
				const folded: Array<boolean> = [];
				const mutations = yield* EventMutations.make.pipe(
					Effect.provideService(Folds, {
						...unfoldedFolds,
						queue: () =>
							Effect.succeed([
								{ userId: fixture.userId, entityId: EntityId.make(fixture.subjectId) },
							]),
						fold: () =>
							Effect.gen(function* () {
								folded.push(yield* session.isTransactionActive);
								return folded.length === 1 ? true : yield* new DbError({ message: "Fold failed" });
							}),
					}),
				);
				const rename = (name: string) =>
					mutations.transaction(
						() =>
							session.run((db) =>
								db.execute(sql`update entity set name = ${name} where id = ${fixture.subjectId}`),
							),
						"eager",
					);
				const subjectName = session.run((db) =>
					db
						.select({ name: tables.entity.name })
						.from(tables.entity)
						.where(eq(tables.entity.id, fixture.subjectId)),
				);
				yield* rename("Changed");
				expect(yield* subjectName).toEqual([{ name: "Changed" }]);
				yield* rename("Kept");
				expect(folded).toEqual([false, false]);
				expect(yield* subjectName).toEqual([{ name: "Kept" }]);
			}),
		testTimeout,
	);

	test.effect(
		"commits a complete group across event preparation pages and replays the same result",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound(101);
				expect(fixture.result.events).toHaveLength(102);
				expect(yield* commitUserCommand({ ...fixture, input: fixture.input })).toEqual(
					fixture.result,
				);
			}),
		testTimeout,
	);

	test.effect(
		"rejects standalone anchor creation and accepts a dependent-only append to an existing anchor",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound();
				const create = (slug: "anchor" | "member") =>
					createEvents({
						userId: fixture.userId,
						command: {
							...fixture.command,
							...command(crypto.randomUUID()),
							writeContext: fixture.command.writeContext,
						},
						payload: [
							{
								entityId: fixture.subjectId,
								sessionEntityId: fixture.result.entityId,
								eventSchemaSlug: EventSchemaSlug.make(slug),
								properties: {
									kind: "primary",
									evidence: "recorded",
									position: slug === "anchor" ? 1 : 0,
								},
							},
						],
					});
				expect((yield* create("anchor")).failure?.reason.code).toBe("mutation-conflict");
				expect((yield* create("member")).count).toBe(1);
			}),
		testTimeout,
	);

	test.effect(
		"rolls back direct last-member deletion and permits a complete batch deletion",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound();
				const member = fixture.result.events.find((item) => item.itemIdentity === "member-0");
				assert(member);
				assertExitFails(
					yield* Effect.exit(
						commitEventChanges(fixture.userId, fixture.command, [eventDelete(member.eventId)]),
					),
					new EventBadRequest({ reason: { code: "mutation-conflict" } }),
				);
				const database = yield* DatabaseSession;
				expect(
					yield* database.run((db) =>
						db
							.select()
							.from(tables.event)
							.where(eq(tables.event.sessionEntityId, fixture.result.entityId)),
					),
				).toHaveLength(2);
				expect(
					yield* commitEventChanges(
						fixture.userId,
						{
							...fixture.command,
							...command(yield* randomUuid),
							writeContext: fixture.command.writeContext,
						},
						fixture.result.events.map((item) => eventDelete(item.eventId)),
					),
				).toHaveLength(2);
			}),
		testTimeout,
	);

	test.effect(
		"validates only after a whole entity cascade deletion",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound();
				const deleted = yield* (yield* ChangeSets).commit(
					{
						userId: fixture.userId,
						entities: {
							deletes: [
								{
									entityId: fixture.result.entityId,
									entitySchema: {
										slug: EntitySchemaSlug.make("session"),
										owner: definitionOwner(fixture.installed.pluginId),
									},
								},
							],
						},
					},
					{
						...fixture.command,
						...command(yield* randomUuid),
						writeContext: fixture.command.writeContext,
					},
				);
				expect(deleted.deleted).toHaveLength(1);
				const database = yield* DatabaseSession;
				expect(
					yield* database.run((db) =>
						db
							.select()
							.from(tables.event)
							.where(eq(tables.event.sessionEntityId, fixture.result.entityId)),
					),
				).toHaveLength(0);
			}),
		testTimeout,
	);

	test.effect(
		"rolls back every event page and the root update when retained frozen evidence changes",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound(51);
				const database = yield* DatabaseSession;
				const before = yield* database.run((db) =>
					db
						.select()
						.from(tables.event)
						.where(eq(tables.event.sessionEntityId, fixture.result.entityId))
						.orderBy(tables.event.id),
				);
				const root = yield* (yield* EntitiesRepository).getByIdForUser({
					userId: fixture.userId,
					entityId: fixture.result.entityId,
				});
				const anchor = fixture.result.events.find((item) => item.itemIdentity === "anchor");
				assert(root && anchor);
				const input = yield* Schema.decodeUnknownEffect(ChangeSet)({
					entity: {
						name: "Rejected name",
						properties: root.properties,
						entitySchemaSlug: "session",
						target: {
							kind: "update",
							entityId: root.id,
							expected: { name: root.name, updatedAt: root.updatedAt, properties: root.properties },
						},
					},
					events: {
						changes: [
							...fixture.result.events
								.filter((item) => item.itemIdentity !== "anchor")
								.map((item) => ({
									kind: "update",
									itemIdentity: `update-${item.itemIdentity}`,
									item: {
										eventId: item.eventId,
										patch: { properties: { remove: [], set: { amount: 99 } } },
									},
								})),
							{
								kind: "update",
								itemIdentity: "change-evidence",
								item: {
									eventId: anchor.eventId,
									patch: { properties: { remove: [], set: { evidence: "replacement" } } },
								},
							},
						],
					},
				});
				const failedCommand = {
					...fixture.command,
					...command(yield* randomUuid),
					writeContext: fixture.command.writeContext,
				};
				assertExitFails(
					yield* Effect.exit(commitUserCommand({ input, command: failedCommand })),
					new EventBadRequest({ reason: { code: "mutation-conflict" } }),
				);
				expect(
					(yield* (yield* EntitiesRepository).getByIdForUser({
						entityId: root.id,
						userId: fixture.userId,
					}))?.name,
				).toBe("Session");
				expect(
					yield* database.run((db) =>
						db
							.select()
							.from(tables.event)
							.where(eq(tables.event.sessionEntityId, fixture.result.entityId))
							.orderBy(tables.event.id),
					),
				).toEqual(before);
			}),
		testTimeout,
	);

	test.effect(
		"moves retained groups together during reorder while allowing newly added dependents",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound();
				const second = yield* createEvents({
					userId: fixture.userId,
					command: {
						...fixture.command,
						...command(yield* randomUuid),
						writeContext: fixture.command.writeContext,
					},
					payload: [
						{
							entityId: fixture.subjectId,
							sessionEntityId: fixture.result.entityId,
							eventSchemaSlug: EventSchemaSlug.make("anchor"),
							properties: { position: 1, kind: "primary", evidence: "second" },
						},
						{
							entityId: fixture.subjectId,
							sessionEntityId: fixture.result.entityId,
							properties: { position: 1, kind: "primary" },
							eventSchemaSlug: EventSchemaSlug.make("member"),
						},
					],
				});
				expect(second.count).toBe(2);
				const root = yield* (yield* EntitiesRepository).getByIdForUser({
					userId: fixture.userId,
					entityId: fixture.result.entityId,
				});
				assert(root);
				const secondIds = second.outcomes.flatMap((item) =>
					item.status === "written" ? [item.eventId] : [],
				);
				const input = yield* Schema.decodeUnknownEffect(ChangeSet)({
					entity: {
						name: root.name,
						properties: root.properties,
						entitySchemaSlug: "session",
						target: {
							kind: "update",
							entityId: root.id,
							expected: { name: root.name, updatedAt: root.updatedAt, properties: root.properties },
						},
					},
					events: {
						changes: [
							{
								kind: "create",
								session: { kind: "root" },
								eventSchemaSlug: "member",
								itemIdentity: "new-member",
								properties: { position: 0, kind: "primary" },
								entity: { kind: "existing", entityId: fixture.subjectId },
							},
							...[
								...fixture.result.events.map(({ eventId }) => ({ eventId, position: 1 })),
								...secondIds.map((eventId) => ({ eventId, position: 0 })),
							].map(({ eventId, position }) => ({
								itemIdentity: eventId,
								kind: "update" as const,
								item: { eventId, patch: { properties: { remove: [], set: { position } } } },
							})),
						],
					},
				});
				expect(
					(yield* commitUserCommand({
						input,
						command: {
							...fixture.command,
							...command(yield* randomUuid),
							writeContext: fixture.command.writeContext,
						},
					})).events,
				).toHaveLength(5);
			}),
		testTimeout,
	);

	test.effect(
		"does not let another exact plugin borrow an existing session anchor",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound();
				const other = yield* eventGroupFixture();
				const result = yield* createEvents({
					userId: other.userId,
					command: other.command,
					payload: [
						{
							entityId: other.subjectId,
							sessionEntityId: fixture.result.entityId,
							properties: { position: 0, kind: "primary" },
							eventSchemaSlug: EventSchemaSlug.make("member"),
						},
					],
				});
				expect(result.count).toBe(0);
				expect(result.failure?.reason.code).toBe("session-entity-not-found");
			}),
		testTimeout,
	);

	test.effect(
		"finalizes a subject merge after moving its anchor and all retained dependents",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound();
				const [destination] = yield* (yield* EntitiesRepository).insertEntities([
					{
						scope: "user",
						properties: {},
						populatedAt: null,
						name: "Destination",
						userId: fixture.userId,
						id: EntityId.make(yield* randomUuid),
						entitySchemaPluginId: fixture.installed.pluginId,
						entitySchemaSlug: EntitySchemaSlug.make("subject"),
					},
				]);
				assert(destination);
				yield* commitChanges({
					command: {
						...fixture.command,
						...command(yield* randomUuid),
						writeContext: fixture.command.writeContext,
					},
					input: {
						entities: {
							merges: [
								{
									mergeInto: destination.id,
									entitySchemaSlug: "subject",
									mergeFrom: fixture.subjectId,
								},
							],
						},
					},
				});
				const database = yield* DatabaseSession;
				const rows = yield* database.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.entityId, destination.id)),
				);
				expect(rows.map((row) => row.id).sort()).toEqual(
					fixture.result.events.map((row) => row.eventId).sort(),
				);
			}),
		testTimeout,
	);

	test.effect(
		"rejects a session merge that would change retained anchor sessions",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound();
				const [destination] = yield* (yield* EntitiesRepository).insertEntities([
					{
						scope: "user",
						properties: {},
						populatedAt: null,
						name: "Destination",
						userId: fixture.userId,
						id: EntityId.make(yield* randomUuid),
						entitySchemaPluginId: fixture.installed.pluginId,
						entitySchemaSlug: EntitySchemaSlug.make("session"),
					},
				]);
				assert(destination);
				assertExitFails(
					yield* Effect.exit(
						commitChanges({
							command: {
								...fixture.command,
								...command(yield* randomUuid),
								writeContext: fixture.command.writeContext,
							},
							input: {
								entities: {
									merges: [
										{
											mergeInto: destination.id,
											entitySchemaSlug: "session",
											mergeFrom: fixture.result.entityId,
										},
									],
								},
							},
						}),
					),
					new EventBadRequest({ reason: { code: "mutation-conflict" } }),
				);
				const database = yield* DatabaseSession;
				expect(
					yield* database.run((db) =>
						db
							.select()
							.from(tables.event)
							.where(eq(tables.event.sessionEntityId, fixture.result.entityId)),
					),
				).toHaveLength(2);
			}),
		testTimeout,
	);

	test.effect(
		"admits exactly one concurrent compound command for an absent session key",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound();
				const root = yield* (yield* EntitiesRepository).getByIdForUser({
					userId: fixture.userId,
					entityId: fixture.result.entityId,
				});
				assert(root);
				const input = yield* Schema.decodeUnknownEffect(ChangeSet)({
					entity: {
						name: root.name,
						properties: root.properties,
						entitySchemaSlug: "session",
						target: {
							kind: "update",
							entityId: root.id,
							expected: { name: root.name, updatedAt: root.updatedAt, properties: root.properties },
						},
					},
					events: {
						changes: [
							{
								kind: "create",
								session: { kind: "root" },
								eventSchemaSlug: "anchor",
								itemIdentity: "new-anchor",
								entity: { kind: "existing", entityId: fixture.subjectId },
								properties: { position: 1, kind: "primary", evidence: "recorded" },
							},
							{
								kind: "create",
								session: { kind: "root" },
								eventSchemaSlug: "member",
								itemIdentity: "new-member",
								properties: { position: 1, kind: "primary" },
								entity: { kind: "existing", entityId: fixture.subjectId },
							},
						],
					},
				});
				const outcomes = yield* Effect.all(
					Array.from({ length: 2 }, () =>
						Effect.exit(
							commitUserCommand({
								input,
								command: {
									...fixture.command,
									...command(crypto.randomUUID()),
									writeContext: fixture.command.writeContext,
								},
							}),
						),
					),
					{ concurrency: 2 },
				);
				expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1);
				const failed = outcomes.find(Exit.isFailure);
				assert(failed);
				assertExitFails(failed, new EventBadRequest({ reason: { code: "mutation-conflict" } }));
				const database = yield* DatabaseSession;
				expect(
					yield* database.run((db) =>
						db.select().from(tables.event).where(eq(tables.event.sessionEntityId, root.id)),
					),
				).toHaveLength(4);
			}),
		testTimeout,
	);
});
