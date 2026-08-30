import type { ContractSuccess } from "@ryot-app/contract/client";
import type { UserLifecycleOperation } from "@ryot-app/contract/modules/god-mode/user-lifecycle";
import { Data, Effect, Match, Option, Schedule } from "effect";

const USER_LIFECYCLE_POLL_ATTEMPTS = 60;

const userLifecyclePollSchedule = Schedule.spaced("2 seconds").pipe(
	Schedule.upTo({ times: USER_LIFECYCLE_POLL_ATTEMPTS }),
);

class UserLifecycleOperationPending {
	readonly _tag = "UserLifecycleOperationPending";
}

export type GodModeUserLifecycleOperation = typeof UserLifecycleOperation.Type;

export type GodModeUserResetResult = NonNullable<GodModeUserLifecycleOperation["resetResult"]>;

export class GodModeOperationNotFound extends Data.TaggedError("GodModeOperationNotFound")<{
	readonly operationId: string;
}> {}

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
	readonly start: Effect.Effect<ContractSuccess<"godMode", "deleteUser">, unknown>;
	readonly poll: (
		operationId: string,
	) => Effect.Effect<Option.Option<GodModeUserLifecycleOperation>, unknown>;
}) =>
	Effect.gen(function* () {
		const { operationId } = yield* input.start;
		return yield* Effect.gen(function* () {
			const result = yield* input.poll(operationId);
			if (Option.isNone(result)) {
				return yield* new GodModeOperationNotFound({ operationId });
			}
			return yield* operationOutcome(result.value);
		}).pipe(
			Effect.retry({
				schedule: userLifecyclePollSchedule,
				while: (error) => error instanceof UserLifecycleOperationPending,
			}),
		);
	});
