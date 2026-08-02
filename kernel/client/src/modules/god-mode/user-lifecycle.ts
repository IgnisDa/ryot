import type { ContractSuccess } from "@ryot-app/contract/client";
import { Effect, Match, Schedule } from "effect";

const USER_LIFECYCLE_POLL_ATTEMPTS = 60;

const userLifecyclePollSchedule = Schedule.spaced("2 seconds").pipe(
	Schedule.upTo({ times: USER_LIFECYCLE_POLL_ATTEMPTS }),
);

class UserLifecycleOperationPending {
	readonly _tag = "UserLifecycleOperationPending";
}

export type GodModeUserLifecycleOperation = ContractSuccess<"godMode", "getUserLifecycleOperation">;

export type GodModeUserResetResult = NonNullable<GodModeUserLifecycleOperation["resetResult"]>;

const operationOutcome = (operation: GodModeUserLifecycleOperation) =>
	Match.value(operation.status).pipe(
		Match.when("completed", () => Effect.succeed(operation)),
		Match.when("failed", () =>
			Effect.logWarning("god-mode user lifecycle operation failed", operation.failure).pipe(
				Effect.andThen(Effect.fail(operation)),
			),
		),
		Match.orElse(() => Effect.fail(new UserLifecycleOperationPending())),
	);

export const runUserLifecycleOperation = (input: {
	readonly start: Effect.Effect<GodModeUserLifecycleOperation, unknown>;
	readonly poll: (operationId: string) => Effect.Effect<GodModeUserLifecycleOperation, unknown>;
}) =>
	Effect.gen(function* () {
		const started = yield* input.start;
		return yield* operationOutcome(started).pipe(
			Effect.catchIf(
				(error) => error instanceof UserLifecycleOperationPending,
				() =>
					input
						.poll(started.id)
						.pipe(
							Effect.flatMap(operationOutcome),
							Effect.retry({
								while: (error) => error instanceof UserLifecycleOperationPending,
								schedule: userLifecyclePollSchedule,
							}),
						),
			),
		);
	});
