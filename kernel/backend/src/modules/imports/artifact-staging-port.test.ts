import { expect, it } from "@effect/vitest";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { ExecutionFileStaging } from "@ryot-app/sandbox/host/execution-file-staging";
import type { SandboxRunInput } from "@ryot-app/sandbox/host/invocation";
import { Context, Effect, Layer } from "effect";
import { assert } from "vitest";

import { makeUserPrincipal } from "#modules/scripts/authorization/principal.test-support";

import { IngestionArtifactStagingLive } from "./artifact-staging";
import { IngestionCaptures } from "./capture-service";
import { ingestionTestRun, ingestionTestScope } from "./ingestion.test-support";
import { ImportsRepository } from "./repository";
import { ImportRunError } from "./runtime/workflow-errors";

type StageInput = Parameters<IngestionCaptures["Service"]["stage"]>[0];
type StagingOwner = Effect.Success<ReturnType<ImportsRepository["Service"]["getStagingOwner"]>>;

const ownerExecutionId = "trusted-owner";
const input: SandboxRunInput = {
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	lane: "interactive",
	executionId: "collector-activity",
	startedAt: "2026-01-01T00:00:00.000Z",
	workflowExecutionId: "collector-workflow",
	grants: { artifactOwnerExecutionId: ownerExecutionId },
	principal: makeUserPrincipal({
		scriptSlug: "collector",
		contentHash: "collector-hash",
		scriptId: SandboxScriptId.make("collector"),
		metadata: { kind: "operation", runtimeImports: [], capabilities: ["scratch"] },
		subject: {
			type: "user",
			userId: ingestionTestScope.userId,
			accountGeneration: ingestionTestScope.accountGeneration,
		},
	}),
};
const pins = {
	scriptId: "collector",
	pluginRevisionId: null,
	pluginConfigRevisionId: null,
	executionId: ownerExecutionId,
};
const owner = ingestionTestRun({ pins });

const makeStagingPort = Effect.fnUntraced(function* (
	staged: StageInput[],
	options: {
		owner?: StagingOwner;
		stage?: (input: StageInput) => Effect.Effect<string, ImportRunError>;
	} = {},
) {
	const context = yield* Layer.build(
		IngestionArtifactStagingLive.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.mock(ImportsRepository)({
						getStagingOwner: (userId, accountGeneration, executionId) =>
							Effect.sync(() => {
								expect({ userId, executionId, accountGeneration }).toEqual({
									executionId: ownerExecutionId,
									userId: ingestionTestScope.userId,
									accountGeneration: ingestionTestScope.accountGeneration,
								});
								return options.owner === undefined ? owner : options.owner;
							}),
					}),
					Layer.mock(IngestionCaptures)({
						stage: (entry) =>
							Effect.sync(() => {
								staged.push(entry);
							}).pipe(
								Effect.andThen(
									options.stage
										? options.stage(entry)
										: Effect.succeed(`handle-${entry.outputIndex}`),
								),
							),
					}),
				),
			),
		),
	);
	return Context.get(context, ExecutionFileStaging);
});

it.effect(
	"stages bounded byte buffers directly with stable indices and trusted execution ownership",
	() => {
		const staged: StageInput[] = [];
		return Effect.gen(function* () {
			const port = yield* makeStagingPort(staged);
			const stage = yield* port.prepare(input);
			assert(stage !== null);
			const outputs = [
				new Uint8Array(4 * 1024 * 1024).fill(1),
				new Uint8Array(),
				new Uint8Array([2]),
			];
			expect(yield* stage(outputs)).toEqual(["handle-0", "handle-1", "handle-2"]);
			expect(staged).toEqual(
				outputs.map((bytes, outputIndex) => ({
					bytes,
					outputIndex,
					ownerExecutionId,
					scope: ingestionTestScope,
					activityExecutionId: input.executionId,
					workflowExecutionId: input.workflowExecutionId,
				})),
			);
			for (const [index, entry] of staged.entries()) {
				expect(entry.bytes).toBe(outputs[index]);
			}
		}).pipe(Effect.scoped);
	},
);

it.effect("rejects buffers above the import limit before staging them", () => {
	const staged: StageInput[] = [];
	return Effect.gen(function* () {
		const port = yield* makeStagingPort(staged);
		const stage = yield* port.prepare(input);
		assert(stage !== null);
		const error = yield* Effect.flip(stage([new Uint8Array(4 * 1024 * 1024 + 1)]));
		expect(error.message).toBe("Staged artifact exceeds its byte limit");
		expect(staged).toEqual([]);
	}).pipe(Effect.scoped);
});

it.effect("does not return partial handles or stage later outputs after a sink failure", () => {
	const staged: StageInput[] = [];
	return Effect.gen(function* () {
		const port = yield* makeStagingPort(staged, {
			stage: (entry) =>
				entry.outputIndex === 1
					? Effect.fail(new ImportRunError({ message: "Second output failed" }))
					: Effect.succeed("first-handle"),
		});
		const stage = yield* port.prepare(input);
		assert(stage !== null);
		const error = yield* Effect.flip(
			stage([new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]),
		);
		expect(error.message).toBe("Second output failed");
		expect(staged.map((entry) => entry.outputIndex)).toEqual([0, 1]);
	}).pipe(Effect.scoped);
});

it.effect("keeps owner status and revision pins authoritative before accepting any bytes", () =>
	Effect.gen(function* () {
		for (const invalidOwner of [
			{ ...owner, status: "completed" as const },
			{ ...owner, pins: { ...pins, pluginRevisionId: "changed" } },
			{ ...owner, pins: { ...pins, pluginConfigRevisionId: "changed" } },
		]) {
			const staged: StageInput[] = [];
			const port = yield* makeStagingPort(staged, { owner: invalidOwner });
			const error = yield* Effect.flip(port.prepare(input));
			expect(error.message).toBe(
				invalidOwner.status === "completed"
					? "Staged artifact owner is not running"
					: "Staged artifact execution pins changed",
			);
			expect(staged).toEqual([]);
		}
	}).pipe(Effect.scoped),
);
