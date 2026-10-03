import { assert, expect, it } from "@effect/vitest";
import { LifecycleCommand } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type { SandboxHostError } from "@ryot-app/sandbox-sdk/wire";
import type { WorkflowReplayEnvelope, WorkflowReplayHost } from "@ryot-app/sandbox-sdk/workflow";
import { Effect, Schema } from "effect";

import { MediaImportSegmentInput } from "../imports/batch";
import importWorkflow from "../imports/import.sandbox";
import segmentWorkflow from "./media-import-segment.sandbox";

type Request = WorkflowReplayEnvelope["requests"][number];

const command = Schema.decodeSync(LifecycleCommand)({
	occurredAt: "2026-09-16T00:00:00.000Z",
	itemIdentity: JSON.stringify(["import-run", "run-1"]),
	accountGeneration: { userId: "user-1", token: "test-account-generation" },
	causation: {
		depth: 0,
		source: "import",
		parentRunId: null,
		importRunId: "run-1",
		parentTriggerId: null,
		executionId: "execution-run-1",
		rootExecutionId: "execution-run-1",
		initiator: { id: "user-1", kind: "user" },
	},
});

const segmentInput = (start: number) =>
	Schema.decodeSync(MediaImportSegmentInput)({
		start,
		command,
		runId: "run-1",
		source: "watcharr",
		parserInput: { start: 0, limit: 25 },
	});

const batchNumber = (request: Request) => Number(request.name.split("-")[1]);

const drive = <Input extends JsonValue>(
	run: (
		input: Input,
		host: WorkflowReplayHost,
		execution: { metadata: Record<string, JsonValue>; sandboxScriptId: string },
	) => Effect.Effect<WorkflowReplayEnvelope, SandboxHostError>,
	input: Input,
	resolve: (request: Request) => Effect.Effect<JsonValue, SandboxHostError>,
) =>
	Effect.gen(function* () {
		const journal: JsonValue[] = [];
		for (;;) {
			const envelope = yield* run(
				input,
				{ replayJournal: () => Effect.succeed(journal) },
				{ metadata: {}, sandboxScriptId: "workflow-test" },
			);
			if (envelope.state === "failed") {
				throw new Error(envelope.error);
			}
			if (envelope.state === "completed") {
				return { journal, envelope };
			}
			const request = envelope.requests[journal.length];
			assert(request);
			journal.push(yield* resolve(request));
		}
	});

const parserOnlyBatches = (totalItems: number) => (request: Request) => {
	assert(request.kind === "activity");
	return Effect.succeed<JsonValue>(
		request.args.scriptSlug === "import.write-chunks"
			? {
					totalItems: 1,
					failureCount: 0,
					writeItemCount: 2,
					chunkHandles: [`handle-${batchNumber(request)}`],
				}
			: { totalItems, failures: [], entityGroups: [] },
	);
};

const runSegment = (start: number, totalItems: number) =>
	Effect.gen(function* () {
		const { envelope } = yield* drive(
			segmentWorkflow.run,
			segmentInput(start),
			parserOnlyBatches(totalItems),
		);
		return { output: envelope.output, requests: envelope.requests };
	});

it.live("stops a segment at the last batch and reports no next start", () =>
	Effect.gen(function* () {
		const { output, requests } = yield* runSegment(0, 30);

		expect(output).toEqual({
			totalItems: 2,
			nextStart: null,
			failureCount: 0,
			writeItemCount: 4,
			chunkHandles: ["handle-0", "handle-1"],
		});
		expect(requests.map(({ name }) => name)).toEqual([
			"parse-0",
			"chunks-0",
			"parse-1",
			"chunks-1",
		]);
	}),
);

it.live("finishes a segment after one batch when the source is empty", () =>
	Effect.gen(function* () {
		const { output, requests } = yield* runSegment(0, 0);

		expect(output).toMatchObject({ nextStart: null, chunkHandles: ["handle-0"] });
		expect(requests).toHaveLength(2);
	}),
);

it.live("caps a segment at 100 batches and resumes at the global batch index", () =>
	Effect.gen(function* () {
		const first = yield* runSegment(0, 2_501);
		expect(first.output).toMatchObject({ nextStart: 2_500 });
		expect(first.requests).toHaveLength(200);
		expect(first.requests.at(-2)?.name).toBe("parse-99");

		const second = yield* runSegment(2_500, 2_501);
		expect(second.output).toMatchObject({ nextStart: null, chunkHandles: ["handle-100"] });
		expect(second.requests.map(({ name }) => name)).toEqual(["parse-100", "chunks-100"]);
	}),
);

it.live("accumulates two segments into one write-import without losing or repeating batches", () =>
	Effect.gen(function* () {
		const parseNames: string[] = [];
		const writeInputs: JsonValue[] = [];
		const segmentStarts: JsonValue[] = [];
		const { envelope } = yield* drive(
			importWorkflow.run,
			{ command, runId: "run-1", source: "watcharr" },
			(request) => {
				assert(request.kind === "child");
				if (request.args.workflowSlug === "kernel:process-import-chunks") {
					writeInputs.push(request.args.input);
					return Effect.succeed({ failedItems: 0, importedItems: 0, processedItems: 0 });
				}
				expect(request.args.workflowSlug).toBe("media-import-segment");
				return Effect.gen(function* () {
					const input = yield* Schema.decodeUnknownEffect(MediaImportSegmentInput)(
						request.args.input,
					);
					segmentStarts.push(input.start);
					const { envelope: segment } = yield* drive(
						segmentWorkflow.run,
						input,
						(segmentRequest) => {
							if (
								segmentRequest.kind === "activity" &&
								segmentRequest.args.scriptSlug === "import.watcharr"
							) {
								parseNames.push(segmentRequest.name);
							}
							return parserOnlyBatches(2_501)(segmentRequest);
						},
					);
					return segment.output;
				});
			},
		);

		expect(envelope.requests.map(({ name }) => name)).toEqual([
			"segment-0",
			"segment-1",
			"write-import",
		]);
		expect(segmentStarts).toEqual([0, 2_500]);
		expect(parseNames).toEqual(Array.from({ length: 101 }, (_, index) => `parse-${index}`));
		expect(writeInputs).toEqual([
			{
				command,
				runId: "run-1",
				totalItems: 101,
				failureCount: 0,
				writeItemCount: 202,
				chunkHandles: Array.from({ length: 101 }, (_, index) => `handle-${index}`),
			},
		]);
	}),
);
