import { expect } from "bun:test";

import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { ImportRunId, UserId } from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Context, Effect, Layer, Ref } from "effect";

import { ImportRunCancellationService } from "./cancellation-service";
import { ImportRunExecutionController } from "./execution-controller";
import { ImportsRepository } from "./repository";

const runId = ImportRunId.make("run-1");
const user: CurrentUserValue = {
	image: null,
	name: "Test User",
	email: "user@example.com",
	id: UserId.make("user-1"),
	preferences: {
		language: null,
		reportingTimeZone: UTC,
		ratingScale: "hundred",
		disableIntegrations: false,
	},
};

type RunControl = Effect.Success<ReturnType<ImportsRepository["Service"]["getRunControlForUser"]>>;

class FakeCancellation extends Context.Service<
	FakeCancellation,
	{ readonly events: Effect.Effect<ReadonlyArray<unknown>> }
>()("@ryot-app/kernel-backend/modules/imports/cancellation-service.test/FakeCancellation") {}

const makeLayer = (run: RunControl) =>
	ImportRunCancellationService.layer.pipe(
		Layer.provideMerge(
			Layer.unwrap(
				Effect.gen(function* () {
					const events = yield* Ref.make<ReadonlyArray<unknown>>([]);
					let status = run?.status;
					return Layer.mergeAll(
						Layer.succeed(FakeCancellation, { events: Ref.get(events) }),
						Layer.succeed(ImportRunExecutionController, {
							interrupt: (input) => Ref.update(events, (all) => [...all, input]),
						}),
						Layer.mock(ImportsRepository)({
							getRunControlForUser: () =>
								Effect.sync(() => (run && status ? { ...run, status } : run)),
							cancelIngestion: () =>
								Ref.update(events, (all) => [...all, "requested"]).pipe(
									Effect.andThen(
										Effect.sync(() => {
											status = "cancelling";
											return true;
										}),
									),
								),
						}),
					);
				}),
			),
		),
	);

for (const executionKind of ["source", "integration"] as const) {
	layer(makeLayer({ id: runId, executionKind, status: "running" }))((test) => {
		test.effect(
			`marks the run cancelling before interrupting the ${executionKind} execution`,
			() =>
				Effect.gen(function* () {
					expect(yield* (yield* ImportRunCancellationService).cancelRun(user, runId)).toEqual({
						id: runId,
					});
					expect(yield* (yield* FakeCancellation).events).toEqual([
						"requested",
						{ runId, executionKind },
					]);
				}),
			testTimeout,
		);
	});
}

layer(makeLayer({ id: runId, status: "cancelling", executionKind: "integration" }))((test) => {
	test.effect(
		"interrupts again when a cancellation is repeated, in case the first never arrived",
		() =>
			Effect.gen(function* () {
				yield* (yield* ImportRunCancellationService).cancelRun(user, runId);
				expect(yield* (yield* FakeCancellation).events).toEqual([
					"requested",
					{ runId, executionKind: "integration" },
				]);
			}),
		testTimeout,
	);
});

layer(makeLayer({ id: runId, status: "cancelled", executionKind: "integration" }))((test) => {
	test.effect(
		"accepts a repeated cancellation for a cancelled run",
		() =>
			Effect.gen(function* () {
				expect(yield* (yield* ImportRunCancellationService).cancelRun(user, runId)).toEqual({
					id: runId,
				});
				expect(yield* (yield* FakeCancellation).events).toEqual([]);
			}),
		testTimeout,
	);
});

for (const status of ["completed", "failed"] as const) {
	layer(makeLayer({ status, id: runId, executionKind: "source" }))((test) => {
		test.effect(
			`rejects cancellation for a ${status} run`,
			() =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(
						(yield* ImportRunCancellationService).cancelRun(user, runId),
					);
					expect(error).toMatchObject({ reason: { runId, status, code: "run-not-cancellable" } });
					expect(yield* (yield* FakeCancellation).events).toEqual([]);
				}),
			testTimeout,
		);
	});
}

layer(makeLayer(null))((test) => {
	test.effect(
		"returns not found for missing and foreign runs",
		() =>
			Effect.gen(function* () {
				const service = yield* ImportRunCancellationService;
				for (const requestUser of [user, { ...user, id: UserId.make("foreign-user") }]) {
					const error = yield* Effect.flip(service.cancelRun(requestUser, runId));
					expect(error).toMatchObject({ reason: { runId, code: "run-not-found" } });
				}
				expect(yield* (yield* FakeCancellation).events).toEqual([]);
			}),
		testTimeout,
	);
});
