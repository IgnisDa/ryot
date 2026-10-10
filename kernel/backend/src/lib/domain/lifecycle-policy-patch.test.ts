import { assert, expect, it } from "@effect/vitest";
import {
	AutomationEntityCreateRequestPayload,
	AutomationEntityDeleteRequestPayload,
	AutomationEventCreateRequestPayload,
	AutomationEventDeleteRequestPayload,
	AutomationEventUpdateRequestPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import { Schema } from "effect";

import {
	applyLifecyclePolicyPatch,
	applyLifecyclePolicyPatches,
	canonicalLifecyclePolicyPatch,
} from "./lifecycle-policy-patch";

const request = Schema.decodeSync(AutomationEntityCreateRequestPayload)({
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
const timestamp = "2026-09-18T00:00:00.000Z";
const nextTimestamp = "2026-09-19T00:00:00.000Z";
const eventDraft = {
	entityId: "entity-1",
	occurredAt: timestamp,
	sessionEntityId: null,
	entitySchemaSlug: "record",
	eventSchemaSlug: "progress",
	properties: { stale: true, progress: 25 },
};
const eventSnapshot = { ...eventDraft, id: "event-1", createdAt: timestamp, updatedAt: timestamp };
const eventCreateRequest = Schema.decodeSync(AutomationEventCreateRequestPayload)({
	resource: "event",
	draft: eventDraft,
	category: "request",
	operation: "create",
});
const eventUpdateRequest = Schema.decodeSync(AutomationEventUpdateRequestPayload)({
	resource: "event",
	draft: eventDraft,
	category: "request",
	operation: "update",
	before: eventSnapshot,
});
const eventDeleteRequest = Schema.decodeSync(AutomationEventDeleteRequestPayload)({
	resource: "event",
	category: "request",
	operation: "delete",
	draft: eventSnapshot,
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
	const deletion = Schema.decodeSync(AutomationEntityDeleteRequestPayload)({
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
	const previous = Schema.decodeSync(AutomationEntityCreateRequestPayload)({
		...request,
		draft: { ...request.draft, properties: { object: { a: 1, b: 2 } } },
	});
	const successor = Schema.decodeSync(AutomationEntityCreateRequestPayload)({
		...previous,
		draft: { ...previous.draft, properties: { object: { b: 2, a: 1 } } },
	});
	expect(canonicalLifecyclePolicyPatch(previous, successor)).toBeNull();
});

it("applies event timestamp transforms and canonicalizes update property, time, and session changes", () => {
	const createResult = applyLifecyclePolicyPatch(eventCreateRequest, {
		resource: "event",
		draft: { occurredAt: nextTimestamp },
	});
	expect(createResult).toEqual({
		ok: true,
		request: {
			...eventCreateRequest,
			draft: { ...eventCreateRequest.draft, occurredAt: nextTimestamp },
		},
	});

	const successor = Schema.decodeSync(AutomationEventUpdateRequestPayload)({
		...eventUpdateRequest,
		draft: {
			...eventUpdateRequest.draft,
			occurredAt: nextTimestamp,
			properties: { progress: 50 },
			sessionEntityId: "entity-session",
		},
	});
	const patch = canonicalLifecyclePolicyPatch(eventUpdateRequest, successor);
	expect(patch).toEqual({
		resource: "event",
		draft: {
			occurredAt: nextTimestamp,
			sessionEntityId: "entity-session",
			properties: { remove: ["stale"], set: { progress: 50 } },
		},
	});
	assert(patch);
	expect(applyLifecyclePolicyPatch(eventUpdateRequest, patch)).toEqual({
		ok: true,
		request: successor,
	});
});

it("rejects event deletes and changes to event identity or schema", () => {
	expect(
		applyLifecyclePolicyPatch(eventDeleteRequest, {
			resource: "event",
			draft: { occurredAt: nextTimestamp },
		}),
	).toMatchObject({ ok: false });
	for (const successor of [
		Schema.decodeSync(AutomationEventUpdateRequestPayload)({
			...eventUpdateRequest,
			draft: { ...eventUpdateRequest.draft, entityId: "entity-2" },
		}),
		Schema.decodeSync(AutomationEventUpdateRequestPayload)({
			...eventUpdateRequest,
			draft: { ...eventUpdateRequest.draft, eventSchemaSlug: "another-progress" },
		}),
		Schema.decodeSync(AutomationEventUpdateRequestPayload)({
			...eventUpdateRequest,
			draft: { ...eventUpdateRequest.draft, entitySchemaSlug: "another-record" },
		}),
		Schema.decodeSync(AutomationEventUpdateRequestPayload)({
			...eventUpdateRequest,
			before: { ...eventUpdateRequest.before, id: "event-2" },
		}),
		Schema.decodeSync(AutomationEventUpdateRequestPayload)({
			...eventUpdateRequest,
			before: { ...eventUpdateRequest.before, entityId: "entity-2" },
		}),
		Schema.decodeSync(AutomationEventUpdateRequestPayload)({
			...eventUpdateRequest,
			before: { ...eventUpdateRequest.before, eventSchemaSlug: "another-progress" },
		}),
		Schema.decodeSync(AutomationEventUpdateRequestPayload)({
			...eventUpdateRequest,
			before: { ...eventUpdateRequest.before, entitySchemaSlug: "another-record" },
		}),
	]) {
		expect(canonicalLifecyclePolicyPatch(eventUpdateRequest, successor)).toBeNull();
	}
});
