import { expect } from "bun:test";

import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { it } from "@voila.dev/effect-bun-test";
import { Cause, Effect, Exit, Schema } from "effect";
import { Workflow } from "effect/workflow";

import { WorkflowAccountRejected, WorkflowAdmissionAccount } from "#platform/workflow/account";
import { makeWorkflowEngine } from "#testing/effect";

import { dispatchAdmittedWorkflow } from "./workflow-dispatch";

const account = UserId.make("dispatch-owner");

const workflow = Workflow.make("AdmittedWorkflow", {
	error: Schema.Never,
	success: Schema.String,
	idempotencyKey: ({ key }) => key,
	payload: Schema.Struct({ key: Schema.String }),
});

it.effect(
	"admits the execution derived from its payload under the given account",
	() =>
		Effect.gen(function* () {
			const engine = makeWorkflowEngine({
				execute: (definition, options) =>
					Effect.gen(function* () {
						expect(definition).toBe<unknown>(workflow);
						expect(yield* WorkflowAdmissionAccount).toEqual(account);
						return options.executionId;
					}),
			});
			const executionId = yield* workflow.executionId({ key: "derived" });
			expect(
				yield* dispatchAdmittedWorkflow(engine, workflow, account, { payload: { key: "derived" } }),
			).toBe(executionId);
		}),
	testTimeout,
);

it.effect(
	"admits an explicit execution ID without an account",
	() =>
		Effect.gen(function* () {
			const engine = makeWorkflowEngine({
				execute: (_definition, options) =>
					Effect.gen(function* () {
						expect(yield* WorkflowAdmissionAccount).toBeNull();
						return options.executionId;
					}),
			});
			expect(
				yield* dispatchAdmittedWorkflow(engine, workflow, null, {
					executionId: "explicit",
					payload: { key: "ignored" },
				}),
			).toBe("explicit");
		}),
	testTimeout,
);

const dispatch = (defect: unknown) =>
	Effect.exit(
		dispatchAdmittedWorkflow(
			makeWorkflowEngine({ execute: () => Effect.die(defect) }),
			workflow,
			account,
			{ payload: { key: "fenced" } },
		),
	);

it.effect(
	"fails a fenced admission as a database error and keeps other defects",
	() =>
		Effect.gen(function* () {
			const message = "Mutation command account is being retired";
			assertExitFails(
				yield* dispatch(new WorkflowAccountRejected({ message })),
				new DbError({ message }),
			);
			const unrelated = yield* dispatch("engine failure");
			expect(Exit.isFailure(unrelated) && Cause.squash(unrelated.cause)).toBe("engine failure");
		}),
	testTimeout,
);
