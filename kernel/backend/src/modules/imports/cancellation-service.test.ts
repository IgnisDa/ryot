import { expect, layer } from "@effect/vitest";
import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { ImportRunId, UserId } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Ref } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { fakeDatabaseSession, makeWorkflowEngine } from "#lib/test-utils/effect";

import { ImportRunCancellationService } from "./cancellation-service";
import { ImportsRepository } from "./repository";

const runId = ImportRunId.make("run-1");
const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: { language: null, allowNsfw: false, disableIntegrations: false },
};

type RunControl = Effect.Success<ReturnType<ImportsRepository["Service"]["getRunControlForUser"]>>;

class FakeCancellationDispatch extends Context.Service<
	FakeCancellationDispatch,
	{ readonly executions: Effect.Effect<ReadonlyArray<unknown>> }
>()("test/FakeCancellationDispatch") {}

const makeLayer = (run: RunControl) =>
	ImportRunCancellationService.layer.pipe(
		Layer.provideMerge(
			Layer.unwrap(
				Effect.gen(function* () {
					const executions = yield* Ref.make<ReadonlyArray<unknown>>([]);
					const repository = ImportsRepository.layer.pipe(
						Layer.provide(
							fakeDatabaseSession({
								select: () => ({
									from: () => ({
										where: () => ({ limit: () => Effect.succeed(run === null ? [] : [run]) }),
									}),
								}),
							}),
						),
					);
					return Layer.mergeAll(
						repository,
						Layer.succeed(FakeCancellationDispatch, { executions: Ref.get(executions) }),
						Layer.succeed(
							WorkflowEngine,
							makeWorkflowEngine({
								execute: (_workflow, options) => Ref.update(executions, (all) => [...all, options]),
							}),
						),
					);
				}),
			),
		),
	);

layer(makeLayer({ id: runId, status: "running", executionKind: "source" }))((test) => {
	test.effect("dispatches cancellation with a deterministic execution ID", () =>
		Effect.gen(function* () {
			expect(yield* (yield* ImportRunCancellationService).cancelRun(user, runId)).toEqual({
				id: runId,
			});
			expect(yield* (yield* FakeCancellationDispatch).executions).toEqual([
				{ discard: true, executionId: "run-1-cancellation", payload: { runId, userId: user.id } },
			]);
		}),
	);
});

for (const status of ["cancelling", "cancelled"] as const) {
	layer(makeLayer({ status, id: runId, executionKind: "integration" }))((test) => {
		test.effect(`accepts a repeated cancellation for a ${status} run`, () =>
			Effect.gen(function* () {
				expect(yield* (yield* ImportRunCancellationService).cancelRun(user, runId)).toEqual({
					id: runId,
				});
				expect(yield* (yield* FakeCancellationDispatch).executions).toHaveLength(
					status === "cancelling" ? 1 : 0,
				);
			}),
		);
	});
}

for (const status of ["completed", "failed"] as const) {
	layer(makeLayer({ status, id: runId, executionKind: "source" }))((test) => {
		test.effect(`rejects cancellation for a ${status} run`, () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					(yield* ImportRunCancellationService).cancelRun(user, runId),
				);
				expect(error).toMatchObject({ reason: { runId, status, code: "run-not-cancellable" } });
				expect(yield* (yield* FakeCancellationDispatch).executions).toEqual([]);
			}),
		);
	});
}

layer(makeLayer(null))((test) => {
	test.effect("returns not found for missing and foreign runs", () =>
		Effect.gen(function* () {
			const service = yield* ImportRunCancellationService;
			for (const requestUser of [user, { ...user, id: UserId.make("foreign-user") }]) {
				const error = yield* Effect.flip(service.cancelRun(requestUser, runId));
				expect(error).toMatchObject({ reason: { runId, code: "run-not-found" } });
			}
			expect(yield* (yield* FakeCancellationDispatch).executions).toEqual([]);
		}),
	);
});
