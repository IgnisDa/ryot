import {
	ImportRequestError,
	type ImportRequestFailureReason,
} from "@ryot-app/contract/modules/imports/schemas";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Match } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import type { WizardStep } from "#/modules/ui/wizard/wizard-state";

import { ingestionBlockReasonsMessage } from "./run-presentation";

export type ImportStartFailure = { readonly detail: string; readonly step: undefined | WizardStep };

const fallback = (t: (message: Message) => Text): ImportStartFailure => ({
	step: undefined,
	detail: t(kernelMessage("client.imports.start-failure.fallback")),
});

const presentReason = (
	t: (message: Message) => Text,
	reason: ImportRequestFailureReason,
): ImportStartFailure =>
	Match.value(reason).pipe(
		Match.when({ code: "unsupported-file-extension" }, () => ({
			step: "configure" as const,
			detail: t(kernelMessage("client.imports.start-failure.unsupported-file")),
		})),
		Match.when({ code: "invalid-input" }, () => ({
			step: "configure" as const,
			detail: t(kernelMessage("client.ui.wizard.invalid-input")),
		})),
		Match.when({ code: "upload-unavailable" }, () => ({
			step: "configure" as const,
			detail: t(kernelMessage("client.imports.start-failure.upload-unavailable")),
		})),
		Match.when({ code: "source-not-ready" }, ({ blockReasons }) => ({
			step: "configure" as const,
			detail: t(
				ingestionBlockReasonsMessage(
					blockReasons,
					kernelMessage("client.imports.start-failure.source-not-ready"),
				),
			),
		})),
		Match.when({ code: "source-not-found" }, () => ({
			step: "pick" as const,
			detail: t(kernelMessage("client.ui.wizard.service.removed")),
		})),
		Match.when({ code: "workflow-unavailable" }, () => ({
			step: "pick" as const,
			detail: t(kernelMessage("client.ui.wizard.service.removed")),
		})),
		Match.when({ code: "queue-unavailable" }, () => fallback(t)),
		Match.exhaustive,
	);

export const importStartFailure = (
	t: (message: Message) => Text,
	error: unknown,
): ImportStartFailure => {
	const cause = error instanceof AuthenticatedApiError ? error.cause : error;
	return cause instanceof ImportRequestError ? presentReason(t, cause.reason) : fallback(t);
};
