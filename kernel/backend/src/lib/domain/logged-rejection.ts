import { internalError } from "@ryot-app/contract/errors";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Cause, Effect } from "effect";

/** Several causes share one coded rejection on the wire, so the specific cause goes only to the log. */
export const rejectWithLoggedCause = <
	E extends { readonly _tag: string; readonly reason: { readonly code: string } },
>(
	error: E,
	cause: string,
) =>
	Effect.logDebug(`${error._tag} ${error.reason.code}: ${cause}`).pipe(
		Effect.andThen(Effect.fail(error)),
	);

export const unexpected = () => internalError(kernelMessage("error.internal.unexpected"));

/** Logs every non-interrupt cause, then fails with the generic internal error. */
export const asUnexpected = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
	effect.pipe(
		Effect.catchCauseIf(
			(cause) => !Cause.hasInterruptsOnly(cause),
			(cause) => Effect.logError(message, cause).pipe(Effect.andThen(Effect.fail(unexpected()))),
		),
		Effect.mapError(unexpected),
	);
