import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { Cause, Effect, Option } from "effect";

import { AdminApiError } from "#/api/admin";

const isUnauthorizedError = (error: unknown): boolean =>
	error instanceof AuthUnauthorized ||
	(error instanceof AdminApiError && isUnauthorizedError(error.cause));

export const isUnauthorizedCause = (cause: Cause.Cause<unknown>) =>
	Option.exists(Cause.findErrorOption(cause), isUnauthorizedError);

export const withAdminAuthorization = Effect.fnUntraced(function* <A, E>(
	request: Effect.Effect<A, E>,
	onUnauthorized: () => void,
) {
	return yield* request.pipe(
		Effect.tapCause((cause) =>
			isUnauthorizedCause(cause) ? Effect.sync(onUnauthorized) : Effect.void,
		),
	);
});
