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
