import { expect, it, layer } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { makeWorkflowEngine } from "#lib/test-utils/effect";
import { mutationAdmissionTestLayer } from "#lib/test-utils/mutation-admission";

import { UserBootstrap } from "./bootstrap";
import { UserBootstrapScheduling, userBootstrapWorkflowExecutionId } from "./scheduling";

const userId = UserId.make("user-1");
const accountFor = (accountUserId: UserId) => ({
	userId: accountUserId,
	token: "test-account-generation",
});

it("derives a stable and distinct workflow execution id", () => {
	const otherUserId = UserId.make("user-2");

	expect(userBootstrapWorkflowExecutionId(userId, accountFor(userId))).toBe(
		userBootstrapWorkflowExecutionId(userId, accountFor(userId)),
	);
	expect(userBootstrapWorkflowExecutionId(userId, accountFor(userId))).not.toBe(
		userBootstrapWorkflowExecutionId(otherUserId, accountFor(otherUserId)),
	);
	expect(userBootstrapWorkflowExecutionId(userId, accountFor(userId))).toBe(
		"user-bootstrap-6-user-1-test-account-generation",
	);
	expect(userBootstrapWorkflowExecutionId(userId, { userId, token: "next-generation" })).not.toBe(
		userBootstrapWorkflowExecutionId(userId, accountFor(userId)),
	);
});

class RecordedSchedules extends Context.Service<
	RecordedSchedules,
	{
		readonly options: Effect.Effect<
			ReadonlyArray<Parameters<WorkflowEngine["Service"]["execute"]>[1]>
		>;
	}
>()("test/RecordedSchedules") {}

const recordingSchedulingLayer = Layer.unwrap(
	Effect.gen(function* () {
		const options = yield* Ref.make<
			ReadonlyArray<Parameters<WorkflowEngine["Service"]["execute"]>[1]>
		>([]);
		const engine = makeWorkflowEngine({
			execute: (_workflow, input) =>
				Ref.update(options, (all) => [...all, input]).pipe(Effect.as(input.executionId)),
		});
		return UserBootstrapScheduling.layer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					Layer.mock(UserBootstrap)({}),
					Layer.succeed(WorkflowEngine, engine),
					Layer.succeed(RecordedSchedules, { options: Ref.get(options) }),
				),
			),
		);
	}),
);

layer(recordingSchedulingLayer.pipe(Layer.provideMerge(mutationAdmissionTestLayer)))((test) => {
	test.effect("reuses one discarded execution for repeated and concurrent scheduling", () =>
		Effect.gen(function* () {
			const scheduling = yield* UserBootstrapScheduling;
			yield* scheduling.schedule(userId);
			yield* scheduling.schedule(userId);
			yield* Effect.all([scheduling.schedule(userId), scheduling.schedule(userId)], {
				discard: true,
				concurrency: "unbounded",
			});

			const options = yield* (yield* RecordedSchedules).options;
			expect(options).toHaveLength(4);
			expect(options).toEqual(
				Array.from({ length: 4 }, () => ({
					discard: true,
					payload: { userId, accountGeneration: accountFor(userId) },
					executionId: userBootstrapWorkflowExecutionId(userId, accountFor(userId)),
				})),
			);
		}),
	);
});

class RecordedReconciliation extends Context.Service<
	RecordedReconciliation,
	{
		readonly limit: Effect.Effect<number | null>;
		readonly executionIds: Effect.Effect<ReadonlyArray<string>>;
	}
>()("test/RecordedReconciliation") {}

const reconciliationLayer = Layer.unwrap(
	Effect.gen(function* () {
		const limit = yield* Ref.make<number | null>(null);
		const executionIds = yield* Ref.make<ReadonlyArray<string>>([]);
		const failedUserId = UserId.make("user-2");
		const incomplete = [userId, failedUserId, UserId.make("user-3")];
		const engine = makeWorkflowEngine({
			execute: (_workflow, options) =>
				Ref.update(executionIds, (all) => [...all, options.executionId]).pipe(
					Effect.andThen(
						options.executionId ===
							userBootstrapWorkflowExecutionId(failedUserId, accountFor(failedUserId))
							? Effect.fail("workflow unavailable")
							: Effect.succeed(options.executionId),
					),
				),
		});
		return UserBootstrapScheduling.layer.pipe(
			Layer.provideMerge(
				Layer.mergeAll(
					Layer.mock(UserBootstrap)({
						listIncomplete: (value) =>
							Ref.set(limit, value).pipe(Effect.as(incomplete.map((id) => ({ id })))),
					}),
					Layer.succeed(WorkflowEngine, engine),
					Layer.succeed(RecordedReconciliation, {
						limit: Ref.get(limit),
						executionIds: Ref.get(executionIds),
					}),
				),
			),
		);
	}),
);

layer(reconciliationLayer.pipe(Layer.provideMerge(mutationAdmissionTestLayer)))((test) => {
	test.effect("dispatches every incomplete user and contains one scheduling failure", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit((yield* UserBootstrapScheduling).reconcile(25));
			const recorded = yield* RecordedReconciliation;

			expect(exit._tag).toBe("Success");
			expect(yield* recorded.limit).toBe(25);
			expect(yield* recorded.executionIds).toEqual([
				userBootstrapWorkflowExecutionId(userId, accountFor(userId)),
				userBootstrapWorkflowExecutionId(UserId.make("user-2"), accountFor(UserId.make("user-2"))),
				userBootstrapWorkflowExecutionId(UserId.make("user-3"), accountFor(UserId.make("user-3"))),
			]);
		}),
	);
});
