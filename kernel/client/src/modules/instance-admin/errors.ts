import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { Cause, Effect, Exit, Option } from "effect";

import { AdminApiError } from "#/api/admin";

const isUnauthorizedError = (error: unknown): boolean =>
	error instanceof AuthUnauthorized ||
	(error instanceof AdminApiError && isUnauthorizedError(error.cause));

export const isUnauthorizedCause = (cause: Cause.Cause<unknown>) =>
	Option.exists(Cause.findErrorOption(cause), isUnauthorizedError);

export const readAdminResult = Effect.fnUntraced(function* <A>(
	request: Effect.Effect<Exit.Exit<A, unknown>>,
	onUnauthorized: () => void,
) {
	const result = yield* request;
	if (Exit.isSuccess(result)) {
		return result.value;
	}
	if (isUnauthorizedCause(result.cause)) {
		yield* Effect.sync(onUnauthorized);
	}
	return yield* Effect.failCause(result.cause);
});
