import { BadRequest } from "@ryot/contract/errors";
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

export const badRequestMessage = (cause: Cause.Cause<unknown>) =>
	Option.flatMap(Cause.findErrorOption(cause), (error) =>
		error instanceof BadRequest ? Option.some(error.message) : Option.none(),
	).pipe(Option.getOrUndefined);

export type RequestFailureRule<Step extends string> = {
	readonly step: Step;
	readonly detail: string;
	readonly matches: (message: string) => boolean;
};

export type ResolvedRequestFailure<Step extends string> = {
	readonly detail: string;
	readonly step: Step | undefined;
};

/**
 * Maps a server message onto the step that can fix it, so a wizard can send the user back to the
 * field at fault instead of showing a dead end. An unrecognized message keeps the user where they
 * are with the fallback detail.
 */
export const resolveRequestFailure = <Step extends string>(
	rules: readonly RequestFailureRule<Step>[],
	message: string | undefined,
	fallbackDetail: string,
): ResolvedRequestFailure<Step> => {
	const rule =
		message === undefined ? undefined : rules.find((candidate) => candidate.matches(message));
	return rule === undefined
		? { step: undefined, detail: fallbackDetail }
		: { step: rule.step, detail: rule.detail };
};
