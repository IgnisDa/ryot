import {
	type RequestFailureRule,
	resolveRequestFailure,
	type ResolvedRequestFailure,
} from "@/api/request-failure";
import type { WizardStep } from "@/modules/ui/wizard/wizard-state";

export type IntegrationSaveFailure = ResolvedRequestFailure<WizardStep>;

const FALLBACK_DETAIL = "This integration could not be saved. Try again.";

const saveFailureRules: readonly RequestFailureRule<WizardStep>[] = [
	{
		step: "configure",
		detail: "Some of these details could not be used. Check them and try again.",
		matches: (message) => message.startsWith("Invalid providerSpecifics"),
	},
	{
		step: "configure",
		detail: "The lowest progress must not be higher than the highest progress.",
		matches: (message) => message.startsWith("minimumProgress must not exceed"),
	},
	{
		step: "configure",
		detail: "Progress values must be between 0 and 100.",
		matches: (message) =>
			message.startsWith("minimumProgress must be between") ||
			message.startsWith("maximumProgress must be between"),
	},
	{
		step: "pick",
		matches: (message) => message.includes("is not registered"),
		detail: "This service is no longer available on your server. Choose another one.",
	},
];

export const integrationSaveFailure = (message: string | undefined) =>
	resolveRequestFailure(saveFailureRules, message, FALLBACK_DETAIL);
