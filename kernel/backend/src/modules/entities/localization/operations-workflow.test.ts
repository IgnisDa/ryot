import { expect, layer } from "@effect/vitest";
import {
	PluginConfigRevisionId,
	PluginRevisionId,
	SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { makeMemoizingWorkflowEngine } from "#testing/effect";

import { TranslateEntityWorkflow, type TranslationExecution } from "./entity-translation-workflow";
import {
	TranslateEntityWorkflowOperations,
	TranslateEntityWorkflowOperationsLive,
} from "./operations-workflow";
import { TranslationsService } from "./service";
import { translationExecution, translationPayload } from "./translation.test-support";

type ScriptInput = Parameters<ScriptExecutionService["Service"]["executeScript"]>[0];
class PinnedTranslationEffects extends Context.Service<
	PinnedTranslationEffects,
	{
		readonly upgrade: Effect.Effect<void>;
		readonly calls: Effect.Effect<ReadonlyArray<ScriptInput>>;
	}
>()("test/PinnedTranslationEffects") {}

const operationsLayer = Layer.unwrap(
	Effect.gen(function* () {
		const instance = WorkflowInstance.initial(
			TranslateEntityWorkflow,
			translationPayload.executionId,
		);
		const admitted = yield* Ref.make<TranslationExecution>(translationExecution);
		const calls = yield* Ref.make<ReadonlyArray<ScriptInput>>([]);
		const upgraded = {
			...translationExecution,
			properties: {},
			name: "Changed after admission",
			principal: {
				...translationExecution.principal,
				contentHash: "upgraded-content",
				scriptId: SandboxScriptId.make("upgraded-translation-script"),
				metadata: { ...translationExecution.principal.metadata, translationInputs: { record: [] } },
				pluginRevision: {
					...translationExecution.principal.pluginRevision,
					compiledHashes: { translate: "upgraded-content" },
					configRevisionId: PluginConfigRevisionId.make("upgraded-config"),
					revisionId: PluginRevisionId.make("compatible-additive-revision"),
				},
			},
		};
		return TranslateEntityWorkflowOperationsLive.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					Layer.succeed(WorkflowInstance, instance),
					Layer.succeed(WorkflowEngine, makeMemoizingWorkflowEngine(instance, [])),
					Layer.mock(TranslationsService)({ admitExecution: () => Ref.get(admitted) }),
					Layer.mock(ScriptExecutionService)({
						executeScript: (input) =>
							Ref.update(calls, (all) => [...all, input]).pipe(
								Effect.as({ logs: [], error: null, status: "completed", value: { name: "Libro" } }),
							),
					}),
					Layer.succeed(PinnedTranslationEffects, {
						calls: Ref.get(calls),
						upgrade: Ref.set(admitted, upgraded),
					}),
				),
			),
		);
	}),
);

layer(operationsLayer)((test) => {
	test.effect(
		"replays the historical code/config pin after an additive upgrade while new work captures the upgrade",
		() =>
			Effect.gen(function* () {
				const operations = yield* TranslateEntityWorkflowOperations;
				const effects = yield* PinnedTranslationEffects;
				const first = yield* operations.processSandbox(
					translationPayload,
					"admitted-before-upgrade",
					yield* operations.captureExecution(translationPayload, "admitted-before-upgrade", 1),
				);
				yield* effects.upgrade;
				const retry = yield* operations.processSandbox(
					translationPayload,
					"admitted-before-upgrade",
					yield* operations.captureExecution(translationPayload, "admitted-before-upgrade", 1),
				);
				const fresh = yield* operations.processSandbox(
					translationPayload,
					"admitted-after-upgrade",
					yield* operations.captureExecution(translationPayload, "admitted-after-upgrade", 1),
				);
				expect(retry.execution).toEqual(first.execution);
				expect(fresh.execution.principal.pluginRevision?.revisionId).toBe(
					"compatible-additive-revision",
				);
				expect(yield* effects.calls).toMatchObject([
					{
						scriptId: "translation-script",
						pluginRevision: translationExecution.principal.pluginRevision,
						input: { name: translationExecution.name, properties: translationExecution.properties },
					},
					{
						scriptId: "translation-script",
						pluginRevision: translationExecution.principal.pluginRevision,
						input: { name: translationExecution.name, properties: translationExecution.properties },
					},
					{
						scriptId: "upgraded-translation-script",
						input: { properties: {}, name: "Changed after admission" },
						pluginRevision: {
							configRevisionId: "upgraded-config",
							revisionId: "compatible-additive-revision",
						},
					},
				]);
			}),
	);
});
