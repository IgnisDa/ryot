import { BunCrypto } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { EventBadRequest } from "@ryot-app/contract/modules/events/schemas";
import type { PluginEventGroup } from "@ryot-app/contract/modules/plugins/event-groups";
import {
	EntityId,
	EntitySchemaSlug,
	EventId,
	EventSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { type SQL, sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer } from "effect";

import { DefinitionRepository } from "#modules/definitions/repository";
import { relationshipDatabaseLayer, userId } from "#modules/relationships/lifecycle.test-support";
import { DatabaseSession } from "#platform/db/session";

import { EventGroupConstraints } from "./event-group-constraints";

const declaration: PluginEventGroup = {
	keyProperties: ["position"],
	immutableProperties: ["kind", "evidence"],
	dependents: [{ eventSchemaSlug: "member", matchProperties: ["position", "kind"] }],
};
const run = (statement: SQL) =>
	Effect.flatMap(DatabaseSession, (database) => database.run((db) => db.execute(statement)));
const fixture = Effect.fnUntraced(function* () {
	const definitions = yield* DefinitionRepository.make;
	const propertiesSchema: AppSchema = {
		fields: {
			kind: { label: "Kind", type: "string", description: "Kind" },
			evidence: { type: "string", label: "Evidence", description: "Evidence" },
			position: { type: "integer", label: "Position", description: "Position" },
		},
	};
	yield* definitions.replaceKernelDefinitions({
		savedViews: [],
		signalSchemas: [],
		calendarSources: [],
		relationshipSchemas: [],
		entitySchemas: [
			{
				icon: "file",
				pluginId: null,
				slug: "subject",
				name: "Subject",
				propertiesSchema: { fields: {} },
				eventSchemas: [
					{
						pluginId: null,
						slug: "anchor",
						name: "Anchor",
						propertiesSchema,
						eventGroup: declaration,
					},
					{ pluginId: null, slug: "member", name: "Member", propertiesSchema },
				],
			},
		],
	});
	const id = yield* randomUuid;
	const subjectId = EntityId.make(`${id}-subject`);
	const sessionId = EntityId.make(`${id}-session`);
	yield* run(sql`insert into entity(id, name, entity_schema_slug, properties)
		values (${subjectId}, 'Subject', 'subject', '{}'), (${sessionId}, 'Session', 'session', '{}')`);
	return {
		subjectId,
		sessionId,
		anchorId: EventId.make(`${id}-anchor`),
		memberId: EventId.make(`${id}-member`),
	};
});
type Fixture = Effect.Success<ReturnType<typeof fixture>>;
const insert = (input: Fixture, id: EventId, slug: "anchor" | "member", position = 0) =>
	run(sql`
	insert into event(id, user_id, entity_id, session_entity_id, event_schema_slug, occurred_at, properties)
	values (${id}, ${userId}, ${input.subjectId}, ${input.sessionId}, ${slug}, now(),
		jsonb_build_object('position', ${position}::int, 'kind', 'primary', 'evidence', 'recorded'))
`);
const seed = Effect.fnUntraced(function* (input: Fixture) {
	yield* insert(input, input.anchorId, "anchor");
	yield* insert(input, input.memberId, "member");
});
const capture = (input: Fixture, ids: ReadonlyArray<EventId>) =>
	Effect.flatMap(EventGroupConstraints.make, (groups) =>
		groups.capture({
			userId,
			eventIds: ids,
			drafts: [
				{
					entityId: input.subjectId,
					eventSchemaPluginId: null,
					sessionEntityId: input.sessionId,
					eventSchemaSlug: EventSchemaSlug.make("anchor"),
					entitySchemaSlug: EntitySchemaSlug.make("subject"),
				},
			],
		}),
	);
const transaction = <A, E, R>(
	input: Fixture,
	ids: ReadonlyArray<EventId>,
	work: () => Effect.Effect<A, E, R>,
) =>
	Effect.gen(function* () {
		const groups = yield* EventGroupConstraints.make;
		return yield* groups
			.transaction(
				Effect.gen(function* () {
					yield* capture(input, ids);
					return yield* work();
				}),
			)
			.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
	});
const count = Effect.fnUntraced(function* (input: Fixture) {
	const database = yield* DatabaseSession;
	const [row] = yield* database.run((db) =>
		db.execute<{ count: number }>(
			sql`select count(*)::int as count from event where session_entity_id = ${input.sessionId}`,
			"objects",
		),
	);
	assert(row);
	return row.count;
});

layer(Layer.provideMerge(relationshipDatabaseLayer(), BunCrypto.layerSecureRandom))((test) => {
	test.effect("rolls back duplicate absent-key creation after serializing the session", () =>
		Effect.gen(function* () {
			const input = yield* fixture();
			const locked = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const first = yield* Effect.forkScoped(
				transaction(input, [], () =>
					Effect.gen(function* () {
						yield* Deferred.succeed(locked, undefined);
						yield* Deferred.await(release);
						yield* seed(input);
					}),
				),
			);
			yield* Deferred.await(locked);
			const second = yield* Effect.forkScoped(
				Effect.exit(
					transaction(input, [], () =>
						Effect.gen(function* () {
							yield* insert(input, EventId.make(`${input.anchorId}-duplicate`), "anchor");
							yield* insert(input, EventId.make(`${input.memberId}-duplicate`), "member");
						}),
					),
				),
			);
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(first);
			assertExitFails(
				yield* Fiber.join(second),
				new EventBadRequest({
					reason: {
						code: "mutation-conflict",
						message:
							"Event group constraint violated: an anchor key must be unique within its session",
					},
				}),
			);
			expect(yield* count(input)).toBe(2);
		}).pipe(Effect.scoped),
	);

	test.effect("serializes two last-dependent deletions and rolls back the losing delete", () =>
		Effect.gen(function* () {
			const input = yield* fixture();
			const secondId = EventId.make(`${input.memberId}-second`);
			yield* seed(input);
			yield* insert(input, secondId, "member");
			const locked = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const first = yield* Effect.forkScoped(
				transaction(input, [input.memberId], () =>
					Effect.gen(function* () {
						yield* Deferred.succeed(locked, undefined);
						yield* Deferred.await(release);
						yield* run(sql`delete from event where id = ${input.memberId}`);
					}),
				),
			);
			yield* Deferred.await(locked);
			const second = yield* Effect.forkScoped(
				Effect.exit(
					transaction(input, [secondId], () => run(sql`delete from event where id = ${secondId}`)),
				),
			);
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(first);
			assertExitFails(
				yield* Fiber.join(second),
				new EventBadRequest({
					reason: {
						code: "mutation-conflict",
						message: "Event group constraint violated: an anchor requires its declared dependents",
					},
				}),
			);
			expect(yield* count(input)).toBe(2);
		}).pipe(Effect.scoped),
	);

	test.effect("rejects a dependent create after a concurrent complete-group deletion", () =>
		Effect.gen(function* () {
			const input = yield* fixture();
			yield* seed(input);
			const locked = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const removal = yield* Effect.forkScoped(
				transaction(input, [input.anchorId, input.memberId], () =>
					Effect.gen(function* () {
						yield* Deferred.succeed(locked, undefined);
						yield* Deferred.await(release);
						yield* run(sql`delete from event where session_entity_id = ${input.sessionId}`);
					}),
				),
			);
			yield* Deferred.await(locked);
			const addition = yield* Effect.forkScoped(
				Effect.exit(
					transaction(input, [], () =>
						insert(input, EventId.make(`${input.memberId}-new`), "member"),
					),
				),
			);
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(removal);
			assertExitFails(
				yield* Fiber.join(addition),
				new EventBadRequest({
					reason: {
						code: "mutation-conflict",
						message:
							"Event group constraint violated: every dependent requires exactly one matching anchor",
					},
				}),
			);
			expect(yield* count(input)).toBe(0);
		}).pipe(Effect.scoped),
	);

	test.effect(
		"allows a complete reorder and rejects a stale edit that rebinds a retained dependent",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				const otherAnchor = EventId.make(`${input.anchorId}-second`);
				const otherMember = EventId.make(`${input.memberId}-second`);
				const retainedMember = EventId.make(`${input.memberId}-retained`);
				yield* seed(input);
				yield* insert(input, retainedMember, "member");
				yield* insert(input, otherAnchor, "anchor", 1);
				yield* insert(input, otherMember, "member", 1);
				const locked = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const reorder = yield* Effect.forkScoped(
					transaction(
						input,
						[input.anchorId, input.memberId, retainedMember, otherAnchor, otherMember],
						() =>
							Effect.gen(function* () {
								yield* Deferred.succeed(locked, undefined);
								yield* Deferred.await(release);
								yield* run(
									sql`update event set properties = jsonb_set(properties, '{position}', to_jsonb(1 - (properties ->> 'position')::int)) where session_entity_id = ${input.sessionId}`,
								);
							}),
					),
				);
				yield* Deferred.await(locked);
				const edit = yield* Effect.forkScoped(
					Effect.exit(
						transaction(input, [input.memberId], () =>
							run(
								sql`update event set properties = jsonb_set(properties, '{position}', '0') where id = ${input.memberId}`,
							),
						),
					),
				);
				yield* Deferred.succeed(release, undefined);
				yield* Fiber.join(reorder);
				assertExitFails(
					yield* Fiber.join(edit),
					new EventBadRequest({
						reason: {
							code: "mutation-conflict",
							message:
								"Event group constraint violated: a retained dependent cannot bind to another anchor event",
						},
					}),
				);
				expect(yield* count(input)).toBe(5);
			}).pipe(Effect.scoped),
	);

	test.effect("validates one changed record while SQL checks a large session", () =>
		Effect.gen(function* () {
			const input = yield* fixture();
			yield* seed(input);
			yield* run(sql`insert into event(id, user_id, entity_id, session_entity_id, event_schema_slug, occurred_at, properties)
			select ${input.memberId} || '-bulk-' || i, ${userId}, ${input.subjectId}, ${input.sessionId}, 'member', now(),
				'{"position":0,"kind":"primary"}'::jsonb from generate_series(1, 10000) i`);
			yield* transaction(input, [input.memberId], () =>
				run(sql`delete from event where id = ${input.memberId}`),
			);
			expect(yield* count(input)).toBe(10001);
		}),
	);

	test.effect("validates every capture in a transaction once before commit", () =>
		Effect.gen(function* () {
			const input = yield* fixture();
			yield* seed(input);
			yield* transaction(input, [input.memberId], () =>
				Effect.gen(function* () {
					yield* run(sql`delete from event where id = ${input.memberId}`);
					yield* capture(input, [input.anchorId]);
					yield* run(sql`delete from event where id = ${input.anchorId}`);
				}),
			);
			expect(yield* count(input)).toBe(0);
		}),
	);

	test.effect("rejects event group capture outside an event transaction", () =>
		Effect.gen(function* () {
			const input = yield* fixture();
			const database = yield* DatabaseSession;
			assertExitFails(
				yield* Effect.exit(
					database
						.transaction(capture(input, []))
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
				),
				new DbError({ message: "Event writes require an event transaction" }),
			);
		}),
	);

	test.effect(
		"checks historical restore consistency without capturing current immutable evidence",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				yield* seed(input);
				yield* run(
					sql`update event set properties = jsonb_set(properties, '{evidence}', '"historical"') where id = ${input.anchorId}`,
				);
				const database = yield* DatabaseSession;
				const groups = yield* EventGroupConstraints.make;
				const definitions = [
					{
						pluginId: null,
						eventGroup: declaration,
						eventSchemaSlug: EventSchemaSlug.make("anchor"),
						entitySchemaSlug: EntitySchemaSlug.make("subject"),
					},
				];
				yield* database.transaction(groups.validateHistorical(userId, definitions));
				assertExitFails(
					yield* Effect.exit(
						database.transaction(
							Effect.gen(function* () {
								yield* run(sql`delete from event where id = ${input.memberId}`);
								yield* groups.validateHistorical(userId, definitions);
							}),
						),
					),
					new EventBadRequest({
						reason: {
							code: "mutation-conflict",
							message:
								"Event group constraint violated: an anchor requires its declared dependents",
						},
					}),
				);
				expect(yield* count(input)).toBe(2);
			}),
	);

	test.effect(
		"does not count another user's matching dependent when deleting the last owned dependent",
		() =>
			Effect.gen(function* () {
				const input = yield* fixture();
				yield* seed(input);
				const otherUser = `user-${yield* randomUuid}`;
				yield* run(
					sql`insert into "user"(id, name, email, account_generation) values (${otherUser}, 'Other user', ${`${otherUser}@example.test`}, 'fixture')`,
				);
				yield* run(sql`insert into event(id, user_id, entity_id, session_entity_id, event_schema_slug, occurred_at, properties)
			values (${`${input.memberId}-other`}, ${otherUser}, ${input.subjectId}, ${input.sessionId}, 'member', now(), '{"position":0,"kind":"primary"}'),
				(${`${input.anchorId}-other`}, ${otherUser}, ${input.subjectId}, ${input.sessionId}, 'anchor', now(), '{"position":0,"kind":"primary","evidence":"recorded"}')`);
				assertExitFails(
					yield* Effect.exit(
						transaction(input, [input.memberId], () =>
							run(sql`delete from event where id = ${input.memberId}`),
						),
					),
					new EventBadRequest({
						reason: {
							code: "mutation-conflict",
							message:
								"Event group constraint violated: an anchor requires its declared dependents",
						},
					}),
				);
				expect(yield* count(input)).toBe(4);
			}),
	);
});
