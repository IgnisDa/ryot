import { Effect } from "effect";

import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { createEventGroupFixture, eventGroupPayload } from "~/fixtures/kernel/event-groups";
import { listEventsForEntity, waitForCreateEvents } from "~/fixtures/kernel/events";
import { assertCondition, assertTaggedError, requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

describe("declared event groups over HTTP", () => {
	it.live(
		"rejects incomplete groups and preserves a complete group's cardinality and evidence",
		() =>
			Effect.gen(function* () {
				const { client } = yield* createAuthenticatedClient();
				const fixture = yield* createEventGroupFixture(client);
				const payload = eventGroupPayload(fixture);
				for (const item of payload) {
					const response = yield* client.call((c) => c.events.create({ payload: [item] }));
					expect(yield* waitForCreateEvents(client, response)).toMatchObject({
						count: 0,
						failure: { index: 0, reason: { code: "mutation-conflict" } },
						outcomes: [{ index: 0, status: "failed", reason: { code: "mutation-conflict" } }],
					});
				}
				expect(yield* listEventsForEntity(client, fixture.subject.id, undefined, 100)).toEqual([]);
				const response = yield* client.call((c) => c.events.create({ payload }));
				const created = yield* waitForCreateEvents(client, response);
				expect(created).toMatchObject({ count: 2, failure: null });
				const before = yield* listEventsForEntity(client, fixture.subject.id, undefined, 100);
				expect(before).toHaveLength(2);
				const anchor = requirePresent(
					before.find(({ eventSchemaSlug }) => eventSchemaSlug === "anchor"),
					"Expected the committed anchor",
				);
				const member = requirePresent(
					before.find(({ eventSchemaSlug }) => eventSchemaSlug === "member"),
					"Expected the committed member",
				);
				const appended = yield* client.call((c) =>
					c.events.create({ payload: [requirePresent(payload[1], "Expected a member draft")] }),
				);
				const appendResult = yield* waitForCreateEvents(client, appended);
				expect(appendResult.count).toBe(1);
				const appendedMember = requirePresent(
					appendResult.outcomes[0],
					"Expected the appended member",
				);
				assertCondition(
					appendedMember.status === "written",
					"Expected the member append to commit",
				);
				yield* client.call((c) => c.events.delete({ params: { eventId: appendedMember.eventId } }));
				const evidenceChange = yield* Effect.flip(
					client.call((c) =>
						c.events.update({
							params: { eventId: anchor.id },
							payload: { properties: { remove: [], set: { evidence: "replacement" } } },
						}),
					),
				);
				assertTaggedError(evidenceChange, "EventBadRequest");
				expect(evidenceChange.reason).toMatchObject({ code: "mutation-conflict" });
				for (const eventId of [anchor.id, member.id]) {
					const rejected = yield* Effect.flip(
						client.call((c) => c.events.delete({ params: { eventId } })),
					);
					assertTaggedError(rejected, "EventBadRequest");
					expect(rejected.reason).toMatchObject({ code: "mutation-conflict" });
				}
				expect(yield* listEventsForEntity(client, fixture.subject.id, undefined, 100)).toEqual(
					before,
				);
			}),
	);

	it.live("keeps matching local declarations isolated by exact plugin and account", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const first = yield* createEventGroupFixture(client);
			const second = yield* createEventGroupFixture(client);
			expect(first.pluginId).not.toBe(second.pluginId);
			const firstResponse = yield* client.call((c) =>
				c.events.create({ payload: eventGroupPayload(first) }),
			);
			expect((yield* waitForCreateEvents(client, firstResponse)).count).toBe(2);
			const secondPayload = eventGroupPayload(second, first.session.id);
			const member = requirePresent(secondPayload[1], "Expected the second plugin's member draft");
			const borrowed = yield* client.call((c) => c.events.create({ payload: [member] }));
			expect(yield* waitForCreateEvents(client, borrowed)).toMatchObject({
				count: 0,
				failure: { index: 0, reason: { code: "mutation-conflict" } },
			});
			const secondResponse = yield* client.call((c) => c.events.create({ payload: secondPayload }));
			expect((yield* waitForCreateEvents(client, secondResponse)).count).toBe(2);
			const firstEvents = yield* listEventsForEntity(client, first.subject.id, undefined, 100);
			const secondEvents = yield* listEventsForEntity(client, second.subject.id, undefined, 100);
			expect(firstEvents).toHaveLength(2);
			expect(secondEvents).toHaveLength(2);
			expect(secondEvents.map(({ sessionEntityId }) => sessionEntityId)).toEqual([
				first.session.id,
				first.session.id,
			]);
			const firstMember = requirePresent(
				firstEvents.find(({ eventSchemaSlug }) => eventSchemaSlug === "member"),
				"Expected the first plugin's member",
			);
			const lastMember = yield* Effect.flip(
				client.call((c) => c.events.delete({ params: { eventId: firstMember.id } })),
			);
			assertTaggedError(lastMember, "EventBadRequest");
			expect(lastMember.reason).toMatchObject({ code: "mutation-conflict" });

			const { client: otherClient } = yield* createAuthenticatedClient();
			expect(yield* listEventsForEntity(otherClient, first.subject.id, undefined, 100)).toEqual([]);
			const otherDelete = yield* Effect.flip(
				otherClient.call((c) => c.events.delete({ params: { eventId: firstMember.id } })),
			);
			assertTaggedError(otherDelete, "EventNotFound");
			expect(otherDelete.reason).toEqual({ code: "event-not-found", eventId: firstMember.id });
			const otherCreate = yield* otherClient.call((c) =>
				c.events.create({ payload: eventGroupPayload(first) }),
			);
			expect(yield* waitForCreateEvents(otherClient, otherCreate)).toMatchObject({
				count: 0,
				failure: { index: 0, reason: { code: "entity-not-found", entityId: first.subject.id } },
			});
			expect(yield* listEventsForEntity(client, first.subject.id, undefined, 100)).toEqual(
				firstEvents,
			);
			expect(yield* listEventsForEntity(client, second.subject.id, undefined, 100)).toEqual(
				secondEvents,
			);
		}),
	);

	it.live("admits only one concurrent complete group for an initially absent anchor key", () =>
		Effect.gen(function* () {
			const { client } = yield* createAuthenticatedClient();
			const fixture = yield* createEventGroupFixture(client);
			const results = yield* Effect.forEach(
				[0, 1],
				() =>
					Effect.gen(function* () {
						const response = yield* client.call((c) =>
							c.events.create({ payload: eventGroupPayload(fixture) }),
						);
						return yield* waitForCreateEvents(client, response);
					}),
				{ concurrency: 2 },
			);
			expect(results.map(({ count }) => count).sort((left, right) => left - right)).toEqual([0, 2]);
			const rejected = requirePresent(
				results.find(({ count }) => count === 0),
				"Expected one duplicate group to fail",
			);
			expect(rejected.failure).toMatchObject({ reason: { code: "mutation-conflict" } });
			assertCondition(
				rejected.outcomes.every((outcome) => outcome.status === "failed"),
				"Expected the rejected group's entire chunk to roll back",
			);
			expect(yield* listEventsForEntity(client, fixture.subject.id, undefined, 100)).toHaveLength(
				2,
			);
		}),
	);
});
