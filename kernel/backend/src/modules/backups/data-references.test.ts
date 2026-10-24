import { expect, it } from "@effect/vitest";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { Effect } from "effect";

import {
	collectEmbeddedEntityIds,
	DataReferenceError,
	rewritePropertyReferences,
} from "./data-references";

const schema = {
	fields: {
		links: {
			label: "Links",
			type: "array" as const,
			description: "Recorded event references",
			items: {
				label: "Event",
				type: "string" as const,
				description: "Source record",
				reference: { kind: "event-id" as const },
			},
		},
	},
};

const nestedReferenceSchema = {
	fields: {
		summary: { label: "Summary", type: "string" as const, description: "Ordinary text" },
		details: {
			label: "Details",
			type: "object" as const,
			description: "Nested values",
			properties: {
				summary: { label: "Summary", type: "string" as const, description: "Ordinary text" },
				eventReference: {
					type: "string" as const,
					label: "Event reference",
					description: "Related event",
					reference: { kind: "event-id" as const },
				},
				reference: {
					label: "Reference",
					type: "string" as const,
					description: "Related entity",
					reference: { required: true as const, kind: "entity-id" as const },
				},
				entityIds: {
					label: "References",
					type: "array" as const,
					description: "Ordered retained references",
					items: {
						label: "Reference",
						type: "string" as const,
						description: "Retained entity identity",
						reference: { required: true as const, kind: "entity-id" as const },
					},
				},
				groups: {
					label: "Groups",
					type: "array" as const,
					description: "Nested values",
					items: {
						label: "Group",
						type: "object" as const,
						description: "Nested group",
						properties: {
							summary: { label: "Summary", type: "string" as const, description: "Ordinary text" },
							eventReference: {
								type: "string" as const,
								label: "Event reference",
								description: "Related event",
								reference: { kind: "event-id" as const },
							},
							reference: {
								label: "Reference",
								type: "string" as const,
								description: "Related entity",
								reference: { required: true as const, kind: "entity-id" as const },
							},
						},
					},
				},
			},
		},
	},
};

const nestedValues = {
	summary: "ordinary-root",
	details: {
		reference: "entity-nested",
		summary: "ordinary-nested",
		eventReference: "event-nested",
		entityIds: ["entity-array-item", "entity-nested", "entity-array-item"],
		groups: [
			{
				reference: "entity-array-item",
				summary: "ordinary-array-item",
				eventReference: "event-array-item",
			},
		],
	},
};

it("collects nested entity references from objects and array items only", () => {
	const ids = collectEmbeddedEntityIds([
		{ properties: nestedValues, propertiesSchema: nestedReferenceSchema },
	]);

	expect(ids).toEqual(["entity-array-item", "entity-nested"]);
});

it.effect("rewrites nested entity references and preserves other values", () =>
	Effect.gen(function* () {
		const rewritten = yield* rewritePropertyReferences(
			nestedValues,
			nestedReferenceSchema,
			new Map([
				["entity-nested", "restored-entity-nested"],
				["entity-array-item", "restored-entity-array-item"],
			]),
			new Map(),
			(id) => id,
		);

		expect(rewritten).toEqual({
			summary: "ordinary-root",
			details: {
				summary: "ordinary-nested",
				eventReference: "event-nested",
				reference: "restored-entity-nested",
				entityIds: [
					"restored-entity-array-item",
					"restored-entity-nested",
					"restored-entity-array-item",
				],
				groups: [
					{
						summary: "ordinary-array-item",
						eventReference: "event-array-item",
						reference: "restored-entity-array-item",
					},
				],
			},
		});
	}),
);

it.effect("fails when a required nested entity reference has no mapping", () =>
	Effect.gen(function* () {
		assertExitFails(
			yield* Effect.exit(
				rewritePropertyReferences(
					{ details: { reference: "entity-missing" } },
					nestedReferenceSchema,
					new Map(),
					new Map(),
					(id) => id,
				),
			),
			new DataReferenceError({
				code: "missing_reference_mapping",
				message: "Missing entity reference mapping for 'entity-missing'",
			}),
		);
	}),
);

it.effect("fails when a required reference inside a nested array has no mapping", () =>
	Effect.gen(function* () {
		assertExitFails(
			yield* Effect.exit(
				rewritePropertyReferences(
					{ details: { entityIds: ["known", "missing"] } },
					nestedReferenceSchema,
					new Map([["known", "restored-known"]]),
					new Map(),
				),
			),
			new DataReferenceError({
				code: "missing_reference_mapping",
				message: "Missing entity reference mapping for 'missing'",
			}),
		);
	}),
);

it.effect("rewrites streamed event references without an event-sized identity map", () =>
	Effect.gen(function* () {
		const visited: string[] = [];
		const rewritten = yield* rewritePropertyReferences(
			{ label: "source-a", links: ["source-a", "deleted-source"] },
			schema,
			new Map(),
			new Map(),
			(id) => {
				visited.push(id);
				return `restored:${id}`;
			},
		);
		expect(rewritten).toEqual({
			label: "source-a",
			links: ["restored:source-a", "restored:deleted-source"],
		});
		expect(visited).toEqual(["source-a", "deleted-source"]);
	}),
);

it.effect("refuses event-reference rewrites without an identity resolver", () =>
	Effect.gen(function* () {
		assertExitFails(
			yield* Effect.exit(
				rewritePropertyReferences({ links: ["source-a"] }, schema, new Map(), new Map()),
			),
			new DataReferenceError({
				code: "missing_reference_mapping",
				message: "Missing event reference mapping for 'source-a'",
			}),
		);
	}),
);
