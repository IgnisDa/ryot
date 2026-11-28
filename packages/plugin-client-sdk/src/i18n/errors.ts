import { messageReasonOf, ValidationFailed, type ValidationIssue } from "@ryot-app/contract/errors";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Predicate } from "effect";

import { isOperationRejected } from "../client/errors";

const errorMessage = (error: unknown): Message | undefined => {
	if (isOperationRejected(error)) {
		return error.rejection;
	}
	return (
		messageReasonOf(error) ??
		(Predicate.hasProperty(error, "cause") ? errorMessage(error.cause) : undefined)
	);
};

/**
 * Renders the explanation an error carries: an operation's rejection message, or the message reason
 * of a contract error or any of its causes. Otherwise renders `fallback`, a message or text the
 * caller already rendered.
 */
export const formatError = (
	t: (message: Message) => Text,
	error: unknown,
	fallback: Text | Message = kernelMessage("error.internal.unexpected"),
): Text => {
	const message = errorMessage(error);
	if (message !== undefined) {
		return t(message);
	}
	return typeof fallback === "string" ? fallback : t(fallback);
};

export const validationIssuesOf = (error: unknown): readonly ValidationIssue[] => {
	if (error instanceof ValidationFailed) {
		return error.issues;
	}
	return Predicate.hasProperty(error, "cause") ? validationIssuesOf(error.cause) : [];
};
