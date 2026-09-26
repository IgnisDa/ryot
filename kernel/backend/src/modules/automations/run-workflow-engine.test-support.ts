import { Context, Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { makeWorkflowEngine } from "#lib/test-utils/effect";

import { AutomationRunWorkflowPayload } from "./run-workflow";

type RunWorkflowSubmission = {
	payload: AutomationRunWorkflowPayload;
	executionId: string;
	discard: boolean;
};

export class RunWorkflowSubmissions extends Context.Service<
	RunWorkflowSubmissions,
	Effect.Effect<ReadonlyArray<RunWorkflowSubmission>>
>()("test/RunWorkflowSubmissions") {}

export const recordingRunWorkflowEngineLayer = (
	respond: (submission: RunWorkflowSubmission) => unknown = () => undefined,
) =>
	Layer.effectContext(
		Effect.gen(function* () {
			const submissions = yield* Ref.make<ReadonlyArray<RunWorkflowSubmission>>([]);
			return Context.make(
				WorkflowEngine,
				makeWorkflowEngine({
					execute: (_workflow, options) =>
						Effect.gen(function* () {
							const submission = {
								executionId: options.executionId,
								discard: options.discard === true,
								payload: yield* Schema.decodeUnknownEffect(AutomationRunWorkflowPayload)(
									options.payload,
								),
							};
							yield* Ref.update(submissions, (all) => [...all, submission]);
							return respond(submission);
						}),
				}),
			).pipe(Context.add(RunWorkflowSubmissions, Ref.get(submissions)));
		}),
	);
