import { BadRequest } from "@ryot/contract/errors";
import { Cause, Option } from "effect";

import type { ImportWizardStep } from "./start-wizard-state";

export type ImportStartFailure = {
	readonly detail: string;
	readonly step: ImportWizardStep | undefined;
};

const FALLBACK_DETAIL = "This import could not be started. Try again.";

const startFailureRules: readonly {
	readonly detail: string;
	readonly step: ImportWizardStep;
	readonly matches: (message: string) => boolean;
}[] = [
	{
		step: "input",
		detail: "That file is not a format this service can read. Choose a different file.",
		matches: (message) =>
			message.startsWith("Import file must have one of the following extensions"),
	},
	{
		step: "input",
		detail: "Some of these details could not be used. Check them and try again.",
		matches: (message) =>
			message.startsWith("Import source input is invalid") ||
			message.startsWith("Import source does not declare upload token field") ||
			message.startsWith("Import source payload field is reserved") ||
			message.startsWith("Import uploads must use local storage"),
	},
	{
		step: "source",
		detail:
			"This service is not configured on your server yet. Set what it needs, then choose it again.",
		matches: (message) => message.includes("is not configured"),
	},
	{
		step: "source",
		detail: "This service is no longer available on your server. Choose another one.",
		matches: (message) =>
			message.startsWith("Import source is not available") ||
			message.startsWith("Import source workflow is not available"),
	},
];

export const importStartFailure = (message: string | undefined): ImportStartFailure => {
	const rule =
		message === undefined
			? undefined
			: startFailureRules.find((candidate) => candidate.matches(message));
	return rule === undefined
		? { step: undefined, detail: FALLBACK_DETAIL }
		: { step: rule.step, detail: rule.detail };
};

export const importStartFailureMessage = (cause: Cause.Cause<unknown>) =>
	Option.flatMap(Cause.findErrorOption(cause), (error) =>
		error instanceof BadRequest ? Option.some(error.message) : Option.none(),
	).pipe(Option.getOrUndefined);
