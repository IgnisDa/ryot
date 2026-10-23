import { NotificationRequestError } from "@ryot-app/contract/modules/notifications/schemas";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { WizardStep } from "#/modules/ui/wizard/wizard-state";

export type NotificationChannelSaveFailure = {
	readonly detail: string;
	readonly step: WizardStep | undefined;
};

export const INVALID_CHANNEL_DETAILS_MESSAGE =
	"Some of these details could not be used. Check them and try again.";

const fallback: NotificationChannelSaveFailure = {
	step: undefined,
	detail: "This channel could not be saved. Try again.",
};

/** The wizard always sends a matching kind, so the one rejection reason means the pick is stale. */
export const notificationChannelSaveFailure = (error: unknown): NotificationChannelSaveFailure => {
	const cause = error instanceof AuthenticatedApiError ? error.cause : error;
	return cause instanceof NotificationRequestError
		? { step: "pick", detail: "That channel could not be added. Choose it again." }
		: fallback;
};
