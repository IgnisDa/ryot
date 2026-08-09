import {
	IntegrationRequestError,
	type IntegrationRequestFailureReason,
} from "@ryot-app/contract/modules/integrations/schemas";
import type { Cause } from "effect";
import { Match } from "effect";

import { requestFailureError } from "@/api/request-failure";
import type { WizardStep } from "@/modules/ui/wizard/wizard-state";

import { PRO_REQUIRED_INTEGRATION_MESSAGE } from "./provider-selection";

export type IntegrationSaveFailure = {
	readonly detail: string;
	readonly step: WizardStep | undefined;
};

const FALLBACK_DETAIL = "This integration could not be saved. Try again.";

const fallback = { step: undefined, detail: FALLBACK_DETAIL } as const;

const presentReason = (reason: IntegrationRequestFailureReason): IntegrationSaveFailure =>
	Match.value(reason).pipe(
		Match.when({ code: "invalid-provider-settings" }, () => ({
			step: "configure" as const,
			detail: "Some of these details could not be used. Check them and try again.",
		})),
		Match.when({ code: "invalid-progress-range" }, () => ({
			step: "configure" as const,
			detail: "The lowest progress must not be higher than the highest progress.",
		})),
		Match.when({ code: "progress-out-of-range" }, () => ({
			step: "configure" as const,
			detail: "Progress values must be between 0 and 100.",
		})),
		Match.when({ code: "pro-key-required" }, () => ({
			step: "pick" as const,
			detail: PRO_REQUIRED_INTEGRATION_MESSAGE,
		})),
		Match.when({ code: "provider-not-found" }, () => ({
			step: "pick" as const,
			detail: "This service is no longer available on your server. Choose another one.",
		})),
		Match.when({ code: "integration-not-found" }, () => fallback),
		Match.when({ code: "wrong-integration-lot" }, () => fallback),
		Match.when({ code: "queue-unavailable" }, () => fallback),
		Match.exhaustive,
	);

export const integrationSaveFailure = (cause: Cause.Cause<unknown>) => {
	const error = requestFailureError(
		cause,
		(value): value is IntegrationRequestError => value instanceof IntegrationRequestError,
	);
	return error === undefined ? fallback : presentReason(error.reason);
};
