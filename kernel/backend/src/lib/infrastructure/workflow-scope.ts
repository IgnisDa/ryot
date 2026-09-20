import { Context, Effect, type Schema } from "effect";
import { Activity, type Workflow } from "effect/unstable/workflow";

export const ActivityBody = Context.Reference<boolean>("ryot/ActivityBody", {
	defaultValue: () => false,
});

export const makeActivity: typeof Activity.make = (options) =>
	// oxlint-disable-next-line no-restricted-properties -- This wrapper marks activity bodies for lifecycle ownership.
	Activity.make({
		...options,
		execute: options.execute.pipe(Effect.provideService(ActivityBody, true)),
	});

export const implementWorkflow = <
	Tag extends string,
	Payload extends Workflow.AnyStructSchema,
	Success extends Schema.Top,
	Error extends Schema.Top,
	R,
>(
	workflow: Workflow.Workflow<Tag, Payload, Success, Error>,
	execute: (
		payload: Payload["Type"],
		executionId: string,
	) => Effect.Effect<Success["Type"], Error["Type"], R>,
) =>
	workflow.toLayer((payload, executionId) =>
		execute(payload, executionId).pipe(Effect.provideService(ActivityBody, false)),
	);
