import { assert, expect, it } from "@effect/vitest";
import { genericImportKernelInputSchema } from "@ryot-app/plugin-backend-sdk/imports";
import { makeWorkflowReplayHost } from "@ryot-app/plugin-backend-sdk/testing";
import type { JsonValue } from "@ryot-app/plugin-backend-sdk/wire";
import type {
	WorkflowReplayEnvelope,
	WorkflowReplayJournalEntry,
} from "@ryot-app/plugin-backend-sdk/workflow";
import { Effect, Schema } from "effect";

import { mediaImportTestCommand, mediaStageInput } from "../imports/ingestion.test-support";
import type { MediaCollectionInput } from "../imports/process";
import { MediaCollectionOutput, MediaMergeInput } from "../imports/process";
import workflow from "./media-import-collection.sandbox";

type Request = WorkflowReplayEnvelope["requests"][number];
const input: typeof MediaCollectionInput.Type = {
	...mediaStageInput({ offset: 10, itemIndex: 5, eventOffset: 2, header: "initial" }),
	step: 7,
	ordinal: 41,
	runId: "run",
	prefix: "source",
	source: "goodreads",
	carry: "previous-carry",
	records: "normalized-records",
	command: mediaImportTestCommand(),
};
const execution = { metadata: {}, sandboxScriptId: "media-import-collection" };
const replayCollection = Effect.fn(function* (
	value: typeof MediaCollectionInput.Type,
	resolve: (request: Request) => JsonValue,
) {
	const journal: WorkflowReplayJournalEntry[] = [];
	for (;;) {
		const envelope = yield* workflow.run(value, makeWorkflowReplayHost(journal), execution);
		if (envelope.state !== "pending") {
			return { journal, envelope };
		}
		const request = envelope.requests[journal.length];
		assert(request);
		journal.push({ request, value: resolve(request) });
	}
});
const sourceResult = (window: number, done: boolean, carry: boolean) => ({
	done,
	fileIndex: 0,
	leftOffset: 0,
	rightOffset: 0,
	leftDone: false,
	rightDone: false,
	eventOffset: window,
	offset: 10 + window * 100,
	itemIndex: 5 + window * 3,
	header: `header-${window}`,
	carryFile: carry ? "carry.bin" : null,
	chunkHandles: carry ? [`records-${window}`, `carry-${window}`] : [`records-${window}`],
	advancedAt: new Date(Date.parse(input.command.occurredAt) + window * 1000).toISOString(),
});
const recordKernel = (request: Request): JsonValue => {
	assert(request.kind === "child");
	expect(request.args.workflowSlug).toBe("kernel:process-import-chunks");
	const { runId, command, operation } = Schema.decodeUnknownSync(genericImportKernelInputSchema)(
		request.args.input,
	);
	expect(command).toEqual(input.command);
	expect(runId).toBe(input.runId);
	return operation.action === "capture"
		? { handle: operation.handle, captureId: operation.captureId, inputFingerprint: "fingerprint" }
		: { recorded: true };
};

it.live("preserves three-window binary and final folds, carry, checkpoints, and merge replay", () =>
	Effect.gen(function* () {
		let windows = 0;
		const merges: Array<typeof MediaMergeInput.Type> = [];
		const { journal, envelope } = yield* replayCollection(input, (request) => {
			if (request.kind === "activity") {
				expect(request.args.scriptSlug).toBe("import.goodreads");
				windows++;
				return sourceResult(windows, windows === 3, windows === 1);
			}
			assert(request.kind === "child");
			if (request.args.workflowSlug !== "media-import-merge") {
				return recordKernel(request);
			}
			const merge = Schema.decodeUnknownSync(MediaMergeInput)(request.args.input);
			merges.push(merge);
			return {
				leftPage: 0,
				rightPage: 0,
				page: merge.page + 1,
				ordinal: merge.ordinal + 1,
				leftOffset: merge.leftOffset + 17,
				rightOffset: merge.rightOffset + 23,
				done: merge.prefix !== "source-8-merge-0" || merge.page === 1,
			};
		});
		assert(envelope.state === "completed");
		expect(envelope.output).toEqual({
			step: 10,
			done: true,
			carry: null,
			offset: 310,
			ordinal: 48,
			itemIndex: 14,
			eventOffset: 3,
			header: "header-3",
			advancedAt: "2026-01-01T00:00:03.000Z",
			run: { pages: 1, prefix: "source-segment-7-1" },
		});
		expect(journal.map(({ request }) => request.name)).toEqual([
			"source:7",
			"capture:7",
			"carry:7",
			"progress:8",
			"source:8",
			"capture:8",
			"merge:source-8-merge-0:0",
			"merge:source-8-merge-0:1",
			"progress:9",
			"source:9",
			"capture:9",
			"progress:10",
			"merge:source-segment-7-1:0",
		]);
		const attribution = { runId: input.runId, command: input.command };
		expect(merges).toEqual([
			{
				...attribution,
				page: 0,
				ordinal: 44,
				leftPage: 0,
				rightPage: 0,
				leftOffset: 0,
				rightOffset: 0,
				prefix: "source-8-merge-0",
				left: { pages: 1, prefix: "source-7" },
				right: { pages: 1, prefix: "source-8" },
			},
			{
				...attribution,
				page: 1,
				ordinal: 45,
				leftPage: 0,
				rightPage: 0,
				leftOffset: 17,
				rightOffset: 23,
				prefix: "source-8-merge-0",
				left: { pages: 1, prefix: "source-7" },
				right: { pages: 1, prefix: "source-8" },
			},
			{
				...attribution,
				page: 0,
				ordinal: 47,
				leftPage: 0,
				rightPage: 0,
				leftOffset: 0,
				rightOffset: 0,
				prefix: "source-segment-7-1",
				left: { pages: 1, prefix: "source-9" },
				right: { pages: 2, prefix: "source-8-merge-0" },
			},
		]);
		const sources = journal.flatMap(({ request }) =>
			request.kind === "activity" ? [request.args.input] : [],
		);
		expect(sources).toEqual(
			[0, 1, 2].map((window) => ({
				settings: {},
				fileIndex: 0,
				action: "collect",
				eventOffset: window || 2,
				offset: 10 + window * 100,
				itemIndex: 5 + window * 3,
				importedAt: input.importedAt,
				header: window ? `header-${window}` : "initial",
				ingestionArtifacts: {
					runId: input.runId,
					captures: {
						records: "normalized-records",
						...(window < 2 ? { carry: window ? "source-7-carry" : "previous-carry" } : {}),
					},
				},
			})),
		);
		const operations = journal.flatMap(({ request }) =>
			request.kind === "child" && request.args.workflowSlug === "kernel:process-import-chunks"
				? [Schema.decodeUnknownSync(genericImportKernelInputSchema)(request.args.input).operation]
				: [],
		);
		expect(operations.filter((operation) => operation.action === "capture")).toEqual([
			{
				ordinal: 41,
				action: "capture",
				phase: "collection",
				handle: "records-1",
				captureId: "source-7-0",
				checkpoint: {
					offset: 110,
					fileIndex: 0,
					itemIndex: 8,
					eventOffset: 1,
					stage: "collect",
					header: "header-1",
				},
			},
			{
				ordinal: 42,
				action: "capture",
				handle: "carry-1",
				phase: "collection",
				captureId: "source-7-carry",
				checkpoint: { offset: 110, stage: "source-carry" },
			},
			...[2, 3].map((window) => ({
				action: "capture",
				phase: "collection",
				handle: `records-${window}`,
				ordinal: window === 2 ? 43 : 46,
				captureId: `source-${window + 6}-0`,
				checkpoint: {
					fileIndex: 0,
					stage: "collect",
					eventOffset: window,
					offset: 10 + window * 100,
					itemIndex: 5 + window * 3,
					header: `header-${window}`,
				},
			})),
		]);
		expect(operations.filter((operation) => operation.action === "activity")).toEqual(
			[1, 2, 3].map((window) => ({
				action: "activity",
				activity: {
					wait: null,
					batchId: null,
					parentId: null,
					unit: "records",
					kind: "reading",
					state: "running",
					exactTotal: null,
					id: "collection",
					completed: 5 + window * 3,
					lastAdvancedAt: sourceResult(window, false, false).advancedAt,
				},
			})),
		);
		expect(yield* workflow.run(input, makeWorkflowReplayHost(journal), execution)).toEqual(
			envelope,
		);
	}),
);

it.live("limits each segment to 64 windows and resumes with its exact carry and ordinal", () =>
	Effect.gen(function* () {
		let windows = 0;
		let merges = 0;
		const { envelope } = yield* replayCollection(input, (request) => {
			if (request.kind === "activity") {
				windows++;
				return sourceResult(windows, false, windows === 64);
			}
			assert(request.kind === "child");
			if (request.args.workflowSlug !== "media-import-merge") {
				return recordKernel(request);
			}
			const merge = Schema.decodeUnknownSync(MediaMergeInput)(request.args.input);
			merges++;
			return { ...merge, page: 1, done: true, ordinal: merge.ordinal + 1 };
		});
		assert(envelope.state === "completed");
		const output = yield* Schema.decodeUnknownEffect(MediaCollectionOutput)(envelope.output);
		expect(windows).toBe(64);
		expect(merges).toBe(63);
		expect(output).toMatchObject({
			step: 71,
			done: false,
			ordinal: 169,
			carry: "source-70-carry",
			run: { pages: 1, prefix: "source-70-merge-5" },
		});
		const resumed = yield* replayCollection({ ...input, ...output }, (request) => {
			if (request.kind === "activity") {
				expect(request.name).toBe("source:71");
				expect(request.args.input).toMatchObject({
					offset: 6410,
					itemIndex: 197,
					eventOffset: 64,
					action: "collect",
					header: "header-64",
					ingestionArtifacts: {
						runId: input.runId,
						captures: { carry: "source-70-carry", records: "normalized-records" },
					},
				});
				return sourceResult(65, true, false);
			}
			return recordKernel(request);
		});
		assert(resumed.envelope.state === "completed");
		expect(resumed.envelope.output).toMatchObject({
			step: 72,
			done: true,
			carry: null,
			ordinal: 170,
			run: { pages: 1, prefix: "source-71" },
		});
		expect(resumed.journal.map(({ request }) => request.name)).toEqual([
			"source:71",
			"capture:71",
			"progress:72",
		]);
		expect(resumed.journal[1]?.request).toMatchObject({
			args: { input: { operation: { ordinal: 169, captureId: "source-71-0" } } },
		});
		expect(resumed.journal[2]?.request).toMatchObject({
			args: { input: { operation: { activity: { kind: "reading", id: "collection" } } } },
		});
	}),
);
