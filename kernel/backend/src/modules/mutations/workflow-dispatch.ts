import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { Effect, type Schema } from "effect";
import type { Workflow } from "effect/workflow";
import type { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type { MutationReceipts } from "./receipts";

type Registration = ReturnType<MutationReceipts["Service"]["registerWorkflow"]>;

export const admitWorkflow = Effect.fnUntraced(function* (
	receipts: Pick<MutationReceipts["Service"], "registerWorkflow">,
	workflow: Workflow.Any,
	account: null | AccountGeneration,
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
	account: null | AccountGeneration,
	options: {
		readonly discard?: Discard;
		readonly executionId?: string;
		readonly payload: Payload["Type"];
		readonly suspendedRetrySchedule?: Parameters<
			WorkflowEngine["Service"]["execute"]
		>[1]["suspendedRetrySchedule"];
	},
	admit: (registration: Registration) => Effect.Effect<void, AdmissionError, AdmissionServices>,
	dispatch: (
		execution: Effect.Effect<
			Discard extends true ? string : Success["Type"],
			Error["Type"],
			Error["DecodingServices"] | Payload["EncodingServices"] | Success["DecodingServices"]
		>,
	) => Effect.Effect<Result, DispatchError, DispatchServices>,
) {
	const executionId = options.executionId ?? (yield* workflow.executionId(options.payload));
	yield* admit(admitWorkflow(receipts, workflow, account, executionId));
	return yield* dispatch(engine.execute(workflow, { ...options, executionId }));
});
