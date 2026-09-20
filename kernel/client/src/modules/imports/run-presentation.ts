import type {
	IngestionActivity,
	IngestionBlockReason,
	IngestionSummary,
} from "@ryot-app/contract/modules/imports/ingestion";
import type {
	ImportRunFailureReason,
	ImportRunStatus,
} from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";
import { Match } from "effect";

import {
	formatRunCount,
	isTerminalRunStatus,
	type RunProgress,
	type RunProgressValue,
} from "#/modules/ui/run/run-status";

type RunCounts = Pick<ImportRunSummary, "summary">;

type ImportRunFailureNotice = { readonly label: string; readonly detail: string };

const stoppedEarly = {
	label: "Stopped early",
	detail: "This import stopped before it finished. Nothing further was added.",
} as const;

export const canDeleteImportRun = (status: ImportRunStatus) =>
	status === "completed" || status === "failed" || status === "cancelled" || status === "expired";

export const canCancelImportRun = (status: ImportRunStatus) =>
	status === "pending" || status === "blocked" || status === "running";

export const importRunCancelConfirmation =
	'This stops future work. Items already added stay in your library. Type "Cancel this import" to continue.';

export const ingestionActivityProgress = (activity: IngestionActivity): RunProgress => {
	if (activity.exactTotal === null) {
		return {
			kind: "indeterminate",
			label: `${formatRunCount(activity.completed)} ${activity.unit}`,
		};
	}
	const percent =
		activity.exactTotal <= 0
			? 100
			: Math.min(Math.max(Math.round((activity.completed / activity.exactTotal) * 100), 0), 100);
	return { percent, kind: "determinate", label: `${percent}%` };
};

export const ingestionActivityProgressValue = (activity: IngestionActivity): RunProgressValue =>
	activity.exactTotal === null
		? { text: `${formatRunCount(activity.completed)} ${activity.unit}` }
		: {
				min: 0,
				now: activity.completed,
				max: activity.exactTotal,
				text: `${formatRunCount(activity.completed)} of ${formatRunCount(activity.exactTotal)} ${activity.unit}`,
			};

export const ingestionSummaryLabel = (summary: IngestionSummary) =>
	summary
		.map(
			({ unit, counts }) =>
				`${unit}: ${(["created", "updated", "unchanged", "skipped", "unsuccessful"] as const)
					.map((result) => `${formatRunCount(counts[result])} ${result}`)
					.join(" · ")}`,
		)
		.join("; ");

export const importRunCountsLabel = (run: RunCounts & Pick<ImportRunSummary, "status">) => {
	if (run.summary.length > 0) {
		return ingestionSummaryLabel(run.summary);
	}
	return isTerminalRunStatus(run.status) ? "No outcomes recorded" : "No committed outcomes yet";
};

export const ingestionBlockReasonLabel = (
	reason: IngestionBlockReason,
	scope?: "system" | "user" | null,
) => {
	if (reason.code === "connection-required") {
		return `Connect ${reason.key} for this account.`;
	}
	let location = "for this source";
	if (scope === "user") {
		location = "in this plugin installation";
	} else if (scope === "system") {
		location = "on your server";
	}
	return reason.code === "oauth-client-required"
		? `Configure the OAuth client ${reason.key} ${location}.`
		: `Set ${reason.key} ${location}.`;
};

export const importRunFailureNotice = (
	reason: ImportRunFailureReason | null,
): ImportRunFailureNotice => {
	if (reason === null) {
		return stoppedEarly;
	}
	return Match.value(reason).pipe(
		Match.when({ code: "captured-input-unavailable" }, () => ({
			label: "Captured input unavailable",
			detail: "The saved source input is missing. Start a new import with the source data.",
		})),
		Match.when({ code: "captured-input-corrupt" }, () => ({
			label: "Captured input damaged",
			detail:
				"The saved source input could not be verified. Start a new import with the source data.",
		})),
		Match.when({ code: "source-fetch-failed" }, () => ({
			label: "Source unavailable",
			detail: "The source could not be read. Check its availability, then start the import again.",
		})),
		Match.when({ code: "input-transformation-failed" }, () => ({
			label: "Data unreadable",
			detail: "Some source data was not in the expected shape. Correct it, then try again.",
		})),
		Match.when({ code: "provider-resolution-failed" }, () => stoppedEarly),
		Match.when({ code: "provider-details-failed" }, () => stoppedEarly),
		Match.when({ code: "event-policy-failed" }, () => stoppedEarly),
		Match.when({ code: "database-commit-failed" }, () => stoppedEarly),
		Match.when({ code: "integration-not-found" }, () => ({
			label: "Integration unavailable",
			detail: "The connected service no longer exists, so this import could not continue.",
		})),
		Match.when({ code: "integration-disabled" }, () => ({
			label: "Integration paused",
			detail: "This connected service is paused. Enable it before trying again.",
		})),
		Match.when({ code: "integrations-disabled" }, () => ({
			label: "Integrations paused",
			detail: "Integrations are disabled for this account.",
		})),
		Match.when({ code: "pro-key-required" }, () => ({
			label: "Ryot Pro required",
			detail: "This integration needs Ryot Pro. Add a valid Pro key, then start the import again.",
		})),
		Match.when({ code: "queue-unavailable" }, () => stoppedEarly),
		Match.when({ code: "unexpected-failure" }, () => stoppedEarly),
		Match.exhaustive,
	);
};

export const importRunOutcomeLabel = (
	run: RunCounts & Pick<ImportRunSummary, "status" | "failureReason">,
) => {
	if (run.status === "failed") {
		return `${importRunFailureNotice(run.failureReason).label} · ${importRunCountsLabel(run)}`;
	}
	if (run.status === "cancelled") {
		return `Cancelled · ${importRunCountsLabel(run)}`;
	}
	if (run.status === "blocked") {
		return "Waiting for setup";
	}
	if (run.status === "expired") {
		return "Setup deadline expired";
	}
	return importRunCountsLabel(run);
};

export const importRunDeleteConfirmation = () =>
	"This removes the run report and its diagnostics. All committed changes remain in your library.";

export const humanizeImportSourceSlug = (slug: string) => {
	const words = slug
		.split(/[^A-Za-z0-9]+/)
		.filter((word) => word.length > 0)
		.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`);
	return words.length === 0 ? slug : words.join(" ");
};

export const importSourceName = (slug: string, names: ReadonlyMap<string, string>) =>
	names.get(slug) ?? humanizeImportSourceSlug(slug);

const importRunFileNames = (inputSummary: Record<string, unknown>) => {
	const names = inputSummary["fileNames"];
	return Array.isArray(names)
		? names.filter((name): name is string => typeof name === "string")
		: [];
};

export const importRunProvenanceLabel = (inputSummary: Record<string, unknown>) => {
	const names = importRunFileNames(inputSummary);
	return names.length === 0 ? undefined : `From ${names.join(", ")}`;
};

export const liveImportRun = <Run extends Pick<ImportRunSummary, "status">>(runs: readonly Run[]) =>
	runs.find((run) => !isTerminalRunStatus(run.status));
