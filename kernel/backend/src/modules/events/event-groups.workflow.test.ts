import { assert, expect, layer } from "@effect/vitest";
import { EntityUserDataBadRequest } from "@ryot-app/contract/modules/entity-user-data/schemas";
import { EventBadRequest } from "@ryot-app/contract/modules/events/schemas";
import { UserCommand } from "@ryot-app/contract/modules/mutations/user-command";
import { EntityId, EntitySchemaSlug, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { and, eq } from "drizzle-orm";
import { Effect, Exit, Schema } from "effect";

import { EntitiesRepository } from "#modules/entities/repository";
import { EntitiesService } from "#modules/entities/service";
import { EntityUserDataService } from "#modules/entities/user-data/service";
import { command } from "#modules/relationships/lifecycle.test-support";
import { UserCommandWorkflow } from "#modules/user-commands/workflow";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { EventCreateWorkflow } from "./event-create-workflow";
import { eventGroupFixture, eventGroupWorkflowLayer } from "./event-groups.test-support";
import { EventsService } from "./service";

const compound = Effect.fnUntraced(function* (memberCount = 1) {
	const fixture = yield* eventGroupFixture();
	const input = yield* Schema.decodeUnknownEffect(UserCommand)({
		relationships: [],
		entity: {
			properties: {},
			name: "Session",
			target: { kind: "create" },
			entitySchemaSlug: "session",
		},
		events: {
			changes: [],
			creates: [
				{
					itemIdentity: "anchor",
					session: { kind: "root" },
					eventSchemaSlug: "anchor",
					entity: { kind: "existing", entityId: fixture.subjectId },
					properties: { position: 0, kind: "primary", evidence: "recorded" },
				},
				...Array.from({ length: memberCount }, (_, index) => ({
					session: { kind: "root" },
					eventSchemaSlug: "member",
					itemIdentity: `member-${index}`,
					entity: { kind: "existing", entityId: fixture.subjectId },
					properties: { position: 0, amount: index, kind: "primary" },
				})),
			],
		},
	});
	const result = yield* UserCommandWorkflow.execute({ ...fixture, input });
	return { ...fixture, input, result };
});

layer(eventGroupWorkflowLayer)((test) => {
	test.effect(
		"commits a complete group across event preparation pages and replays the same result",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound(101);
				expect(fixture.result.events).toHaveLength(102);
				expect(yield* UserCommandWorkflow.execute({ ...fixture, input: fixture.input })).toEqual(
					fixture.result,
				);
			}),
	);

	test.effect(
		"rejects standalone anchor creation and accepts a dependent-only append to an existing anchor",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound();
				const create = (slug: "anchor" | "member") =>
					EventCreateWorkflow.execute({
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
	);

	test.effect("rolls back direct last-member deletion and permits a complete batch deletion", () =>
		Effect.gen(function* () {
			const fixture = yield* compound();
			const member = fixture.result.events.find((item) => item.itemIdentity === "member-0");
			assert(member);
			const events = yield* EventsService;
			assertExitFails(
				yield* Effect.exit(
					events.delete({ userId: fixture.userId, eventId: member.eventId }, fixture.command),
				),
				new EventBadRequest({
					reason: {
						code: "mutation-conflict",
						message: "Event group constraint violated: an anchor requires its declared dependents",
					},
				}),
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
				(yield* events.deleteBatch(
					fixture.result.events.map((item) => item.eventId),
					fixture.userId,
					{
						...fixture.command,
						...command(crypto.randomUUID()),
						writeContext: fixture.command.writeContext,
					},
				)).count,
			).toBe(2);
		}),
	);

	test.effect("validates only after a whole entity cascade deletion", () =>
		Effect.gen(function* () {
			const fixture = yield* compound();
			const entities = yield* EntitiesService;
			expect(
				(yield* entities.deleteByIds([fixture.result.entityId], {
					...fixture.command,
					...command(crypto.randomUUID()),
					writeContext: fixture.command.writeContext,
				})).deletedCount,
			).toBe(1);
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
				const freshnessBefore = yield* database.run((db) =>
					db
						.select()
						.from(tables.eventStream)
						.where(eq(tables.eventStream.entityId, fixture.subjectId))
						.orderBy(tables.eventStream.id),
				);
				const root = yield* (yield* EntitiesRepository).getByIdForUser({
					userId: fixture.userId,
					entityId: fixture.result.entityId,
				});
				const anchor = fixture.result.events.find((item) => item.itemIdentity === "anchor");
				assert(root && anchor);
				const input = yield* Schema.decodeUnknownEffect(UserCommand)({
					relationships: [],
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
						creates: [],
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
					...command(crypto.randomUUID()),
					writeContext: fixture.command.writeContext,
				};
				assertExitFails(
					yield* Effect.exit(
						UserCommandWorkflow.execute({ input, userId: fixture.userId, command: failedCommand }),
					),
					new EventBadRequest({
						reason: {
							code: "mutation-conflict",
							message:
								"Event group constraint violated: retained anchor fields and properties are immutable",
						},
					}),
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
				expect(
					yield* database.run((db) =>
						db
							.select()
							.from(tables.eventStream)
							.where(eq(tables.eventStream.entityId, fixture.subjectId))
							.orderBy(tables.eventStream.id),
					),
				).toEqual(freshnessBefore);
				expect(
					yield* database.run((db) =>
						db
							.select()
							.from(tables.mutationReceipt)
							.where(
								and(
									eq(tables.mutationReceipt.receiptType, "item"),
									eq(
										tables.mutationReceipt.rootExecutionId,
										failedCommand.causation.rootExecutionId,
									),
								),
							),
					),
				).toEqual([]);
			}),
	);

	test.effect(
		"moves retained groups together during reorder while allowing newly added dependents",
		() =>
			Effect.gen(function* () {
				const fixture = yield* compound();
				const second = yield* EventCreateWorkflow.execute({
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
				const input = yield* Schema.decodeUnknownEffect(UserCommand)({
					relationships: [],
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
						creates: [
							{
								session: { kind: "root" },
								eventSchemaSlug: "member",
								itemIdentity: "new-member",
								properties: { position: 0, kind: "primary" },
								entity: { kind: "existing", entityId: fixture.subjectId },
							},
						],
						changes: [
							...fixture.result.events.map(({ eventId }) => ({ eventId, position: 1 })),
							...secondIds.map((eventId) => ({ eventId, position: 0 })),
						].map(({ eventId, position }) => ({
							kind: "update",
							itemIdentity: eventId,
							item: { eventId, patch: { properties: { remove: [], set: { position } } } },
						})),
					},
				});
				expect(
					(yield* UserCommandWorkflow.execute({
						input,
						userId: fixture.userId,
						command: {
							...fixture.command,
							...command(crypto.randomUUID()),
							writeContext: fixture.command.writeContext,
						},
					})).events,
				).toHaveLength(5);
			}),
	);

	test.effect("does not let another exact plugin borrow an existing session anchor", () =>
		Effect.gen(function* () {
			const fixture = yield* compound();
			const other = yield* eventGroupFixture();
			const result = yield* EventCreateWorkflow.execute({
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
	);

	test.effect("finalizes a subject merge after moving its anchor and all retained dependents", () =>
		Effect.gen(function* () {
			const fixture = yield* compound();
			const [destination] = yield* (yield* EntitiesRepository).insertEntities([
				{
					scope: "user",
					properties: {},
					populatedAt: null,
					name: "Destination",
					userId: fixture.userId,
					id: EntityId.make(crypto.randomUUID()),
					entitySchemaPluginId: fixture.installed.pluginId,
					entitySchemaSlug: EntitySchemaSlug.make("subject"),
				},
			]);
			assert(destination);
			const service = yield* EntityUserDataService;
			const result = yield* service.mergeEntityUserDataForCommand(
				fixture.userId,
				{
					mergeInto: destination.id,
					mergeFrom: fixture.subjectId,
					entitySchemaSlug: EntitySchemaSlug.make("subject"),
				},
				{
					...fixture.command,
					...command(crypto.randomUUID()),
					writeContext: fixture.command.writeContext,
				},
			);
			expect(result.movedEventsCount).toBe(2);
			const database = yield* DatabaseSession;
			const rows = yield* database.run((db) =>
				db.select().from(tables.event).where(eq(tables.event.entityId, destination.id)),
			);
			expect(rows.map((row) => row.id).sort()).toEqual(
				fixture.result.events.map((row) => row.eventId).sort(),
			);
		}),
	);

	test.effect("rejects a session merge that would change retained anchor sessions", () =>
		Effect.gen(function* () {
			const fixture = yield* compound();
			const [destination] = yield* (yield* EntitiesRepository).insertEntities([
				{
					scope: "user",
					properties: {},
					populatedAt: null,
					name: "Destination",
					userId: fixture.userId,
					id: EntityId.make(crypto.randomUUID()),
					entitySchemaPluginId: fixture.installed.pluginId,
					entitySchemaSlug: EntitySchemaSlug.make("session"),
				},
			]);
			assert(destination);
			const service = yield* EntityUserDataService;
			assertExitFails(
				yield* Effect.exit(
					service.mergeEntityUserDataForCommand(
						fixture.userId,
						{
							mergeInto: destination.id,
							mergeFrom: fixture.result.entityId,
							entitySchemaSlug: EntitySchemaSlug.make("session"),
						},
						{
							...fixture.command,
							...command(crypto.randomUUID()),
							writeContext: fixture.command.writeContext,
						},
					),
				),
				new EntityUserDataBadRequest({
					reason: {
						code: "state-conflict",
						message:
							"Event group constraint violated: retained anchor fields and properties are immutable",
					},
				}),
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
	);

	test.effect("admits exactly one concurrent compound command for an absent session key", () =>
		Effect.gen(function* () {
			const fixture = yield* compound();
			const root = yield* (yield* EntitiesRepository).getByIdForUser({
				userId: fixture.userId,
				entityId: fixture.result.entityId,
			});
			assert(root);
			const input = yield* Schema.decodeUnknownEffect(UserCommand)({
				relationships: [],
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
					changes: [],
					creates: [
						{
							session: { kind: "root" },
							eventSchemaSlug: "anchor",
							itemIdentity: "new-anchor",
							entity: { kind: "existing", entityId: fixture.subjectId },
							properties: { position: 1, kind: "primary", evidence: "recorded" },
						},
						{
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
						UserCommandWorkflow.execute({
							input,
							userId: fixture.userId,
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
			assertExitFails(
				failed,
				new EventBadRequest({
					reason: {
						code: "mutation-conflict",
						message:
							"Event group constraint violated: an anchor key must be unique within its session",
					},
				}),
			);
			const database = yield* DatabaseSession;
			expect(
				yield* database.run((db) =>
					db.select().from(tables.event).where(eq(tables.event.sessionEntityId, root.id)),
				),
			).toHaveLength(4);
		}),
	);
});
