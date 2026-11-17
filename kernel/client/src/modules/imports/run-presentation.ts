import type {
	IngestionActivity,
	IngestionBlockReason,
	IngestionSummary,
} from "@ryot-app/contract/modules/imports/ingestion";
import type {
	ImportRunFailureReason,
	ImportRunStatus,
} from "@ryot-app/contract/modules/imports/schemas";
import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import type { Formatters } from "@ryot-app/i18n/formatters";
import type { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { entitlementRequiredMessage } from "@ryot-app/plugin-ui-sdk";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";
import { Match } from "effect";

import {
	determinateRunProgress,
	isTerminalRunStatus,
	type RunProgress,
	type RunProgressValue,
} from "#/modules/ui/run/run-status";

type Translate = (message: Message) => Text;

type RunCounts = Pick<ImportRunSummary, "summary">;

type ImportRunFailureNotice = { readonly label: Message; readonly detail: Message };

const stoppedEarly = {
	label: kernelMessage("client.imports.failure.stopped-early.label"),
	detail: kernelMessage("client.imports.failure.stopped-early.detail"),
} as const;

export const canDeleteImportRun = (status: ImportRunStatus) =>
	status === "completed" || status === "failed" || status === "cancelled" || status === "expired";

export const canCancelImportRun = (status: ImportRunStatus) =>
	status === "pending" || status === "blocked" || status === "running";

export const importRunCancelConfirmation = (phrase: string) =>
	kernelMessage("client.imports.cancel-confirmation", { phrase });

const wholeCount = (value: number) => Math.max(Math.round(value), 0);

export const ingestionActivityProgress = (
	t: Translate,
	formatters: Formatters,
	activity: IngestionActivity,
): RunProgress => {
	if (activity.exactTotal === null) {
		return {
			kind: "indeterminate",
			label: t(
				kernelMessage("client.imports.activity.count", {
					unit: activity.unit,
					count: wholeCount(activity.completed),
				}),
			),
		};
	}
	return determinateRunProgress(
		formatters,
		activity.exactTotal <= 0 ? 100 : (activity.completed / activity.exactTotal) * 100,
	);
};

export const ingestionActivityProgressValue = (
	t: Translate,
	activity: IngestionActivity,
): RunProgressValue =>
	activity.exactTotal === null
		? {
				text: t(
					kernelMessage("client.imports.activity.count", {
						unit: activity.unit,
						count: wholeCount(activity.completed),
					}),
				),
			}
		: {
				min: 0,
				now: activity.completed,
				max: activity.exactTotal,
				text: t(
					kernelMessage("client.imports.activity.of-total", {
						unit: activity.unit,
						total: wholeCount(activity.exactTotal),
						completed: wholeCount(activity.completed),
					}),
				),
			};

export const ingestionSummaryLabel = (
	t: Translate,
	formatters: Formatters,
	summary: IngestionSummary,
) =>
	formatters
		.list({ type: "unit", style: "long" })
		.format(
			summary.map(({ unit, counts }) =>
				t(
					kernelMessage("client.imports.summary-unit", {
						unit,
						created: wholeCount(counts.created),
						updated: wholeCount(counts.updated),
						skipped: wholeCount(counts.skipped),
						unchanged: wholeCount(counts.unchanged),
						unsuccessful: wholeCount(counts.unsuccessful),
					}),
				),
			),
		);

export const importRunCountsLabel = (
	t: Translate,
	formatters: Formatters,
	run: RunCounts & Pick<ImportRunSummary, "status">,
) => {
	if (run.summary.length > 0) {
		return ingestionSummaryLabel(t, formatters, run.summary);
	}
	return t(
		kernelMessage(
			isTerminalRunStatus(run.status)
				? "client.imports.no-outcomes"
				: "client.imports.no-outcomes-yet",
		),
	);
};

export const ingestionBlockReasonMessage = (
	reason: IngestionBlockReason,
	scope?: null | "user" | "system",
): Message => {
	if (reason.code === "connection-required") {
		return kernelMessage("client.imports.block.connection-required", { key: reason.key });
	}
	let location: "source" | "server" | "installation" = "source";
	if (scope === "user") {
		location = "installation";
	} else if (scope === "system") {
		location = "server";
	}
	return kernelMessage(
		reason.code === "oauth-client-required"
			? "client.imports.block.oauth-client-required"
			: "client.imports.block.setting-required",
		{ location, key: reason.key },
	);
};

/** The first block reason and how many more remain, or `fallback` when none are known. */
export const ingestionBlockReasonsMessage = (
	reasons: readonly IngestionBlockReason[],
	fallback: Message,
	scope?: null | "user" | "system",
): Message => {
	const first = reasons.at(0);
	return first === undefined
		? fallback
		: kernelMessage("client.imports.block.reasons", {
				remaining: reasons.length - 1,
				first: ingestionBlockReasonMessage(first, scope),
			});
};

export const importRunFailureNotice = (
	reason: null | ImportRunFailureReason,
): ImportRunFailureNotice => {
	if (reason === null) {
		return stoppedEarly;
	}
	return Match.value(reason).pipe(
		Match.when({ code: "captured-input-unavailable" }, () => ({
			label: kernelMessage("client.imports.failure.captured-input-unavailable.label"),
			detail: kernelMessage("client.imports.failure.captured-input-unavailable.detail"),
		})),
		Match.when({ code: "captured-input-corrupt" }, () => ({
			label: kernelMessage("client.imports.failure.captured-input-corrupt.label"),
			detail: kernelMessage("client.imports.failure.captured-input-corrupt.detail"),
		})),
		Match.when({ code: "source-fetch-failed" }, () => ({
			label: kernelMessage("client.imports.failure.source-fetch-failed.label"),
			detail: kernelMessage("client.imports.failure.source-fetch-failed.detail"),
		})),
		Match.when({ code: "input-transformation-failed" }, () => ({
			label: kernelMessage("client.imports.failure.input-transformation-failed.label"),
			detail: kernelMessage("client.imports.failure.input-transformation-failed.detail"),
		})),
		Match.when({ code: "provider-resolution-failed" }, () => stoppedEarly),
		Match.when({ code: "provider-details-failed" }, () => stoppedEarly),
		Match.when({ code: "event-policy-failed" }, () => stoppedEarly),
		Match.when({ code: "database-commit-failed" }, () => stoppedEarly),
		Match.when({ code: "integration-not-found" }, () => ({
			label: kernelMessage("client.imports.failure.integration-not-found.label"),
			detail: kernelMessage("client.imports.failure.integration-not-found.detail"),
		})),
		Match.when({ code: "integration-disabled" }, () => ({
			label: kernelMessage("client.imports.failure.integration-disabled.label"),
			detail: kernelMessage("client.imports.failure.integration-disabled.detail"),
		})),
		Match.when({ code: "integrations-disabled" }, () => ({
			label: kernelMessage("client.imports.failure.integrations-disabled.label"),
			detail: kernelMessage("client.imports.failure.integrations-disabled.detail"),
		})),
		Match.when({ code: "entitlement-required" }, ({ entitlement }) => ({
			detail: entitlementRequiredMessage(entitlement),
			label: kernelMessage("ui.entitlement.required-title", { entitlement }),
		})),
		Match.when({ code: "queue-unavailable" }, () => stoppedEarly),
		Match.when({ code: "installation-unavailable" }, () => ({
			label: kernelMessage("client.pages.host.unavailable-title"),
			detail: kernelMessage("client.imports.failure.installation-unavailable.detail"),
		})),
		Match.when({ code: "package-identity-conflict" }, () => ({
			label: kernelMessage("client.imports.failure.package-identity-conflict.label"),
			detail: kernelMessage("client.imports.failure.package-identity-conflict.detail"),
		})),
		Match.when({ code: "unexpected-failure" }, () => stoppedEarly),
		Match.exhaustive,
	);
};

export const importRunOutcomeLabel = (
	t: Translate,
	formatters: Formatters,
	run: RunCounts & Pick<ImportRunSummary, "status" | "failureReason">,
) => {
	if (run.status === "failed") {
		return t(
			kernelMessage("client.imports.outcome.failed", {
				counts: importRunCountsLabel(t, formatters, run),
				label: importRunFailureNotice(run.failureReason).label,
			}),
		);
	}
	if (run.status === "cancelled") {
		return t(
			kernelMessage("client.imports.outcome.cancelled", {
				counts: importRunCountsLabel(t, formatters, run),
			}),
		);
	}
	if (run.status === "blocked") {
		return t(kernelMessage("client.imports.waiting-for-setup"));
	}
	if (run.status === "expired") {
		return t(kernelMessage("client.imports.outcome.setup-expired"));
	}
	return importRunCountsLabel(t, formatters, run);
};

export const importRunDeleteConfirmation = () =>
	kernelMessage("client.imports.delete-confirmation");

export const importRunSourceKey = (installationId: null | string, slug: string) =>
	identityTupleKey(installationId, slug);

/** The run's served source name, or a neutral fallback once the source is gone. */
export const importSourceName = (
	t: Translate,
	run: Pick<ImportRunSummary, "source" | "pluginInstallationId">,
	names: ReadonlyMap<string, Text>,
) =>
	names.get(importRunSourceKey(run.pluginInstallationId, run.source)) ??
	t(kernelMessage("client.imports.unknown-source"));

const importRunFileNames = (inputSummary: Record<string, unknown>) => {
	const names = inputSummary["fileNames"];
	return Array.isArray(names)
		? names.filter((name): name is string => typeof name === "string")
		: [];
};

export const importRunProvenanceLabel = (
	t: Translate,
	formatters: Formatters,
	inputSummary: Record<string, unknown>,
) => {
	const names = importRunFileNames(inputSummary);
	return names.length === 0
		? undefined
		: t(
				kernelMessage("client.imports.provenance", {
					files: formatters.list({ type: "unit", style: "long" }).format(names),
				}),
			);
};

export const liveImportRun = <Run extends Pick<ImportRunSummary, "status">>(runs: readonly Run[]) =>
	runs.find((run) => !isTerminalRunStatus(run.status));
