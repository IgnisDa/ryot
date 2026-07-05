import type { AutomationPolicyInput } from "@ryot/sandbox-sdk/automation";
import { Effect } from "@ryot/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot/sandbox-sdk/testing";
import type { JsonValue } from "@ryot/sandbox-sdk/wire";
import { expect, it } from "vitest";

import { execution, hostSuccess, policyAutomationContext } from "./automation-test-utils";
import definition, { manifest } from "./library-membership-policy.sandbox";

const rows = (entityIds: string[]) => ({
	data: {
		items: entityIds.map((entityId) => ({
			entityId: { value: entityId, displayValue: entityId },
		})),
		pageInfo: { total: entityIds.length, hasMore: false, nextCursor: null },
	},
});

const run = (
	context: AutomationPolicyInput,
	host: ReturnType<typeof defineSandboxTestHost<typeof manifest>>,
) => definition.run(context, host, execution);

const collectionPolicyContext = (entitySchemaSlug: string) => {
	const context = policyAutomationContext({
		entitySchemaSlug: "collection",
		eventSchemaSlug: "add-entity-to-collection",
		properties: { entityId: "member-1", entitySchemaSlug },
	});
	return context;
};

it("awaits membership for a referenced global media entity", () => {
	const changes: JsonValue[] = [];
	let queryIndex = 0;
	const host = defineSandboxTestHost(manifest, {
		executeQueryEngine: () => hostSuccess(rows(queryIndex++ === 0 ? ["media-1"] : ["library-1"])),
		changeUserRelationships: (batches) => {
			changes.push(...batches);
			return hostSuccess([{ created: 1, deleted: 0 }]);
		},
	});

	return Effect.runPromise(
		run(policyAutomationContext({ entityId: "media-1", entitySchemaSlug: "movie" }), host).pipe(
			Effect.map((result) => {
				expect(result).toEqual({ action: "allow" });
				expect(changes).toEqual([
					{
						deletes: [],
						creates: [
							{
								properties: {},
								sourceEntityId: "media-1",
								targetEntityId: "library-1",
								relationshipSchemaSlug: "in-library",
							},
						],
					},
				]);
			}),
		),
	);
});

it("does not add membership for a user-scoped media entity", () => {
	let changeCalls = 0;
	let queryIndex = 0;
	const host = defineSandboxTestHost(manifest, {
		executeQueryEngine: () => hostSuccess(rows(queryIndex++ === 0 ? [] : ["library-1"])),
		changeUserRelationships: () => {
			changeCalls += 1;
			return hostSuccess([]);
		},
	});

	return Effect.runPromise(
		run(policyAutomationContext({ entitySchemaSlug: "movie" }), host).pipe(
			Effect.map((result) => {
				expect(result).toEqual({ action: "allow" });
				expect(changeCalls).toBe(0);
			}),
		),
	);
});

it("awaits membership for an eligible global collection member", () => {
	const changes: JsonValue[] = [];
	let queryIndex = 0;
	const host = defineSandboxTestHost(manifest, {
		executeQueryEngine: () => hostSuccess(rows(queryIndex++ === 0 ? ["member-1"] : ["library-1"])),
		changeUserRelationships: (batches) => {
			changes.push(...batches);
			return hostSuccess([{ created: 1, deleted: 0 }]);
		},
	});

	return Effect.runPromise(
		run(collectionPolicyContext("book"), host).pipe(
			Effect.map((result) => {
				expect(result).toEqual({ action: "allow" });
				expect(changes).toEqual([
					{
						deletes: [],
						creates: [
							{
								properties: {},
								sourceEntityId: "member-1",
								targetEntityId: "library-1",
								relationshipSchemaSlug: "in-library",
							},
						],
					},
				]);
			}),
		),
	);
});

it("preserves merged ownership sources on an idempotent membership upsert", () => {
	let queryIndex = 0;
	let properties = {
		owned: true,
		ownershipSources: ["plex_yank", "komga"],
		ownershipSyncedAt: "2026-01-02T00:00:00.000Z",
	};
	const host = defineSandboxTestHost(manifest, {
		executeQueryEngine: () => hostSuccess(rows(queryIndex++ === 0 ? ["member-1"] : ["library-1"])),
		changeUserRelationships: (batches) => {
			const create = batches[0]?.creates[0];
			expect(create).toEqual({
				properties: {},
				sourceEntityId: "member-1",
				targetEntityId: "library-1",
				relationshipSchemaSlug: "in-library",
			});
			properties = { ...properties, ...create?.properties };
			return hostSuccess([{ created: 0, deleted: 0 }]);
		},
	});

	return Effect.runPromise(
		run(collectionPolicyContext("book"), host).pipe(
			Effect.map((result) => {
				expect(result).toEqual({ action: "allow" });
				expect(properties).toEqual({
					owned: true,
					ownershipSources: ["plex_yank", "komga"],
					ownershipSyncedAt: "2026-01-02T00:00:00.000Z",
				});
			}),
		),
	);
});

it.each(["workout", "fixture-entity"])(
	"excludes %s collection members before querying",
	(entitySchemaSlug) => {
		let hostCalls = 0;
		const host = defineSandboxTestHost(manifest, {
			executeQueryEngine: () => {
				hostCalls += 1;
				return hostSuccess(rows([]));
			},
			changeUserRelationships: () => {
				hostCalls += 1;
				return hostSuccess([]);
			},
		});

		return Effect.runPromise(
			run(collectionPolicyContext(entitySchemaSlug), host).pipe(
				Effect.map((result) => {
					expect(result).toEqual({ action: "allow" });
					expect(hostCalls).toBe(0);
				}),
			),
		);
	},
);
