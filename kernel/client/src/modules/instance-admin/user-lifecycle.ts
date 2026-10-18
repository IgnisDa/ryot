import type { ContractSuccess } from "@ryot-app/contract/client";
import type { UserLifecycleOperation } from "@ryot-app/contract/modules/instance-admin/user-lifecycle";
import { Data, Effect, Match, Option, Schedule } from "effect";

import type { AdminApiError } from "#/api/admin";
import type { InstanceAdminQueryError } from "#/api/instance-admin";

const USER_LIFECYCLE_POLL_ATTEMPTS = 60;

const userLifecyclePollSchedule = Schedule.spaced("2 seconds").pipe(
	Schedule.upTo({ times: USER_LIFECYCLE_POLL_ATTEMPTS }),
);

export type InstanceAdminUserLifecycleOperation = UserLifecycleOperation;

export type InstanceAdminUserResetResult = NonNullable<
	InstanceAdminUserLifecycleOperation["resetResult"]
>;

class UserLifecycleOperationPending {
	readonly _tag = "UserLifecycleOperationPending";
}

export class InstanceAdminOperationNotFound extends Data.TaggedError(
	"InstanceAdminOperationNotFound",
)<{ readonly operationId: string }> {}

const operationOutcome = (operation: InstanceAdminUserLifecycleOperation) =>
	Match.value(operation.status).pipe(
		Match.when("completed", () => Effect.succeed(operation)),
		Match.when("failed", () =>
			Effect.logWarning("instance-admin user lifecycle operation failed", operation.failure).pipe(
				Effect.andThen(Effect.fail(operation)),
			),
		),
		Match.orElse(() => Effect.fail(new UserLifecycleOperationPending())),
	);

export const runUserLifecycleOperation = (input: {
	readonly start: Effect.Effect<ContractSuccess<"instanceAdmin", "deleteUser">, AdminApiError>;
	readonly poll: (
		operationId: string,
	) => Effect.Effect<
		Option.Option<InstanceAdminUserLifecycleOperation>,
		AdminApiError | InstanceAdminQueryError
	>;
}) =>
	Effect.gen(function* () {
		const { operationId } = yield* input.start;
		return yield* Effect.gen(function* () {
			const result = yield* input.poll(operationId);
			if (Option.isNone(result)) {
				return yield* new InstanceAdminOperationNotFound({ operationId });
			}
			return yield* operationOutcome(result.value);
		}).pipe(
			Effect.retry({
				schedule: userLifecyclePollSchedule,
				while: (error) => error instanceof UserLifecycleOperationPending,
			}),
		);
	});
