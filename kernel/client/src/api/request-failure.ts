import { Cause, Option } from "effect";

export type RequestFailureState = { readonly status: "transport-error" | "malformed" };

/**
 * The two ways a query can fail read differently to a user: the server was unreachable, or it
 * answered with something this app version cannot display. `subject` names what failed to load
 * and is used as the sentence subject, so pass a noun phrase like "Your import history".
 */
export const requestFailureCopy = (
	state: RequestFailureState,
	copy: { readonly title: string; readonly subject: string },
) => ({
	title: copy.title,
	detail:
		state.status === "transport-error"
			? `${copy.subject} could not be loaded. Check the server and try again.`
			: `${copy.subject} came back in a form that could not be displayed. Try again later.`,
});

export const requestFailureError = <Failure>(
	cause: Cause.Cause<unknown>,
	isFailure: (error: unknown) => error is Failure,
) => Cause.findErrorOption(cause).pipe(Option.filter(isFailure), Option.getOrUndefined);
