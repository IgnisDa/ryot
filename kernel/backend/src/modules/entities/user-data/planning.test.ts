import { expect, it } from "@effect/vitest";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";
import { assert } from "vitest";

import {
	embeddedEntityReferences,
	mergeChildReferences,
	rewriteEntityProperties,
	type UserStateGraph,
} from "./planning";

const graph = (
	items: { id: string; name?: string; number?: number }[],
	matchName = false,
): UserStateGraph => ({
	evidence: [],
	entityIds: items.map(({ id }) => EntityId.make(id)),
	currentEntityIds: items.map(({ id }) => EntityId.make(id)),
	children: [
		{
			declaration: {
				matchName,
				path: ["parts"],
				entitySchemaSlug: "part",
				identityProperties: ["number"],
			},
			items: items.map(({ id, name, number }) => ({
				name: name ?? id,
				id: EntityId.make(id),
				updatedAt: "2026-01-01T00:00:00.000Z",
				properties: number === undefined ? {} : { number },
			})),
		},
	],
});

it.effect("maps recorded children without requiring matches for unused inventory", () =>
	Effect.gen(function* () {
		expect(
			yield* mergeChildReferences(
				graph([
					{ number: 1, id: "source" },
					{ number: 2, id: "unused" },
				]),
				graph([{ number: 1, id: "target" }]),
				new Set(["source"]),
			),
		).toEqual([{ from: "source", into: "target" }]);
	}),
);

it.effect.each([
	{ target: [], source: [{ number: 1, id: "source" }] },
	{
		source: [{ number: 1, id: "source" }],
		target: [
			{ id: "a", number: 1 },
			{ id: "b", number: 1 },
		],
	},
	{
		target: [{ number: 1, id: "target" }],
		source: [
			{ number: 1, id: "source" },
			{ number: 1, id: "duplicate" },
		],
	},
	{ source: [{ id: "source" }], target: [{ id: "target" }] },
])(
	"refuses missing, ambiguous or incomplete child identities before moving data",
	({ source, target }) =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				mergeChildReferences(graph(source), graph(target), new Set(["source"])),
			);
			expect(error.reason.code).toBe("child-mapping-conflict");
			assert(error.reason.code === "child-mapping-conflict");
			expect(error.reason.entityIds).toEqual(["source"]);
			expect(error.reason.message).toContain("No data was moved");
		}),
);

it.effect("requires matching names where declared and excludes retired destination children", () =>
	Effect.gen(function* () {
		const source = graph([{ number: 1, id: "source", name: " First " }], true);
		const target = graph([{ number: 1, id: "target", name: "first" }], true);
		expect(yield* mergeChildReferences(source, target, new Set(["source"]))).toEqual([
			{ from: "source", into: "target" },
		]);
		target.currentEntityIds = [];
		expect(
			(yield* Effect.flip(mergeChildReferences(source, target, new Set(["source"])))).reason.code,
		).toBe("child-mapping-conflict");
		expect(
			(yield* Effect.flip(
				mergeChildReferences(
					source,
					graph([{ number: 1, name: "Other", id: "different" }], true),
					new Set(["source"]),
				),
			)).reason.code,
		).toBe("child-mapping-conflict");
	}),
);

it.effect("reports the full conflict count with bounded diagnostic details", () =>
	Effect.gen(function* () {
		const source = graph(
			Array.from({ length: 1000 }, (_, number) => ({ number, id: `source-${number}` })),
		);
		const error = yield* Effect.flip(
			mergeChildReferences(source, graph([]), new Set(source.entityIds)),
		);
		assert(error.reason.code === "child-mapping-conflict");
		expect(error.reason.entityIds).toHaveLength(10);
		expect(error.reason.message).toContain("1000 child item(s)");
		expect(error.reason.message).toContain("showing the first 10");
		expect(source.children[0]?.items).toHaveLength(1000);
	}),
);

it("moves declared embedded entity references without changing evidence, event IDs or ordinary text", () => {
	const entity = {
		type: "string",
		label: "Entity",
		description: "Entity",
		reference: { kind: "entity-id" },
	} as const;
	const schema = {
		fields: {
			subject: entity,
			label: { type: "string", label: "Label", description: "Label" },
			children: { type: "array", items: entity, label: "Children", description: "Children" },
			event: {
				type: "string",
				label: "Event",
				description: "Event",
				reference: { kind: "event-id" },
			},
			nested: {
				type: "object",
				label: "Nested",
				description: "Nested",
				properties: { target: entity },
			},
		},
	} as const;
	const properties = {
		total: 3,
		frozen: true,
		event: "source",
		label: "source",
		subject: "source",
		children: ["episode", "unrelated"],
		nested: { retained: 7, target: "episode" },
	};
	expect(new Set(embeddedEntityReferences(properties, schema))).toEqual(
		new Set(["source", "episode", "unrelated"]),
	);
	expect(
		rewriteEntityProperties(
			properties,
			schema,
			new Map([
				["source", "target"],
				["episode", "replacement"],
			]),
		),
	).toEqual({
		total: 3,
		frozen: true,
		event: "source",
		label: "source",
		subject: "target",
		children: ["replacement", "unrelated"],
		nested: { retained: 7, target: "replacement" },
	});
	expect(properties.subject).toBe("source");
});
