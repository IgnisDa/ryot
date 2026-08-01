import { Schema } from "effect";

import { categorizeJscFrame, categorizeV8Frame, sanitizeFunctionName } from "./frames";

export const V8CpuProfile = Schema.Struct({
	endTime: Schema.Finite,
	startTime: Schema.Finite,
	samples: Schema.Array(Schema.Int),
	timeDeltas: Schema.Array(Schema.Finite),
	nodes: Schema.Array(
		Schema.Struct({
			id: Schema.Int,
			hitCount: Schema.optional(Schema.Int),
			children: Schema.optional(Schema.Array(Schema.Int)),
			callFrame: Schema.Struct({
				url: Schema.String,
				lineNumber: Schema.Int,
				columnNumber: Schema.Int,
				functionName: Schema.String,
				scriptId: Schema.Union([Schema.String, Schema.Int]),
			}),
		}),
	),
});
export type V8CpuProfile = typeof V8CpuProfile.Type;

export const JscStackTraces = Schema.Struct({
	interval: Schema.Finite,
	sources: Schema.Array(
		Schema.Struct({
			sourceID: Schema.Finite,
			url: Schema.optional(Schema.String),
			sourceURL: Schema.optional(Schema.String),
		}),
	),
	traces: Schema.Array(
		Schema.Struct({
			timestamp: Schema.Finite,
			frames: Schema.Array(
				Schema.Struct({
					flags: Schema.Int,
					name: Schema.String,
					line: Schema.Finite,
					sourceID: Schema.Finite,
					sourceURL: Schema.optional(Schema.String),
				}),
			),
		}),
	),
});
export type JscStackTraces = typeof JscStackTraces.Type;

const SummaryFrame = Schema.Struct({ category: Schema.String, functionName: Schema.String });

/** `share` is relative to non-idle time; the idle category itself has no share. */
export const CpuProfileSummary = Schema.Struct({
	sampleCount: Schema.Int,
	sampledDurationMs: Schema.Finite,
	source: Schema.Literals(["deno-v8", "bun-jsc"]),
	topStacks: Schema.Array(
		Schema.Struct({
			share: Schema.Finite,
			selfMs: Schema.Finite,
			frames: Schema.Array(SummaryFrame),
		}),
	),
	categories: Schema.Array(
		Schema.Struct({
			selfMs: Schema.Finite,
			category: Schema.String,
			share: Schema.NullOr(Schema.Finite),
		}),
	),
	topSelfFrames: Schema.Array(
		Schema.Struct({
			...SummaryFrame.fields,
			share: Schema.Finite,
			selfMs: Schema.Finite,
			line: Schema.NullOr(Schema.Int),
		}),
	),
});
export type CpuProfileSummary = typeof CpuProfileSummary.Type;

export type StackFrame = {
	readonly category: string;
	readonly functionName: string;
	readonly line: number | null;
};

/** One distinct sampled stack, innermost frame first, with the self time attributed to it. */
export type WeightedStack = {
	readonly selfUs: number;
	readonly sampleCount: number;
	readonly frames: ReadonlyArray<StackFrame>;
};

const MAX_STACK_FRAMES = 8;

const round = (value: number, digits: number) => Number(value.toFixed(digits));

type Tally<T> = Map<string, { readonly item: T; us: number }>;

const addTo = <T>(tally: Tally<T>, item: T, us: number) => {
	const key = JSON.stringify(item);
	const existing = tally.get(key);
	if (existing === undefined) {
		tally.set(key, { us, item });
	} else {
		existing.us += us;
	}
};

const topEntries = <T>(tally: Tally<T>, topN: number) =>
	[...tally.values()].sort((left, right) => right.us - left.us).slice(0, topN);

/**
 * Builds a summary from weighted stacks. Several profiles (for example one per workflow replay
 * attempt) are aggregated by concatenating their stacks before summarizing.
 */
export const summarizeWeightedStacks = (
	source: CpuProfileSummary["source"],
	stacks: ReadonlyArray<WeightedStack>,
	options: { readonly topN?: number } = {},
): CpuProfileSummary => {
	const topN = options.topN ?? 25;
	const categories: Tally<string> = new Map();
	const selfFrames: Tally<StackFrame> = new Map();
	const stackTotals: Tally<ReadonlyArray<{ category: string; functionName: string }>> = new Map();
	let totalUs = 0;
	let busyUs = 0;
	let sampleCount = 0;
	for (const stack of stacks) {
		sampleCount += stack.sampleCount;
		totalUs += stack.selfUs;
		const leaf = stack.frames[0];
		const category = leaf?.category ?? "idle";
		addTo(categories, category, stack.selfUs);
		if (leaf === undefined || category === "idle") {
			continue;
		}
		busyUs += stack.selfUs;
		addTo(selfFrames, leaf, stack.selfUs);
		const frames = stack.frames
			.slice(0, MAX_STACK_FRAMES)
			.map((frame) => ({ category: frame.category, functionName: frame.functionName }));
		addTo(stackTotals, frames, stack.selfUs);
	}
	const share = (us: number) => (busyUs === 0 ? 0 : round(us / busyUs, 4));
	const milliseconds = (us: number) => round(us / 1_000, 3);
	return {
		source,
		sampleCount,
		sampledDurationMs: milliseconds(totalUs),
		topStacks: topEntries(stackTotals, topN).map(({ us, item }) => ({
			frames: item,
			share: share(us),
			selfMs: milliseconds(us),
		})),
		categories: topEntries(categories, categories.size).map(({ us, item }) => ({
			category: item,
			selfMs: milliseconds(us),
			share: item === "idle" ? null : share(us),
		})),
		topSelfFrames: topEntries(selfFrames, topN).map(({ us, item }) => ({
			line: item.line,
			share: share(us),
			category: item.category,
			selfMs: milliseconds(us),
			functionName: item.functionName,
		})),
	};
};

/**
 * V8 records `timeDeltas[i]` as the gap before sample `i`, so a sample's own duration is the gap
 * before the next sample; the last sample runs until `endTime`. This matches DevTools' attribution.
 */
export const v8WeightedStacks = (profile: V8CpuProfile): ReadonlyArray<WeightedStack> => {
	const indexById = new Map(profile.nodes.map((node, index) => [node.id, index]));
	const parent = new Int32Array(profile.nodes.length).fill(-1);
	profile.nodes.forEach((node, index) => {
		for (const child of node.children ?? []) {
			const childIndex = indexById.get(child);
			if (childIndex !== undefined) {
				parent[childIndex] = index;
			}
		}
	});
	const selfUs = new Float64Array(profile.nodes.length);
	const hits = new Uint32Array(profile.nodes.length);
	let timestamp = profile.startTime;
	profile.samples.forEach((nodeId, index) => {
		timestamp += profile.timeDeltas[index] ?? 0;
		const next = profile.timeDeltas[index + 1];
		const duration = next ?? profile.endTime - timestamp;
		const nodeIndex = indexById.get(nodeId);
		if (nodeIndex === undefined) {
			return;
		}
		selfUs[nodeIndex] = (selfUs[nodeIndex] ?? 0) + Math.max(0, duration);
		hits[nodeIndex] = (hits[nodeIndex] ?? 0) + 1;
	});
	const frameOf = (index: number): StackFrame => {
		const { url, lineNumber, functionName } = profile.nodes[index]?.callFrame ?? {
			url: "",
			lineNumber: -1,
			functionName: "",
		};
		return {
			line: lineNumber < 0 ? null : lineNumber,
			category: categorizeV8Frame(url, functionName),
			functionName: sanitizeFunctionName(functionName),
		};
	};
	return profile.nodes.flatMap((_node, index) => {
		if ((hits[index] ?? 0) === 0) {
			return [];
		}
		const frames: Array<StackFrame> = [];
		for (let current = index; current !== -1; current = parent[current] ?? -1) {
			const frame = frameOf(current);
			if (frame.category !== "root") {
				frames.push(frame);
			}
		}
		return [{ frames, selfUs: selfUs[index] ?? 0, sampleCount: hits[index] ?? 0 }];
	});
};

const JSC_UNKNOWN = 4_294_967_295;

/**
 * The JSC sampler does not record a trace while the VM is idle, so a gap between trace timestamps is
 * not the previous stack's duration; each trace is weighted by the sampling interval instead.
 */
export const jscWeightedStacks = (traces: JscStackTraces): ReadonlyArray<WeightedStack> => {
	const sourceUrls = new Map(
		traces.sources.map((source) => [source.sourceID, source.sourceURL ?? source.url]),
	);
	const stacks = new Map<string, { frames: ReadonlyArray<StackFrame>; sampleCount: number }>();
	for (const trace of traces.traces) {
		const frames = trace.frames.map(
			(frame): StackFrame => ({
				functionName: sanitizeFunctionName(frame.name),
				line: frame.line === JSC_UNKNOWN ? null : frame.line,
				category: categorizeJscFrame(
					frame.sourceURL ?? sourceUrls.get(frame.sourceID),
					frame.flags === 1,
				),
			}),
		);
		const key = JSON.stringify(frames);
		const existing = stacks.get(key);
		stacks.set(key, { frames, sampleCount: (existing?.sampleCount ?? 0) + 1 });
	}
	return [...stacks.values()].map(({ frames, sampleCount }) => ({
		frames,
		sampleCount,
		selfUs: sampleCount * traces.interval * 1_000_000,
	}));
};

export const summarizeV8CpuProfile = (
	profile: V8CpuProfile,
	options: { readonly topN?: number } = {},
) => summarizeWeightedStacks("deno-v8", v8WeightedStacks(profile), options);

export const summarizeJscStackTraces = (
	traces: JscStackTraces,
	options: { readonly topN?: number } = {},
) => summarizeWeightedStacks("bun-jsc", jscWeightedStacks(traces), options);
