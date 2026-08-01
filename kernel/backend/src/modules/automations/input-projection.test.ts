import { expect, it } from "@effect/vitest";
import {
	AutomationAfterPayload,
	AutomationRequestPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Schema } from "effect";

import { projectAutomationAfterInput, projectAutomationPolicyInput } from "./input-projection";

const timestamp = "2026-09-18T00:00:00.000Z";
const entityDraft = (properties: Record<string, JsonValue>) => ({
	properties,
	name: "Entity",
	externalId: null,
	providerId: null,
	populatedAt: null,
	entitySchemaSlug: "record",
});
const snapshot = (properties: Record<string, JsonValue>) => ({
	...entityDraft(properties),
	id: "entity-1",
	createdAt: timestamp,
	updatedAt: timestamp,
});

it("projects update properties, population parent properties, and sorted changes without mutation", () => {
	const payload = Schema.decodeSync(AutomationAfterPayload)({
		category: "change",
		resource: "entity",
		operation: "update",
		after: snapshot({ hidden: false, status: "new", tags: [{ id: 1 }, "a"] }),
		before: snapshot({ hidden: true, status: "old", tags: ["a", "a", { id: 1 }] }),
		population: {
			rootPreviouslyPopulated: false,
			scopeEntity: { id: "entity-1", name: "Entity", entitySchemaSlug: "record" },
			parentEntity: {
				name: "Parent",
				entitySchemaSlug: "group",
				properties: { hidden: true, visible: "kept" },
			},
		},
	});
	const original = structuredClone(payload);
	const projected = projectAutomationAfterInput(payload, {
		entity: {
			properties: ["status", "tags"],
			parentEntityProperties: ["visible"],
			compareProperties: [
				{ property: "tags", equality: "unordered-array" },
				{ equality: "json", property: "status" },
			],
		},
	});
	expect(projected).toMatchObject({
		changedProperties: ["status"],
		after: { properties: { status: "new", tags: [{ id: 1 }, "a"] } },
		population: { parentEntity: { properties: { visible: "kept" } } },
		before: { properties: { status: "old", tags: ["a", "a", { id: 1 }] } },
	});
	expect(payload).toEqual(original);
});

it("recurses through batches in order and projects signals and provider imports", () => {
	const item = {
		resource: "event",
		category: "change",
		operation: "create",
		after: {
			id: "event-1",
			createdAt: timestamp,
			updatedAt: timestamp,
			entityId: "entity-1",
			occurredAt: timestamp,
			sessionEntityId: null,
			eventSchemaSlug: "view",
			entitySchemaSlug: "record",
			properties: { order: 1, hidden: true },
		},
	} as const;
	const batch = Schema.decodeSync(AutomationAfterPayload)({
		resource: "event",
		operation: "batch",
		category: "change",
		items: [item, { ...item, after: { ...item.after, id: "event-2", properties: { order: 2 } } }],
	});
	const projected = projectAutomationAfterInput(batch, {
		event: { properties: ["order"], compareProperties: [] },
	});
	expect(projected).toMatchObject({
		items: [
			{ after: { id: "event-1", properties: { order: 1 } } },
			{ after: { id: "event-2", properties: { order: 2 } } },
		],
	});
	const signal = Schema.decodeSync(AutomationAfterPayload)({
		operation: "emit",
		actorUserId: null,
		category: "signal",
		resource: "signal",
		signalSchemaPluginId: null,
		signalSchemaSlug: "notice",
		properties: { visible: 1, hidden: true },
	});
	expect(
		projectAutomationAfterInput(signal, { signal: { properties: ["visible"] } }),
	).toMatchObject({ properties: { visible: 1 } });
	expect(
		projectAutomationAfterInput(signal, {
			entity: { properties: [], compareProperties: [], parentEntityProperties: [] },
		}),
	).toBeNull();
});

it("projects policy updates and computes sorted JSON changes", () => {
	const request = Schema.decodeSync(AutomationRequestPayload)({
		resource: "entity",
		category: "request",
		operation: "update",
		before: snapshot({ a: 1, b: 1, hidden: true }),
		draft: entityDraft({ a: 2, b: 2, hidden: false }),
	});
	const projected = projectAutomationPolicyInput(request, { entity: { properties: ["b", "a"] } });
	expect(projected).toMatchObject({
		changedProperties: ["a", "b"],
		draft: { properties: { a: 2, b: 2 } },
		before: { properties: { a: 1, b: 1 } },
	});
});

it("distinguishes missing properties and implements both comparison modes", () => {
	const payload = Schema.decodeSync(AutomationAfterPayload)({
		category: "change",
		resource: "entity",
		operation: "update",
		after: snapshot({
			scalar: "same",
			addedNull: null,
			ordered: [2, 1],
			nullValue: null,
			object: { b: 2, a: 1 },
			set: [{ b: 2, a: 1 }, 1],
		}),
		before: snapshot({
			scalar: "same",
			ordered: [1, 2],
			nullValue: null,
			removedNull: null,
			object: { a: 1, b: 2 },
			set: [1, 1, { a: 1, b: 2 }],
		}),
	});
	const projected = projectAutomationAfterInput(payload, {
		entity: {
			properties: [],
			parentEntityProperties: [],
			compareProperties: [
				{ equality: "json", property: "missing" },
				{ equality: "json", property: "addedNull" },
				{ equality: "json", property: "removedNull" },
				{ equality: "json", property: "object" },
				{ equality: "json", property: "ordered" },
				{ property: "set", equality: "unordered-array" },
				{ property: "nullValue", equality: "unordered-array" },
				{ property: "scalar", equality: "unordered-array" },
			],
		},
	});
	expect(projected).toMatchObject({ changedProperties: ["addedNull", "ordered", "removedNull"] });
});

it("sorts changed property names by deterministic UTF-16 code units", () => {
	const payload = Schema.decodeSync(AutomationAfterPayload)({
		category: "change",
		resource: "entity",
		operation: "update",
		after: snapshot({ A: 1, _: 1, é: 1, "~": 1 }),
		before: snapshot({ A: 0, _: 0, é: 0, "~": 0 }),
	});
	const projected = projectAutomationAfterInput(payload, {
		entity: {
			properties: [],
			parentEntityProperties: [],
			compareProperties: ["é", "~", "_", "A"].map((property) => ({
				property,
				equality: "json" as const,
			})),
		},
	});
	expect(projected).toMatchObject({ changedProperties: ["A", "_", "~", "é"] });
});
