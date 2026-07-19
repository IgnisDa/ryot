import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { Data, DateTime, Effect, Schema } from "effect";

import {
	type CheckpointRecord,
	decodeBackendCheckpointJsonl,
	decodeCheckpointJsonl,
	summarizeCheckpointSeries,
} from "./checkpoints";
import {
	JscStackTraces,
	jscWeightedStacks,
	summarizeWeightedStacks,
	V8CpuProfile,
	v8WeightedStacks,
	type WeightedStack,
} from "./cpu-profile";
import { summarizeV8HeapSnapshot } from "./heap-snapshot";
import { deleteRawProfiles, listRawFiles } from "./raw-store";
import {
	type LabelledHeapSummary,
	type ProfileEntry,
	ProfileKind,
	ProfilesSummary,
	writeProfilesSummary,
} from "./summary";

/**
 * Turns a raw profile directory (kept outside the repository) into the committed
 * `profiles/summary.json`, then optionally deletes the raw files and records the verified deletion.
 * Output only ever carries counts and paths, never profile contents.
 *
 * Layout: `<raw-dir>/<profileId>/` holds `*.cpuprofile`, `checkpoints.jsonl`, `*.heapsnapshot`,
 * `bun-cpu.json`, `bun-checkpoints.jsonl`, and an optional `meta.json`; Deno replays of one
 * execution sit in `<profileId>/attempt-<n>/` subdirectories.
 */
class ProfileAnalysisError extends Data.TaggedError("ProfileAnalysisError")<{
	readonly file: string;
	readonly message: string;
}> {}

const ProfileMeta = Schema.Struct({
	kind: Schema.optional(ProfileKind),
	attempt: Schema.optional(Schema.Int),
	workload: Schema.optional(Schema.String),
	notes: Schema.optional(Schema.Array(Schema.String)),
});
type ProfileMeta = typeof ProfileMeta.Type;

/** Decode failures can quote the offending value, so the cause is dropped and only the file named. */
const analyzeFile = <A>(file: string, run: () => Promise<A>) =>
	Effect.tryPromise({
		try: run,
		catch: () =>
			new ProfileAnalysisError({
				file,
				message: `${file} could not be summarized; details are withheld because they may quote profile contents`,
			}),
	});

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, "utf8"));

type DirectoryAnalysis = {
	readonly bun: boolean;
	readonly cpu: {
		readonly source: "deno-v8" | "bun-jsc";
		stacks: ReadonlyArray<WeightedStack>;
	} | null;
	readonly heaps: ReadonlyArray<LabelledHeapSummary>;
	readonly checkpoints: ReadonlyArray<CheckpointRecord>;
	readonly cpuProfileCount: number;
};

const cpuStacks = (
	jscStacks: ReadonlyArray<WeightedStack> | null,
	v8Stacks: ReadonlyArray<ReadonlyArray<WeightedStack>>,
): DirectoryAnalysis["cpu"] => {
	if (jscStacks !== null) {
		return { source: "bun-jsc", stacks: jscStacks };
	}
	return v8Stacks.length === 0 ? null : { source: "deno-v8", stacks: v8Stacks.flat() };
};

const analyzeDirectory = (directory: string) =>
	Effect.gen(function* () {
		const entries = yield* analyzeFile(directory, () =>
			readdir(directory, { withFileTypes: true }),
		);
		const files = entries
			.filter((entry) => entry.isFile())
			.map(({ name }) => name)
			.sort();
		const cpuProfiles = files.filter((name) => name.endsWith(".cpuprofile"));
		const bunCpuFile = files.find((name) => /^bun-cpu(-[a-z0-9-]+)?\.json$/.test(name));
		const bunCpu = bunCpuFile !== undefined;
		if (cpuProfiles.length > 0 && bunCpu) {
			return yield* new ProfileAnalysisError({
				file: directory,
				message: `${directory} mixes Deno and Bun CPU profiles`,
			});
		}
		const v8Stacks = yield* Effect.forEach(cpuProfiles, (name) =>
			analyzeFile(join(directory, name), async () =>
				v8WeightedStacks(
					Schema.decodeUnknownSync(V8CpuProfile)(await readJson(join(directory, name))),
				),
			),
		);
		const jscStacks =
			bunCpuFile === undefined
				? null
				: yield* analyzeFile(join(directory, bunCpuFile), async () =>
						jscWeightedStacks(
							Schema.decodeUnknownSync(JscStackTraces)(await readJson(join(directory, bunCpuFile))),
						),
					);
		const checkpointFiles = files.filter(
			(name) => name === "checkpoints.jsonl" || name === "bun-checkpoints.jsonl",
		);
		const checkpoints = (yield* Effect.forEach(checkpointFiles, (name) =>
			analyzeFile(join(directory, name), async () => {
				const text = await readFile(join(directory, name), "utf8");
				return name === "bun-checkpoints.jsonl"
					? decodeBackendCheckpointJsonl(text)
					: decodeCheckpointJsonl(text);
			}),
		)).flat();
		const heapFiles = files.filter((name) => name.endsWith(".heapsnapshot"));
		const heaps = yield* Effect.forEach(heapFiles, (name) =>
			analyzeFile(join(directory, name), async () => {
				const summary = summarizeV8HeapSnapshot(await readJson(join(directory, name)));
				const record = checkpoints.find(
					({ heapSnapshotFile }) =>
						heapSnapshotFile !== null && basename(heapSnapshotFile) === name,
				);
				return {
					summary,
					phase: null,
					sequence: record?.sequence ?? null,
					checkpoint: record?.checkpoint ?? null,
				};
			}),
		);
		return {
			checkpoints,
			cpuProfileCount: cpuProfiles.length,
			cpu: cpuStacks(jscStacks, v8Stacks),
			bun: bunCpu || files.some((name) => name.startsWith("bun-")),
			heaps: [...heaps].sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0)),
		} satisfies DirectoryAnalysis;
	});

const inferKind = (analysis: DirectoryAnalysis): ProfileKind => {
	if (analysis.bun) {
		return analysis.cpu === null ? "bun-heap" : "bun-cpu";
	}
	return analysis.cpu === null ? "deno-heap" : "deno-cpu";
};

const buildEntry = (
	profileId: string,
	meta: ProfileMeta,
	attempt: number | null,
	analysis: DirectoryAnalysis,
): ProfileEntry => {
	const series =
		analysis.checkpoints.length === 0 ? undefined : summarizeCheckpointSeries(analysis.checkpoints);
	const phaseOf = (sequence: number | null) =>
		series?.checkpoints.find((checkpoint) => checkpoint.sequence === sequence)?.phase ?? null;
	return {
		attempt,
		profileId,
		workload: meta.workload ?? profileId,
		kind: meta.kind ?? inferKind(analysis),
		notes: [
			...(meta.notes ?? []),
			...(analysis.cpuProfileCount > 1
				? [`${analysis.cpuProfileCount} CPU profiles combined`]
				: []),
		],
		...(analysis.cpu === null
			? {}
			: { cpu: summarizeWeightedStacks(analysis.cpu.source, analysis.cpu.stacks) }),
		...(analysis.heaps.length === 0
			? {}
			: { heaps: analysis.heaps.map((heap) => ({ ...heap, phase: phaseOf(heap.sequence) })) }),
		...(series === undefined ? {} : { checkpoints: series }),
	};
};

const hasProfileData = (analysis: DirectoryAnalysis) =>
	analysis.cpu !== null || analysis.heaps.length > 0 || analysis.checkpoints.length > 0;

const attemptDirectory = /^attempt-(\d+)$/;

const analyzeProfile = (rawDirectory: string, profileId: string) =>
	Effect.gen(function* () {
		const directory = join(rawDirectory, profileId);
		const entries = yield* analyzeFile(directory, () =>
			readdir(directory, { withFileTypes: true }),
		);
		const meta = entries.some((entry) => entry.name === "meta.json")
			? yield* analyzeFile(join(directory, "meta.json"), async () =>
					Schema.decodeUnknownSync(ProfileMeta)(await readJson(join(directory, "meta.json"))),
				)
			: {};
		const attempts = entries
			.filter((entry) => entry.isDirectory() && attemptDirectory.test(entry.name))
			.map((entry) => ({
				name: entry.name,
				attempt: Number(attemptDirectory.exec(entry.name)?.[1]),
			}))
			.sort((left, right) => left.attempt - right.attempt);
		const topLevel = yield* analyzeDirectory(directory);
		const perAttempt = yield* Effect.forEach(attempts, ({ name, attempt }) =>
			analyzeDirectory(join(directory, name)).pipe(
				Effect.map((analysis) => ({ attempt, analysis })),
			),
		);
		const attemptStacks = perAttempt.flatMap(({ analysis }) =>
			analysis.cpu?.source === "deno-v8" ? [analysis.cpu.stacks] : [],
		);
		return [
			...(hasProfileData(topLevel) || attempts.length === 0
				? [buildEntry(profileId, meta, meta.attempt ?? null, topLevel)]
				: []),
			...perAttempt.map(({ attempt, analysis }) => buildEntry(profileId, meta, attempt, analysis)),
			...(attemptStacks.length > 1
				? [
						{
							profileId,
							attempt: null,
							kind: meta.kind ?? "deno-cpu",
							workload: meta.workload ?? profileId,
							notes: [`aggregate of ${attemptStacks.length} attempts`],
							cpu: summarizeWeightedStacks("deno-v8", attemptStacks.flat()),
						} satisfies ProfileEntry,
					]
				: []),
		];
	});

const usage = "usage: analyze.ts <raw-dir> <output-json> --run-id <id> [--delete-raw]";

const parseArguments = (argv: ReadonlyArray<string>) => {
	const positional: Array<string> = [];
	let runId: string | undefined;
	let deleteRaw = false;
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		if (argument === "--delete-raw") {
			deleteRaw = true;
		} else if (argument === "--run-id") {
			runId = argv[++index];
		} else if (argument !== undefined) {
			positional.push(argument);
		}
	}
	const [rawDirectory, outputPath] = positional;
	if (rawDirectory === undefined || outputPath === undefined || runId === undefined) {
		throw new Error(usage);
	}
	return { runId, deleteRaw, outputPath, rawDirectory };
};

const nowUtc = DateTime.now.pipe(Effect.map(DateTime.formatIso));

const decodeWritten = Schema.decodeUnknownEffect(Schema.fromJsonString(ProfilesSummary));

const { runId, deleteRaw, outputPath, rawDirectory } = parseArguments(process.argv.slice(2));

/** Written before deletion, then rewritten with the verified status so a failed delete is visible. */
const deleteAndRecord = (summary: ProfilesSummary) =>
	Effect.gen(function* () {
		const deletion = yield* deleteRawProfiles(rawDirectory);
		yield* writeProfilesSummary(outputPath, {
			...summary,
			rawDeletion: {
				deleted: deletion.deleted,
				verifiedAtUtc: yield* nowUtc,
				remainingEntries: deletion.remainingEntries,
			},
		});
		yield* Effect.log("sandbox-resource-baseline.profiles.raw-deleted", deletion);
		if (deletion.deleted) {
			return deletion;
		}
		return yield* new ProfileAnalysisError({
			file: rawDirectory,
			message: `${rawDirectory} still has ${deletion.remainingEntries} entries after deletion`,
		});
	});

await Effect.runPromise(
	Effect.gen(function* () {
		const rawFiles = yield* listRawFiles(rawDirectory);
		const profileIds = (yield* analyzeFile(rawDirectory, () =>
			readdir(rawDirectory, { withFileTypes: true }),
		))
			.filter((entry) => entry.isDirectory())
			.map(({ name }) => name)
			.sort();
		const profiles = (yield* Effect.forEach(profileIds, (profileId) =>
			analyzeProfile(rawDirectory, profileId),
		)).flat();
		const generatedAtUtc = yield* nowUtc;
		const summary: ProfilesSummary = {
			runId,
			profiles,
			generatedAtUtc,
			rawDeletion: {
				deleted: false,
				verifiedAtUtc: generatedAtUtc,
				remainingEntries: rawFiles.length,
			},
		};
		yield* writeProfilesSummary(outputPath, summary);
		yield* analyzeFile(outputPath, () => readFile(outputPath, "utf8")).pipe(
			Effect.flatMap(decodeWritten),
		);
		yield* Effect.log("sandbox-resource-baseline.profiles.summarized", {
			profiles: profiles.length,
			rawFiles: rawFiles.length,
		});
		if (deleteRaw) {
			yield* deleteAndRecord(summary);
		}
	}),
);
