import { Context, Effect, Layer, Ref, Schema } from "effect";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { makeWorkflowEngine } from "#testing/effect";

import { AutomationRunWorkflowPayload } from "./run-workflow";

type RunWorkflowSubmission = {
	discard: boolean;
	executionId: string;
	workflowName: string;
	payload: AutomationRunWorkflowPayload;
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
					execute: (workflow, options) =>
						Effect.gen(function* () {
							const submission = {
								workflowName: workflow._tag,
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
