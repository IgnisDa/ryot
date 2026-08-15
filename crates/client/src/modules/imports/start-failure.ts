import {
	ImportRequestError,
	type ImportRequestFailureReason,
} from "@ryot-app/contract/modules/imports/schemas";
import type { Cause } from "effect";
import { Match } from "effect";

import { requestFailureError } from "@/api/request-failure";
import type { WizardStep } from "@/modules/ui/wizard/wizard-state";

export type ImportStartFailure = { readonly detail: string; readonly step: WizardStep | undefined };

const FALLBACK_DETAIL = "This import could not be started. Try again.";

const fallback = { step: undefined, detail: FALLBACK_DETAIL } as const;

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
		Match.when({ code: "source-not-configured" }, () => ({
			step: "pick" as const,
			detail:
				"This service is not configured on your server yet. Set what it needs, then choose it again.",
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
		Match.when({ code: "run-not-found" }, () => fallback),
		Match.when({ code: "run-not-terminal" }, () => fallback),
		Match.exhaustive,
	);

export const importStartFailure = (cause: Cause.Cause<unknown>) => {
	const error = requestFailureError(
		cause,
		(value): value is ImportRequestError => value instanceof ImportRequestError,
	);
	return error === undefined ? fallback : presentReason(error.reason);
};
