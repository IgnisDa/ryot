import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { Effect, type Schema } from "effect";
import type { Workflow } from "effect/workflow";
import type { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type { MutationReceipts } from "./receipts";

type Registration = ReturnType<MutationReceipts["Service"]["registerWorkflow"]>;

export const admitWorkflow = Effect.fnUntraced(function* (
	receipts: Pick<MutationReceipts["Service"], "registerWorkflow">,
	workflow: Workflow.Any,
	account: AccountGeneration | null,
	executionId: string,
) {
	return yield* receipts.registerWorkflow(account, workflow._tag, executionId);
});

export const dispatchAdmittedWorkflow = Effect.fnUntraced(function* <
	Name extends string,
	Payload extends Workflow.AnyStructSchema,
	Success extends Schema.Top,
	Error extends Schema.Top,
	AdmissionError,
	AdmissionServices,
	Result,
	DispatchError,
	DispatchServices,
	const Discard extends boolean = false,
>(
	receipts: Pick<MutationReceipts["Service"], "registerWorkflow">,
	engine: WorkflowEngine["Service"],
	workflow: Workflow.Workflow<Name, Payload, Success, Error>,
	account: AccountGeneration | null,
	options: {
		readonly payload: Payload["Type"];
		readonly executionId?: string;
		readonly discard?: Discard;
		readonly suspendedRetrySchedule?: Parameters<
			WorkflowEngine["Service"]["execute"]
		>[1]["suspendedRetrySchedule"];
	},
	admit: (registration: Registration) => Effect.Effect<void, AdmissionError, AdmissionServices>,
	dispatch: (
		execution: Effect.Effect<
			Discard extends true ? string : Success["Type"],
			Error["Type"],
			Payload["EncodingServices"] | Success["DecodingServices"] | Error["DecodingServices"]
		>,
	) => Effect.Effect<Result, DispatchError, DispatchServices>,
) {
	const executionId = options.executionId ?? (yield* workflow.executionId(options.payload));
	yield* admit(admitWorkflow(receipts, workflow, account, executionId));
	// TODO: https://github.com/Effect-TS/effect/issues/9003
	// Root execute callers can wait for retry timers after durable completion.
	// After a released fix, upgrade compatible Effect runtime/platform/SQL/test
	// dependencies together. Turn the linked repro's delayed-return assertion
	// into a prompt-completion regression and run it with default and long retry
	// schedules. Verify parent suspension, replay, cancellation, and split-lane
	// routing, then run the remote S3 smoke pair and six pairs plus fairness.
	// Compare search/details latency, SQL per request, and background query load.
	// Remove this TODO after completion delivery no longer waits for retry timers;
	// keep the existing acceptance criteria and database pool settings.
	return yield* dispatch(engine.execute(workflow, { ...options, executionId }));
});
