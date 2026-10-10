import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";
import { Workflow } from "effect/workflow";

import { assertExitFails } from "#lib/test-utils/assertions";
import { makeWorkflowEngine } from "#lib/test-utils/effect";

import { dispatchAdmittedWorkflow } from "./workflow-dispatch";

const account = { token: "generation", userId: UserId.make("dispatch-owner") };

it.effect(
	"derives ownership once, records it before dispatch, and retains it for a failed dispatch retry",
	() =>
		Effect.gen(function* () {
			let derivations = 0;
			const workflow = Workflow.make("AdmittedRetryWorkflow", {
				error: Schema.String,
				success: Schema.String,
				payload: Schema.Struct({ key: Schema.String }),
				idempotencyKey: ({ key }) => {
					derivations += 1;
					return key;
				},
			});
			const calls: Array<string> = [];
			let owner: string | undefined;
			let attempts = 0;
			const receipts = {
				registerWorkflow: (identity: typeof account | null, name: string, executionId: string) =>
					Effect.sync(() => {
						expect(identity).toEqual(account);
						expect(name).toBe(workflow._tag);
						owner = executionId;
						calls.push("admit");
					}),
			};
			const engine = makeWorkflowEngine({
				execute: (definition, options) =>
					Effect.gen(function* () {
						expect(definition).toBe(workflow);
						expect(options.executionId).toBe(owner);
						calls.push("dispatch");
						attempts += 1;
						return yield* attempts === 1 ? Effect.fail("unavailable") : Effect.succeed("completed");
					}),
			});
			const execute = dispatchAdmittedWorkflow(
				receipts,
				engine,
				workflow,
				account,
				{ payload: { key: "retry" } },
				(admission) => admission,
				Effect.result,
			);
			expect(yield* execute).toMatchObject({ _tag: "Failure", failure: "unavailable" });
			const firstOwner = owner;
			expect(yield* execute).toMatchObject({ _tag: "Success", success: "completed" });
			expect(owner).toBe(firstOwner);
			expect(derivations).toBe(2);
			expect(calls).toEqual(["admit", "dispatch", "admit", "dispatch"]);
		}),
);

it.effect(
	"keeps admission failures outside dispatch recovery and does not start the workflow",
	() =>
		Effect.gen(function* () {
			const workflow = Workflow.make("RejectedWorkflow", {
				error: Schema.String,
				success: Schema.String,
				payload: Schema.Struct({}),
				idempotencyKey: () => "rejected",
			});
			let dispatched = false;
			const engine = makeWorkflowEngine({
				execute: () =>
					Effect.sync(() => {
						dispatched = true;
						return "unexpected";
					}),
			});
			const failure = new DbError({ message: "Mutation command belongs to a retired account" });
			const exit = yield* Effect.exit(
				dispatchAdmittedWorkflow(
					{ registerWorkflow: () => Effect.fail(failure) },
					engine,
					workflow,
					account,
					{ payload: {} },
					(admission) => admission,
					Effect.result,
				),
			);
			assertExitFails(exit, failure);
			expect(dispatched).toBe(false);
		}),
);

it.effect(
	"passes an explicit null account and explicit ID without deriving a system execution ID",
	() =>
		Effect.gen(function* () {
			const workflow = Workflow.make("SystemWorkflow", {
				error: Schema.Never,
				success: Schema.String,
				payload: Schema.Struct({ value: Schema.String }),
				idempotencyKey: () => {
					throw new Error("Explicit IDs must not be derived");
				},
			});
			let registered = false;
			const engine = makeWorkflowEngine({
				execute: (definition, options) =>
					Effect.sync(() => {
						expect(registered).toBe(true);
						expect(definition).toBe(workflow);
						expect(options).toEqual({
							discard: true,
							executionId: "explicit",
							payload: { value: "system" },
						});
						return options.executionId;
					}),
			});
			const result = yield* dispatchAdmittedWorkflow(
				{
					registerWorkflow: (identity, name, executionId) =>
						Effect.sync(() => {
							expect(identity).toBeNull();
							expect(name).toBe("SystemWorkflow");
							expect(executionId).toBe("explicit");
							registered = true;
						}),
				},
				engine,
				workflow,
				null,
				{ discard: true, executionId: "explicit", payload: { value: "system" } },
				(admission) => admission,
				(execution) => execution,
			);
			expect(result).toBe("explicit");
		}),
);
