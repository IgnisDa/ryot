import {
	type RequestFailureRule,
	resolveRequestFailure,
	type ResolvedRequestFailure,
} from "@/api/request-failure";
import type { WizardStep } from "@/modules/ui/wizard/wizard-state";

export type ImportStartFailure = ResolvedRequestFailure<WizardStep>;

const FALLBACK_DETAIL = "This import could not be started. Try again.";

const startFailureRules: readonly RequestFailureRule<WizardStep>[] = [
	{
		step: "configure",
		detail: "That file is not a format this service can read. Choose a different file.",
		matches: (message) =>
			message.startsWith("Import file must have one of the following extensions"),
	},
	{
		step: "configure",
		detail: "Some of these details could not be used. Check them and try again.",
		matches: (message) =>
			message.startsWith("Import source input is invalid") ||
			message.startsWith("Import source does not declare upload token field") ||
			message.startsWith("Import source payload field is reserved") ||
			message.startsWith("Import uploads must use local storage"),
	},
	{
		step: "pick",
		detail:
			"This service is not configured on your server yet. Set what it needs, then choose it again.",
		matches: (message) => message.includes("is not configured"),
	},
	{
		step: "pick",
		detail: "This service is no longer available on your server. Choose another one.",
		matches: (message) =>
			message.startsWith("Import source is not available") ||
			message.startsWith("Import source workflow is not available"),
	},
];

export const importStartFailure = (message: string | undefined) =>
	resolveRequestFailure(startFailureRules, message, FALLBACK_DETAIL);
