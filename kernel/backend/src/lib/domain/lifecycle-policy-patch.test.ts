import { assert, expect, it } from "@effect/vitest";
import { AutomationRequestPayload } from "@ryot-app/contract/modules/automations/lifecycle";
import { Schema } from "effect";

import {
	applyLifecyclePolicyPatch,
	applyLifecyclePolicyPatches,
	canonicalLifecyclePolicyPatch,
} from "./lifecycle-policy-patch";

const request = Schema.decodeSync(AutomationRequestPayload.members[0])({
	resource: "entity",
	category: "request",
	operation: "create",
	draft: {
		name: "Original",
		externalId: null,
		providerId: null,
		populatedAt: null,
		entitySchemaSlug: "record",
		properties: { removed: 2, retained: 3, removeAndReset: 1 },
	},
});

it("applies removals before sets and preserves the retained request", () => {
	const original = structuredClone(request);
	const result = applyLifecyclePolicyPatch(request, {
		resource: "entity",
		draft: {
			name: "Changed",
			properties: { remove: ["removed"], set: { added: 5, removeAndReset: 4 } },
		},
	});
	expect(result).toEqual({
		ok: true,
		request: {
			...request,
			draft: {
				...request.draft,
				name: "Changed",
				properties: { added: 5, retained: 3, removeAndReset: 4 },
			},
		},
	});
	expect(request).toEqual(original);
});

it("applies ordered patches and rejects prohibited operations and mismatched resources", () => {
	expect(
		applyLifecyclePolicyPatches(request, [
			{ resource: "entity", draft: { name: "First" } },
			{ resource: "entity", draft: { name: "Second" } },
		]),
	).toMatchObject({ ok: true, request: { draft: { name: "Second" } } });
	expect(
		applyLifecyclePolicyPatch(request, {
			resource: "relationship",
			draft: { properties: { remove: [], set: { role: "owner" } } },
		}),
	).toMatchObject({ ok: false });
	const deletion = Schema.decodeSync(AutomationRequestPayload.members[2])({
		resource: "entity",
		category: "request",
		operation: "delete",
		draft: {
			id: "entity-1",
			name: "Original",
			externalId: null,
			providerId: null,
			populatedAt: null,
			entitySchemaSlug: "record",
			properties: { retained: 3 },
			createdAt: "2026-09-18T00:00:00.000Z",
			updatedAt: "2026-09-18T00:00:00.000Z",
		},
	});
	expect(deletion).toMatchObject({ resource: "entity", operation: "delete" });
	expect(
		applyLifecyclePolicyPatch(deletion, { resource: "entity", draft: { name: "Blocked" } }),
	).toMatchObject({ ok: false });
});

it("reconstructs validated normalized successors from canonical accepted patches", () => {
	const raw = applyLifecyclePolicyPatch(request, {
		resource: "entity",
		draft: { properties: { remove: ["removed"], set: { score: 1.2345 } } },
	});
	assert(raw.ok);
	const validated = {
		...raw.request,
		draft: { ...raw.request.draft, properties: { ...raw.request.draft.properties, score: 1.23 } },
	};
	const normalizedPatch = canonicalLifecyclePolicyPatch(request, validated);
	expect(normalizedPatch).toEqual({
		resource: "entity",
		draft: { properties: { remove: ["removed"], set: { score: 1.23 } } },
	});
	assert(normalizedPatch);
	const second = { ...validated, draft: { ...validated.draft, name: "Validated name" } };
	const namePatch = canonicalLifecyclePolicyPatch(validated, second);
	assert(namePatch);
	expect(applyLifecyclePolicyPatches(request, [normalizedPatch, namePatch])).toEqual({
		ok: true,
		request: second,
	});
});

it("omits canonical no-op patches for canonically equal properties", () => {
	const previous = Schema.decodeSync(AutomationRequestPayload.members[0])({
		...request,
		draft: { ...request.draft, properties: { object: { a: 1, b: 2 } } },
	});
	const successor = Schema.decodeSync(AutomationRequestPayload.members[0])({
		...previous,
		draft: { ...previous.draft, properties: { object: { b: 2, a: 1 } } },
	});
	expect(canonicalLifecyclePolicyPatch(previous, successor)).toBeNull();
});
