import { describe, expect, it } from "~/support/effect-test";

import { summarizeV8HeapSnapshot } from "./heap-snapshot";

const NODE_TYPES = ["hidden", "array", "string", "object", "code", "closure", "synthetic"];
const EDGE_TYPES = ["context", "element", "property", "internal", "hidden", "shortcut", "weak"];
const SECRET_URL = "https://secret.example/watch?v=dQw4w9WgXcQ";

type FixtureNode = {
	readonly type: string;
	readonly name: string;
	readonly size: number;
	readonly edges: ReadonlyArray<readonly [edgeType: string, to: number]>;
};

const heapSnapshot = (nodes: ReadonlyArray<FixtureNode>) => {
	const strings = [...new Set(["", ...nodes.map(({ name }) => name)])];
	return {
		strings,
		edges: nodes.flatMap(({ edges }) =>
			edges.flatMap(([type, to]) => [EDGE_TYPES.indexOf(type), 0, to * 6]),
		),
		nodes: nodes.flatMap((node, index) => [
			NODE_TYPES.indexOf(node.type),
			strings.indexOf(node.name),
			index * 2 + 1,
			node.size,
			node.edges.length,
			0,
		]),
		snapshot: {
			meta: {
				edge_fields: ["type", "name_or_index", "to_node"],
				edge_types: [EDGE_TYPES, "string_or_number", "node"],
				node_types: [NODE_TYPES, "string", "number", "number", "number", "number"],
				node_fields: ["type", "name", "id", "self_size", "edge_count", "trace_node_id"],
			},
		},
	};
};

/**
 * Dominators with the weak edge 2 -> 5 ignored: 1, 2, and 4 by the root; 3 by 1; 5 and 6 by 3.
 * Retained sizes: 6 = 3, 5 = 7, 3 = 15, 1 = 25, 2 = 20, 4 = 30, root = 75.
 */
const fixture = heapSnapshot([
	{
		size: 0,
		name: "",
		type: "synthetic",
		edges: [
			["element", 1],
			["element", 2],
		],
	},
	{
		size: 10,
		name: "Foo",
		type: "object",
		edges: [
			["property", 3],
			["property", 4],
		],
	},
	{
		size: 20,
		name: "Foo",
		type: "object",
		edges: [
			["property", 4],
			["weak", 5],
		],
	},
	{
		size: 5,
		name: "Foo",
		type: "object",
		edges: [
			["property", 6],
			["property", 5],
		],
	},
	{ size: 30, edges: [], type: "string", name: SECRET_URL },
	{ size: 7, edges: [], type: "closure", name: "handler" },
	{ size: 3, edges: [], type: "string", name: SECRET_URL },
]);

describe("summarizeV8HeapSnapshot", () => {
	it("computes retained sizes over strong edges only", () => {
		const summary = summarizeV8HeapSnapshot(fixture);

		expect(summary.gcRootsRetainedBytes).toBe(75);
		expect(summary.topConstructors).toContainEqual({
			count: 1,
			selfBytes: 7,
			name: "handler",
			retainedBytes: 7,
			nodeType: "closure",
		});
	});

	it("counts a group member dominated by another member of its group only once", () => {
		const summary = summarizeV8HeapSnapshot(fixture);

		expect(summary.topConstructors[0]).toEqual({
			count: 3,
			name: "Foo",
			selfBytes: 35,
			retainedBytes: 45,
			nodeType: "object",
		});
		expect(summary.byNodeType).toContainEqual({
			count: 2,
			selfBytes: 33,
			type: "string",
			retainedBytes: 33,
		});
	});

	it("never reads string node names", () => {
		const summary = summarizeV8HeapSnapshot(fixture);

		expect(summary.topConstructors.map(({ name }) => name)).toContain("(string)");
		expect(JSON.stringify(summary)).not.toContain("secret.example");
	});

	it("ignores shortcut edges that do not leave the synthetic root", () => {
		const summary = summarizeV8HeapSnapshot(
			heapSnapshot([
				{
					size: 0,
					name: "",
					type: "synthetic",
					edges: [
						["shortcut", 1],
						["element", 2],
					],
				},
				{ size: 4, edges: [], type: "object", name: "Global" },
				{ size: 6, type: "object", name: "Holder", edges: [["shortcut", 3]] },
				{ size: 9, edges: [], type: "object", name: "Orphan" },
			]),
		);

		expect(summary.reachableNodeCount).toBe(3);
		expect(summary.gcRootsRetainedBytes).toBe(10);
	});
});
