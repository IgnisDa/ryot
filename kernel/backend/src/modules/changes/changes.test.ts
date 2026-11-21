import { describe, expect } from "bun:test";

import { EntityId, EventId, EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { type EntityReference, eventMutation } from "./changes";

const root = EntityId.make("root-entity");
const subject = EntityId.make("subject");
const entityOf = (reference: EntityReference) =>
	reference.kind === "existing" ? Effect.succeed(reference.entityId) : Effect.succeed(root);

describe("eventMutation", () => {
	it.effect(
		"resolves a create's entity and session and passes updates and deletes through",
		() =>
			Effect.gen(function* () {
				const anchor = { suffix: "next", eventId: EventId.make("anchor") };
				expect(
					yield* eventMutation(
						{
							kind: "create",
							orderAfter: anchor,
							itemIdentity: "created",
							properties: { value: 1 },
							eventSchemaSlug: "logged",
							session: { kind: "root" },
							occurredAt: "2026-01-01T00:00:00.000Z",
							entity: { kind: "existing", entityId: subject },
						},
						entityOf,
					),
				).toEqual({
					kind: "create",
					itemIdentity: "created",
					item: {
						entityId: subject,
						orderAfter: anchor,
						sessionEntityId: root,
						properties: { value: 1 },
						occurredAt: "2026-01-01T00:00:00.000Z",
						eventSchemaSlug: EventSchemaSlug.make("logged"),
					},
				});
				const update = {
					kind: "update" as const,
					itemIdentity: "updated",
					item: {
						eventId: EventId.make("event-1"),
						patch: { properties: { remove: [], set: { value: 2 } } },
					},
				};
				expect(yield* eventMutation(update, entityOf)).toEqual(update);
				const remove = {
					kind: "delete" as const,
					itemIdentity: "deleted",
					eventId: EventId.make("event-2"),
				};
				expect(yield* eventMutation(remove, entityOf)).toEqual(remove);
			}),
		testTimeout,
	);

	it.effect(
		"fails a create whose reference cannot be resolved",
		() =>
			Effect.gen(function* () {
				expect(
					yield* Effect.flip(
						eventMutation(
							{
								kind: "create",
								properties: {},
								itemIdentity: "created",
								entity: { kind: "root" },
								eventSchemaSlug: "logged",
							},
							(reference: EntityReference) =>
								reference.kind === "existing"
									? Effect.succeed(reference.entityId)
									: Effect.fail("root-required"),
						),
					),
				).toBe("root-required");
			}),
		testTimeout,
	);
});
