import {
	ImportRequestError,
	type ImportRequestFailureReason,
} from "@ryot-app/contract/modules/imports/schemas";
import { Match } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { WizardStep } from "#/modules/ui/wizard/wizard-state";

import { ingestionBlockReasonLabel } from "./run-presentation";

export type ImportStartFailure = { readonly detail: string; readonly step: WizardStep | undefined };

const fallback = {
	step: undefined,
	detail: "This import could not be started. Try again.",
} as const;

const presentReason = (reason: ImportRequestFailureReason): ImportStartFailure =>
	Match.value(reason).pipe(
		Match.when({ code: "unsupported-file-extension" }, () => ({
			step: "configure" as const,
			detail: "That file is not a format this service can read. Choose a different file.",
		})),
		Match.when({ code: "invalid-input" }, () => ({
			step: "configure" as const,
			detail: "Some of these details could not be used. Check them and try again.",
		})),
		Match.when({ code: "upload-unavailable" }, () => ({
			step: "configure" as const,
			detail: "The selected file is no longer available. Choose it again.",
		})),
		Match.when({ code: "source-not-ready" }, ({ blockReasons }) => ({
			step: "configure" as const,
			detail:
				blockReasons.map((blockReason) => ingestionBlockReasonLabel(blockReason)).join(" ") ||
				"Setup is not ready for this source. Check its requirements and try again.",
		})),
		Match.when({ code: "source-not-found" }, () => ({
			step: "pick" as const,
			detail: "This service is no longer available on your server. Choose another one.",
		})),
		Match.when({ code: "workflow-unavailable" }, () => ({
			step: "pick" as const,
			detail: "This service is no longer available on your server. Choose another one.",
		})),
		Match.when({ code: "queue-unavailable" }, () => fallback),
		Match.exhaustive,
	);

export const importStartFailure = (error: unknown): ImportStartFailure => {
	const cause = error instanceof AuthenticatedApiError ? error.cause : error;
	return cause instanceof ImportRequestError ? presentReason(cause.reason) : fallback;
};
