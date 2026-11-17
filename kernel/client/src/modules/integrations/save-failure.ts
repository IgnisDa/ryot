import {
	IntegrationRequestError,
	type IntegrationRequestFailureReason,
} from "@ryot-app/contract/modules/integrations/schemas";
import { EntitlementRequired } from "@ryot-app/contract/schema/entitlement";
import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Match } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { WizardStep } from "#/modules/ui/wizard/wizard-state";

export type IntegrationSaveFailure = {
	readonly detail: Message;
	readonly step: undefined | WizardStep;
};

const fallback = {
	step: undefined,
	detail: kernelMessage("client.integrations.save.failed"),
} as const;

const presentReason = (reason: IntegrationRequestFailureReason): IntegrationSaveFailure =>
	Match.value(reason).pipe(
		Match.when({ code: "invalid-provider-settings" }, () => ({
			step: "configure" as const,
			detail: kernelMessage("client.ui.wizard.invalid-input"),
		})),
		Match.when({ code: "asset-forbidden" }, () => ({
			step: "configure" as const,
			detail: kernelMessage("client.integrations.save.asset-forbidden"),
		})),
		Match.when({ code: "invalid-progress-range" }, () => ({
			step: "configure" as const,
			detail: kernelMessage("client.integrations.save.progress-range"),
		})),
		Match.when({ code: "progress-out-of-range" }, () => ({
			step: "configure" as const,
			detail: kernelMessage("client.integrations.save.progress-bounds"),
		})),
		Match.when({ code: "provider-not-found" }, () => ({
			step: "pick" as const,
			detail: kernelMessage("client.ui.wizard.service.removed"),
		})),
		Match.when({ code: "integration-not-found" }, () => fallback),
		Match.when({ code: "integration-webhook-not-found" }, () => fallback),
		Match.when({ code: "wrong-integration-lot" }, () => fallback),
		Match.when({ code: "queue-unavailable" }, () => fallback),
		Match.exhaustive,
	);

export const integrationSaveFailure = (error: unknown): IntegrationSaveFailure => {
	const cause = error instanceof AuthenticatedApiError ? error.cause : error;
	if (cause instanceof EntitlementRequired) {
		return { step: "pick", detail: kernelMessage("client.integrations.pro-required") };
	}
	return cause instanceof IntegrationRequestError ? presentReason(cause.reason) : fallback;
};
