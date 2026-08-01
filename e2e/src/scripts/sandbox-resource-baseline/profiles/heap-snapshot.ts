import { Schema } from "effect";

import { REDACTED_NAME, sanitizeFunctionName } from "./frames";

/**
 * The flat arrays hold tens of millions of entries, so they are only checked for being arrays here;
 * elements are validated while they are copied into typed arrays.
 */
const FlatArray = Schema.declare((input: unknown): input is ReadonlyArray<unknown> =>
	Array.isArray(input),
);

/** The first entry lists the enum names; later entries describe the remaining fields. */
const TypeNames = Schema.TupleWithRest(Schema.Tuple([Schema.Array(Schema.String)]), [
	Schema.Unknown,
]);

const V8HeapSnapshot = Schema.Struct({
	nodes: FlatArray,
	edges: FlatArray,
	strings: FlatArray,
	snapshot: Schema.Struct({
		meta: Schema.Struct({
			node_types: TypeNames,
			edge_types: TypeNames,
			node_fields: Schema.Array(Schema.String),
			edge_fields: Schema.Array(Schema.String),
		}),
	}),
});

const Bytes = Schema.Finite;

export const HeapSnapshotSummary = Schema.Struct({
	nodeCount: Schema.Int,
	edgeCount: Schema.Int,
	totalSelfBytes: Bytes,
	/** Retained size of the synthetic root: every node reachable through strong edges. */
	gcRootsRetainedBytes: Bytes,
	reachableNodeCount: Schema.Int,
	byNodeType: Schema.Array(
		Schema.Struct({
			selfBytes: Bytes,
			count: Schema.Int,
			type: Schema.String,
			retainedBytes: Bytes,
		}),
	),
	topConstructors: Schema.Array(
		Schema.Struct({
			selfBytes: Bytes,
			count: Schema.Int,
			name: Schema.String,
			retainedBytes: Bytes,
			nodeType: Schema.String,
		}),
	),
});
export type HeapSnapshotSummary = typeof HeapSnapshotSummary.Type;

/**
 * Only these node types carry a constructor or function name. Every other type's name is its
 * contents (string values, regexp sources, code) and is never read.
 */
const NAMED_NODE_TYPES = new Set(["object", "closure", "native"]);
const NONE = 0xff_ff_ff_ff;

class HeapSnapshotFormatError extends Error {}

const fieldIndex = (fields: ReadonlyArray<string>, name: string) => {
	const index = fields.indexOf(name);
	if (index === -1) {
		throw new HeapSnapshotFormatError(`heap snapshot lacks the ${name} field`);
	}
	return index;
};

const integerAt = (values: ReadonlyArray<unknown>, index: number) => {
	const value = values[index];
	if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
		throw new HeapSnapshotFormatError(`heap snapshot has a malformed entry at ${index}`);
	}
	return value;
};

const decodeGraph = (json: unknown) => {
	const snapshot = Schema.decodeUnknownSync(V8HeapSnapshot)(json);
	const { meta } = snapshot.snapshot;
	const nodeTypes = meta.node_types[0];
	const edgeTypes = meta.edge_types[0];
	const nodeFieldCount = meta.node_fields.length;
	const edgeFieldCount = meta.edge_fields.length;
	const [typeField, nameField, sizeField, edgeCountField] = [
		"type",
		"name",
		"self_size",
		"edge_count",
	].map((name) => fieldIndex(meta.node_fields, name));
	const [edgeTypeField, toNodeField] = ["type", "to_node"].map((name) =>
		fieldIndex(meta.edge_fields, name),
	);
	const nodeCount = snapshot.nodes.length / nodeFieldCount;
	const edgeCount = snapshot.edges.length / edgeFieldCount;
	if (!Number.isInteger(nodeCount) || !Number.isInteger(edgeCount) || nodeCount === 0) {
		throw new HeapSnapshotFormatError("heap snapshot arrays do not match their field counts");
	}
	const nodeType = new Uint8Array(nodeCount);
	const nodeName = new Uint32Array(nodeCount);
	const selfSize = new Float64Array(nodeCount);
	const firstEdge = new Uint32Array(nodeCount + 1);
	for (let node = 0, offset = 0; node < nodeCount; node++, offset += nodeFieldCount) {
		nodeType[node] = integerAt(snapshot.nodes, offset + (typeField ?? 0));
		nodeName[node] = integerAt(snapshot.nodes, offset + (nameField ?? 0));
		selfSize[node] = integerAt(snapshot.nodes, offset + (sizeField ?? 0));
		firstEdge[node + 1] =
			(firstEdge[node] ?? 0) + integerAt(snapshot.nodes, offset + (edgeCountField ?? 0));
	}
	if (firstEdge[nodeCount] !== edgeCount) {
		throw new HeapSnapshotFormatError("heap snapshot edge counts do not match its edges");
	}
	const edgeType = new Uint8Array(edgeCount);
	const edgeTo = new Uint32Array(edgeCount);
	for (let edge = 0, offset = 0; edge < edgeCount; edge++, offset += edgeFieldCount) {
		edgeType[edge] = integerAt(snapshot.edges, offset + (edgeTypeField ?? 0));
		const toNode = integerAt(snapshot.edges, offset + (toNodeField ?? 0));
		if (toNode % nodeFieldCount !== 0 || toNode >= snapshot.nodes.length) {
			throw new HeapSnapshotFormatError(`heap snapshot edge ${edge} points outside the nodes`);
		}
		edgeTo[edge] = toNode / nodeFieldCount;
	}
	return {
		edgeTo,
		nodeType,
		nodeName,
		selfSize,
		edgeType,
		firstEdge,
		nodeCount,
		edgeCount,
		nodeTypes,
		strings: snapshot.strings,
		weakEdgeType: edgeTypes.indexOf("weak"),
		shortcutEdgeType: edgeTypes.indexOf("shortcut"),
	};
};

type Graph = ReturnType<typeof decodeGraph>;

/**
 * DevTools' retention rule: weak edges never retain, and shortcut edges only retain when they leave
 * the synthetic root (where they mark user global objects).
 */
const isRetainingEdge = (graph: Graph, from: number, edge: number) => {
	const type = graph.edgeType[edge];
	return type !== graph.weakEdgeType && (type !== graph.shortcutEdgeType || from === 0);
};

/** Iterative depth-first postorder over retaining edges from the synthetic root (node 0). */
const postorder = (graph: Graph) => {
	const postIndex = new Uint32Array(graph.nodeCount).fill(NONE);
	const nodeAt = new Uint32Array(graph.nodeCount);
	const visited = new Uint8Array(graph.nodeCount);
	const stackNode = new Uint32Array(graph.nodeCount);
	const stackEdge = new Uint32Array(graph.nodeCount);
	let top = 0;
	let count = 0;
	stackEdge[0] = graph.firstEdge[0] ?? 0;
	visited[0] = 1;
	while (top >= 0) {
		const node = stackNode[top] ?? 0;
		const edge = stackEdge[top] ?? 0;
		if (edge < (graph.firstEdge[node + 1] ?? 0)) {
			stackEdge[top] = edge + 1;
			const target = graph.edgeTo[edge] ?? 0;
			if (visited[target] === 0 && isRetainingEdge(graph, node, edge)) {
				visited[target] = 1;
				top += 1;
				stackNode[top] = target;
				stackEdge[top] = graph.firstEdge[target] ?? 0;
			}
		} else {
			postIndex[node] = count;
			nodeAt[count] = node;
			count += 1;
			top -= 1;
		}
	}
	return { nodeAt, postIndex, reachableCount: count };
};

/**
 * Cooper–Harvey–Kennedy over postorder numbers. Returns each reachable node's immediate dominator
 * as a postorder number; the root is the highest number and dominates itself.
 */
const immediateDominators = (graph: Graph, order: ReturnType<typeof postorder>) => {
	const { nodeAt, postIndex, reachableCount } = order;
	const predecessorStart = new Uint32Array(reachableCount + 1);
	const forEachRetainingEdge = (visit: (from: number, to: number) => void) => {
		for (let post = 0; post < reachableCount; post++) {
			const node = nodeAt[post] ?? 0;
			const end = graph.firstEdge[node + 1] ?? 0;
			for (let edge = graph.firstEdge[node] ?? 0; edge < end; edge++) {
				if (isRetainingEdge(graph, node, edge)) {
					visit(post, postIndex[graph.edgeTo[edge] ?? 0] ?? 0);
				}
			}
		}
	};
	forEachRetainingEdge((_from, to) => {
		predecessorStart[to + 1] = (predecessorStart[to + 1] ?? 0) + 1;
	});
	for (let post = 0; post < reachableCount; post++) {
		predecessorStart[post + 1] = (predecessorStart[post + 1] ?? 0) + (predecessorStart[post] ?? 0);
	}
	const predecessors = new Uint32Array(predecessorStart[reachableCount] ?? 0);
	const cursor = predecessorStart.slice(0, reachableCount);
	forEachRetainingEdge((from, to) => {
		predecessors[cursor[to] ?? 0] = from;
		cursor[to] = (cursor[to] ?? 0) + 1;
	});

	const root = reachableCount - 1;
	const dominator = new Uint32Array(reachableCount).fill(NONE);
	dominator[root] = root;
	const intersect = (left: number, right: number) => {
		let a = left;
		let b = right;
		while (a !== b) {
			while (a < b) {
				a = dominator[a] ?? root;
			}
			while (b < a) {
				b = dominator[b] ?? root;
			}
		}
		return a;
	};
	let changed = true;
	while (changed) {
		changed = false;
		for (let post = root - 1; post >= 0; post--) {
			let candidate = NONE;
			const end = predecessorStart[post + 1] ?? 0;
			for (let index = predecessorStart[post] ?? 0; index < end; index++) {
				const predecessor = predecessors[index] ?? 0;
				if (dominator[predecessor] === NONE) {
					continue;
				}
				candidate = candidate === NONE ? predecessor : intersect(predecessor, candidate);
			}
			if (dominator[post] !== candidate) {
				dominator[post] = candidate;
				changed = true;
			}
		}
	}
	return dominator;
};

/**
 * Sums the retained sizes of each group's members that have no dominator in the same group, so a
 * member retained by another member is not counted twice.
 */
const topLevelRetained = (
	dominator: Uint32Array,
	retained: Float64Array,
	groupOf: Int32Array,
	groupCount: number,
) => {
	const count = dominator.length;
	const root = count - 1;
	const childStart = new Uint32Array(count + 1);
	for (let post = 0; post < root; post++) {
		const parent = dominator[post] ?? 0;
		childStart[parent + 1] = (childStart[parent + 1] ?? 0) + 1;
	}
	for (let post = 0; post < count; post++) {
		childStart[post + 1] = (childStart[post + 1] ?? 0) + (childStart[post] ?? 0);
	}
	const children = new Uint32Array(Math.max(0, root));
	const cursor = childStart.slice(0, count);
	for (let post = 0; post < root; post++) {
		const parent = dominator[post] ?? 0;
		children[cursor[parent] ?? 0] = post;
		cursor[parent] = (cursor[parent] ?? 0) + 1;
	}
	const openMembers = new Uint32Array(groupCount);
	const totals = new Float64Array(groupCount);
	const stackNode = new Uint32Array(count);
	const stackChild = new Uint32Array(count);
	const enter = (post: number) => {
		const group = groupOf[post] ?? 0;
		if (openMembers[group] === 0) {
			totals[group] = (totals[group] ?? 0) + (retained[post] ?? 0);
		}
		openMembers[group] = (openMembers[group] ?? 0) + 1;
	};
	let top = 0;
	stackNode[0] = root;
	stackChild[0] = childStart[root] ?? 0;
	enter(root);
	while (top >= 0) {
		const post = stackNode[top] ?? 0;
		const child = stackChild[top] ?? 0;
		if (child < (childStart[post + 1] ?? 0)) {
			stackChild[top] = child + 1;
			const next = children[child] ?? 0;
			top += 1;
			stackNode[top] = next;
			stackChild[top] = childStart[next] ?? 0;
			enter(next);
		} else {
			const group = groupOf[post] ?? 0;
			openMembers[group] = (openMembers[group] ?? 0) - 1;
			top -= 1;
		}
	}
	return totals;
};

type GroupStats = { count: number; selfBytes: number };

export const summarizeV8HeapSnapshot = (
	json: unknown,
	options: { readonly topN?: number } = {},
): HeapSnapshotSummary => {
	const graph = decodeGraph(json);
	const order = postorder(graph);
	const dominator = immediateDominators(graph, order);
	const reachable = order.reachableCount;
	const retained = new Float64Array(reachable);
	for (let post = 0; post < reachable; post++) {
		retained[post] = graph.selfSize[order.nodeAt[post] ?? 0] ?? 0;
	}
	for (let post = 0; post < reachable - 1; post++) {
		const parent = dominator[post] ?? 0;
		retained[parent] = (retained[parent] ?? 0) + (retained[post] ?? 0);
	}

	const typeName = (type: number) => graph.nodeTypes[type] ?? `type-${type}`;
	const sanitizedNameIds = new Int32Array(graph.strings.length).fill(-1);
	const sanitizedNames = new Map<string, number>();
	const sanitizedNameList: Array<string> = [];
	const constructorKeys = new Map<number, number>();
	const constructors: Array<GroupStats & { name: string; nodeType: string }> = [];
	const types: Array<GroupStats> = graph.nodeTypes.map(() => ({ count: 0, selfBytes: 0 }));
	const constructorOf = new Int32Array(graph.nodeCount);
	let totalSelfBytes = 0;
	for (let node = 0; node < graph.nodeCount; node++) {
		const type = graph.nodeType[node] ?? 0;
		const size = graph.selfSize[node] ?? 0;
		const named = NAMED_NODE_TYPES.has(typeName(type));
		let key = -(type + 1);
		let name = `(${typeName(type)})`;
		if (named) {
			const nameIndex = graph.nodeName[node] ?? 0;
			if ((sanitizedNameIds[nameIndex] ?? -1) === -1) {
				const raw = graph.strings[nameIndex];
				const sanitized = sanitizeFunctionName(typeof raw === "string" ? raw : "");
				let id = sanitizedNames.get(sanitized);
				if (id === undefined) {
					id = sanitizedNameList.length;
					sanitizedNames.set(sanitized, id);
					sanitizedNameList.push(sanitized);
				}
				sanitizedNameIds[nameIndex] = id;
			}
			const id = sanitizedNameIds[nameIndex] ?? 0;
			key = id * 256 + type;
			name = sanitizedNameList[id] ?? REDACTED_NAME;
		}
		let group = constructorKeys.get(key);
		if (group === undefined) {
			group = constructors.length;
			constructorKeys.set(key, group);
			constructors.push({ name, count: 0, selfBytes: 0, nodeType: typeName(type) });
		}
		constructorOf[node] = group;
		const stats = constructors[group];
		if (stats !== undefined) {
			stats.count += 1;
			stats.selfBytes += size;
		}
		const typeStats = types[type] ?? { count: 0, selfBytes: 0 };
		types[type] = typeStats;
		typeStats.count += 1;
		typeStats.selfBytes += size;
		totalSelfBytes += size;
	}

	const byPost = (groupOfNode: (node: number) => number) => {
		const groups = new Int32Array(reachable);
		for (let post = 0; post < reachable; post++) {
			groups[post] = groupOfNode(order.nodeAt[post] ?? 0);
		}
		return groups;
	};
	const typeRetained = topLevelRetained(
		dominator,
		retained,
		byPost((node) => graph.nodeType[node] ?? 0),
		types.length,
	);
	const constructorRetained = topLevelRetained(
		dominator,
		retained,
		byPost((node) => constructorOf[node] ?? 0),
		constructors.length,
	);

	return {
		totalSelfBytes,
		nodeCount: graph.nodeCount,
		edgeCount: graph.edgeCount,
		reachableNodeCount: reachable,
		gcRootsRetainedBytes: retained[reachable - 1] ?? 0,
		byNodeType: types
			.map((stats, type) =>
				Object.assign(stats, { type: typeName(type), retainedBytes: typeRetained[type] ?? 0 }),
			)
			.filter(({ count }) => count > 0)
			.sort((left, right) => right.selfBytes - left.selfBytes),
		topConstructors: constructors
			.map((stats, group) =>
				Object.assign(stats, { retainedBytes: constructorRetained[group] ?? 0 }),
			)
			// The root and GC-root groupings retain nearly everything and identify no owner.
			.filter(({ nodeType }) => nodeType !== "synthetic")
			.sort((left, right) => right.retainedBytes - left.retainedBytes)
			.slice(0, options.topN ?? 30),
	};
};
