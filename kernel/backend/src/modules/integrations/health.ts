import type {
	ImportRunFailureReason,
	ImportRunStatus,
} from "@ryot-app/contract/modules/imports/schemas";

export const integrationHealthExcludedFailureCodes = [
	"integration-disabled",
	"integration-not-found",
	"integrations-disabled",
	"pro-key-required",
	"queue-unavailable",
] satisfies ImportRunFailureReason["code"][];

export const isIntegrationSourceFailure = (run: {
	readonly status: ImportRunStatus;
	readonly failureReason: ImportRunFailureReason | null;
}) =>
	run.status === "failed" &&
	!integrationHealthExcludedFailureCodes.some((code) => code === run.failureReason?.code);
