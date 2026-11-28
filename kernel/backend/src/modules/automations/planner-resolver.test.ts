import { describe, expect } from "bun:test";

import { AutomationTrigger } from "@ryot-app/contract/modules/automations/lifecycle";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Schema } from "effect";

import { triggerFixture } from "./lifecycle.test-support";
import { matchesTarget } from "./planner-resolver";

const matches = (
	owner: Parameters<typeof matchesTarget>[0],
	target: Parameters<typeof matchesTarget>[1],
	trigger: AutomationTrigger,
) => trigger.payload !== null && matchesTarget(owner, target, trigger.payload);

const first = PluginId.make("owner-a");
const second = PluginId.make("owner-b");
const eventChange = (pluginId: null | PluginId, entitySchemaSlug = "bottle") => ({
	resource: "event",
	category: "change",
	operation: "create",
	after: {
		id: "event",
		properties: {},
		entitySchemaSlug,
		entityId: "entity",
		sessionEntityId: null,
		eventSchemaSlug: "tasted",
		eventSchemaPluginId: pluginId,
		entitySchemaPluginId: pluginId,
		createdAt: "2026-10-13T00:00:00.000Z",
		updatedAt: "2026-10-13T00:00:00.000Z",
		occurredAt: "2026-10-13T00:00:00.000Z",
	},
});
const eventTarget = {
	resource: "event",
	operation: "create",
	eventSchemaSlug: "tasted",
	entitySchemaSlug: "bottle",
} as const;

describe("owner-qualified hook matching", () => {
	it.effect(
		"matches explicit kernel collection observers without treating equal plugin names as kernel ownership",
		() =>
			Effect.gen(function* () {
				const target = {
					resource: "event",
					operation: "create",
					owner: { kind: "kernel" },
					entitySchemaSlug: "collection",
					eventSchemaSlug: "add-entity-to-collection",
				} as const;
				const payload = eventChange(null, "collection");
				const kernel = yield* Schema.decodeUnknownEffect(AutomationTrigger)({
					...triggerFixture(),
					kind: { resource: "event", category: "change", operation: "create" },
					payload: {
						...payload,
						after: { ...payload.after, eventSchemaSlug: target.eventSchemaSlug },
					},
				});
				expect(matches(definitionOwner(first), target, kernel)).toBe(true);
				const plugin = yield* Schema.decodeUnknownEffect(AutomationTrigger)({
					...kernel,
					payload: {
						...payload,
						after: {
							...payload.after,
							eventSchemaPluginId: first,
							entitySchemaPluginId: first,
							eventSchemaSlug: target.eventSchemaSlug,
						},
					},
				});
				expect(matches(definitionOwner(first), target, plugin)).toBe(false);
				const { owner: _owner, ...local } = target;
				expect(matches(definitionOwner(first), local, plugin)).toBe(true);
				expect(matches(definitionOwner(second), local, plugin)).toBe(false);
				expect(matches(definitionOwner(first), local, kernel)).toBe(false);
			}),
		testTimeout,
	);
	it("does not substitute another plugin or kernel owner for a same-named signal", () => {
		const target = {
			operation: "emit",
			resource: "signal",
			signalSchemaSlug: "fixture.signal",
		} as const;
		expect(matches(definitionOwner(first), target, triggerFixture("signal", first))).toBe(true);
		expect(matches(definitionOwner(second), target, triggerFixture("signal", first))).toBe(false);
		expect(matches(definitionOwner(null), target, triggerFixture("signal", first))).toBe(false);
	});
	it.effect(
		"requires the stored event owner and parent entity schema",
		() =>
			Effect.gen(function* () {
				const trigger = yield* Schema.decodeUnknownEffect(AutomationTrigger)({
					...triggerFixture(),
					payload: eventChange(first),
					kind: { resource: "event", category: "change", operation: "create" },
				});
				expect(matches(definitionOwner(first), eventTarget, trigger)).toBe(true);
				expect(matches(definitionOwner(second), eventTarget, trigger)).toBe(false);
				expect(
					matches(
						definitionOwner(first),
						{ ...eventTarget, entitySchemaSlug: "distillery" },
						trigger,
					),
				).toBe(false);
			}),
		testTimeout,
	);
	it.effect(
		"matches captured batch evidence only when that owner has a matching item",
		() =>
			Effect.gen(function* () {
				const trigger = yield* Schema.decodeUnknownEffect(AutomationTrigger)({
					...triggerFixture(),
					kind: { resource: "event", category: "change", operation: "batch" },
					payload: {
						resource: "event",
						category: "change",
						operation: "batch",
						items: [eventChange(first), eventChange(second, "distillery")],
					},
				});
				expect(matches(definitionOwner(first), eventTarget, trigger)).toBe(true);
				expect(matches(definitionOwner(second), eventTarget, trigger)).toBe(false);
			}),
		testTimeout,
	);
});
