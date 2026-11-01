import { Context, Effect, Schema } from "effect";
import { Activity, Workflow } from "effect/workflow";
import { WorkflowInstance } from "effect/workflow/WorkflowEngine";

export const ActivityBody = Context.Reference<boolean>("ryot/ActivityBody", {
	defaultValue: () => false,
});

export const makeActivity: typeof Activity.make = (options) =>
	// oxlint-disable-next-line no-restricted-properties -- This wrapper marks activity bodies for lifecycle ownership.
	Activity.make({
		...options,
		execute: options.execute.pipe(Effect.provideService(ActivityBody, true)),
	});

/** JSON persistence of one workflow's payload and result, typed where the workflow is implemented. */
export interface WorkflowCodecs {
	readonly decodePayload: (json: unknown) => Effect.Effect<object, Schema.SchemaError>;
	readonly encodeResult: (result: unknown) => Effect.Effect<unknown, Schema.SchemaError>;
	readonly encodePayload: (payload: unknown) => Effect.Effect<unknown, Schema.SchemaError>;
	readonly decodeResult: (
		json: unknown,
	) => Effect.Effect<Workflow.Result<unknown, unknown>, Schema.SchemaError>;
}

export const WorkflowCodecs = Context.Reference<undefined | WorkflowCodecs>("ryot/WorkflowCodecs", {
	defaultValue: () => undefined,
});

export const makeWorkflowCodecs = <
	Payload extends Workflow.AnyStructSchema & Schema.ConstraintCodec<object, unknown>,
	Success extends Schema.Top & Schema.ConstraintCodec<unknown, unknown>,
	Error extends Schema.Top & Schema.ConstraintCodec<unknown, unknown>,
>(
	workflow: Workflow.Workflow<string, Payload, Success, Error>,
): WorkflowCodecs => {
	const payloadJson = Schema.toCodecJson(workflow.payloadSchema);
	const result = Schema.toCodecJson(
		Workflow.Result({ error: workflow.errorSchema, success: workflow.successSchema }),
	);
	return {
		encodeResult: Schema.encodeUnknownEffect(result),
		decodeResult: Schema.decodeUnknownEffect(result),
		decodePayload: Schema.decodeUnknownEffect(payloadJson),
		encodePayload: Schema.encodeUnknownEffect(payloadJson),
	};
};

export const implementWorkflow = <
	Tag extends string,
	Payload extends Workflow.AnyStructSchema & Schema.ConstraintCodec<object, unknown>,
	Success extends Schema.Top & Schema.ConstraintCodec<unknown, unknown>,
	Error extends Schema.Top & Schema.ConstraintCodec<unknown, unknown>,
	R,
>(
	workflow: Workflow.Workflow<Tag, Payload, Success, Error>,
	execute: (
		payload: Payload["Type"],
		executionId: string,
	) => Effect.Effect<Success["Type"], Error["Type"], R>,
) =>
	workflow
		.annotate(WorkflowCodecs, makeWorkflowCodecs(workflow))
		.toLayer((payload, executionId) =>
			execute(payload, executionId).pipe(Effect.provideService(ActivityBody, false)),
		);

export const asIndependentWorkflowRoot = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.updateContext(effect, (context: Context.Context<never>) =>
		Context.omit(WorkflowInstance)(context),
	);
