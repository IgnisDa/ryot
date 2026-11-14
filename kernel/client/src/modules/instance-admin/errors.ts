import { AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { Cause, Effect, Option } from "effect";

import { AdminApiError } from "#/api/admin";

const isUnauthorizedError = (error: unknown): boolean =>
	error instanceof AuthUnauthorized ||
	(error instanceof AdminApiError && isUnauthorizedError(error.cause));

export const isUnauthorizedCause = (cause: Cause.Cause<unknown>) =>
	Option.exists(Cause.findErrorOption(cause), isUnauthorizedError);

export const withAdminAuthorization = <A, E>(
	request: Effect.Effect<A, E>,
	onUnauthorized: () => void,
) =>
	request.pipe(
		Effect.tapCause((cause) =>
			isUnauthorizedCause(cause) ? Effect.sync(onUnauthorized) : Effect.void,
		),
	);

export const runAdminAction = <A>(input: {
	readonly signal: AbortSignal;
	readonly onUnauthorized: () => void;
	readonly onSuccess: (value: A) => void;
	readonly onSettled: (aborted: boolean) => void;
	readonly operation: () => Effect.Effect<A, unknown>;
	readonly onFailure: (cause: Cause.Cause<unknown>) => void;
}) =>
	Effect.suspend(input.operation).pipe(
		Effect.matchCause({
			onSuccess: (value) => {
				if (!input.signal.aborted) {
					input.onSuccess(value);
				}
			},
			onFailure: (cause) => {
				if (input.signal.aborted || Cause.hasInterruptsOnly(cause)) {
					return;
				}
				if (isUnauthorizedCause(cause)) {
					input.onUnauthorized();
				} else {
					input.onFailure(cause);
				}
			},
		}),
		Effect.ensuring(Effect.sync(() => input.onSettled(input.signal.aborted))),
	);
