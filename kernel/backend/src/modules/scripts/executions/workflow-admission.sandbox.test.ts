import { expect } from "bun:test";

import { BunCrypto } from "@effect/platform-bun";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref, Schema } from "effect";

import { testExecutionId } from "#testing/effect";

import { ScriptCalls } from "./calls";
import {
	realSandboxLayer,
	RealSandboxScripts,
	realSandboxUserId,
} from "./real-sandbox.test-support";
import { ScriptChanges } from "./script-changes";
import { executeScriptExecutionWorkflow } from "./workflow";

const activitySource = `
import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { defineActivityWithChanges, Effect, Schema } from "@ryot-app/plugin-backend-sdk/workflow";

export const manifest = defineManifest({ kind: "script", name: "Cached step", slug: "cached.step" });

export default defineActivityWithChanges({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Unknown,
  run: (_input, host) =>
    Effect.gen(function* () {
      const cached = yield* host.getCachedValue("step");
      return { output: cached, changes: {} };
    }),
});
`;

const foldSource = `
import { defineManifest, defineScript } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";

export const manifest = defineManifest({ kind: "script", name: "Fold", slug: "commit.fold" });

export default defineScript({
  manifest,
  input: Schema.Struct({ executionId: Schema.String }),
  output: Schema.String,
  run: ({ executionId }) => Effect.succeed("folded " + executionId),
});
`;

class FoldResults extends Context.Service<FoldResults, Ref.Ref<ReadonlyArray<unknown>>>()(
	"@ryot-app/kernel-backend/modules/scripts/executions/workflow-admission.sandbox.test/FoldResults",
) {}

// Commits a step's changes the way the change pipeline does: by running a fold script through `ScriptCalls`.
const foldingChanges = (results: Ref.Ref<ReadonlyArray<unknown>>) =>
	Layer.effect(
		ScriptChanges,
		Effect.gen(function* () {
			const calls = yield* ScriptCalls;
			const fold = yield* (yield* RealSandboxScripts).install(foldSource);
			return ScriptChanges.of({
				commit: () => Effect.die("Workflow steps commit by execution identity"),
				commitKeyed: (input) =>
					calls
						.run(
							{
								lane: input.lane,
								executionId: `${input.executionId}-fold`,
								input: { executionId: input.executionId },
								principal: {
									providerId: null,
									scriptId: fold.scriptId,
									contentHash: fold.contentHash,
									metadata: fold.compiled.manifest,
									pluginRevision: fold.pluginRevision,
									scriptSlug: fold.compiled.manifest.slug,
									subject: { type: "user", userId: realSandboxUserId },
								},
							},
							Schema.Unknown,
						)
						.pipe(
							Effect.flatMap((result) =>
								Ref.update(results, (all) => [...all, result.error ?? result.output]),
							),
							Effect.as({ events: [] }),
						),
			});
		}),
	);

const admissionLayer = (admission: {
	readonly memoryBudgetMiB: number;
	readonly workerConcurrency: number;
}) =>
	Layer.unwrap(
		Effect.map(Ref.make<ReadonlyArray<unknown>>([]), (results) =>
			Layer.merge(
				Layer.succeed(FoldResults, results),
				realSandboxLayer({
					...admission,
					scriptChanges: foldingChanges(results),
					hostResult: { value: "cached", state: "success" },
				}),
			),
		),
	).pipe(Layer.provideMerge(BunCrypto.layerSecureRandom));

const runStep = Effect.gen(function* () {
	const installed = yield* (yield* RealSandboxScripts).install(activitySource);
	const executionId = testExecutionId("admission-step");
	const result = yield* executeScriptExecutionWorkflow({
		input: {},
		executionId,
		activity: true,
		lane: "interactive",
		resultMode: "execution",
		resolutionMode: "exact",
		scriptId: installed.scriptId,
		pluginRevision: installed.pluginRevision,
		subject: { type: "user", userId: realSandboxUserId },
	});
	return { result, executionId, folds: yield* Ref.get(yield* FoldResults) };
});

for (const [name, admission] of [
	["one shared permit", { workerConcurrency: 1, memoryBudgetMiB: 1094 }],
	["separate lanes", { workerConcurrency: 2, memoryBudgetMiB: 1904 }],
] as const) {
	layer(admissionLayer(admission))((test) => {
		test.effect(
			`commits a workflow step whose changes run a fold under ${name}`,
			() =>
				Effect.gen(function* () {
					const { folds, result, executionId } = yield* runStep;
					expect(result).toMatchObject({ error: null, value: "cached" });
					expect(folds).toEqual([`folded ${executionId}`]);
				}),
			testTimeout,
		);
	});
}
