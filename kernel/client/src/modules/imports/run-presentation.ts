import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { RunStatus } from "@ryot-app/contract/schema/run-status";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";
import { Match } from "effect";

import {
	formatRunCount,
	isTerminalRunStatus,
	type RunProgress,
	type RunProgressValue,
} from "#/modules/ui/run/run-status";

type RunCounts = Pick<
	ImportRunSummary,
	"totalItems" | "failedItems" | "importedItems" | "processedItems"
>;

type ImportRunFailureNotice = {
	readonly label: string;
	readonly detail: string;
};

const stoppedEarly = {
	label: "Stopped early",
	detail: "This import stopped before it finished. Nothing further was added.",
} as const;

export const canDeleteImportRun = (status: RunStatus) =>
	status === "completed" || status === "failed";

export const importRunProgress = (run: RunCounts): RunProgress => {
	if (run.totalItems === null) {
		return { kind: "indeterminate", label: "Preparing" };
	}
	const percent =
		run.totalItems <= 0
			? 100
			: Math.min(Math.max(Math.round((run.processedItems / run.totalItems) * 100), 0), 100);
	return { kind: "determinate", label: `${percent}%`, percent };
};

export const importRunProgressValue = (run: RunCounts): RunProgressValue =>
	run.totalItems === null
		? { text: `${formatRunCount(run.processedItems)} read so far` }
		: {
				min: 0,
				max: run.totalItems,
				now: run.processedItems,
				text: `${formatRunCount(run.processedItems)} of ${formatRunCount(run.totalItems)}`,
			};

export const importRunCountsLabel = (run: RunCounts) => {
	const read =
		run.totalItems === null
			? `${formatRunCount(run.processedItems)} read`
			: `${formatRunCount(run.processedItems)} of ${formatRunCount(run.totalItems)} read`;
	return `${read} · ${formatRunCount(run.importedItems)} added · ${formatRunCount(run.failedItems)} failed`;
};

export const importRunFailureNotice = (
	reason: ImportRunFailureReason | null,
): ImportRunFailureNotice => {
	if (reason === null) {
		return stoppedEarly;
	}
	return Match.value(reason).pipe(
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
		return importRunFailureNotice(run.failureReason).label;
	}
	return run.failedItems === 0
		? `${formatRunCount(run.importedItems)} added`
		: `${formatRunCount(run.importedItems)} added · ${formatRunCount(run.failedItems)} failed`;
};

export const importRunDeleteConfirmation = (run: RunCounts) => {
	const removed =
		run.failedItems === 0
			? "This removes the record of this import."
			: `This removes the record and its list of ${formatRunCount(run.failedItems)} ${run.failedItems === 1 ? "failure" : "failures"}.`;
	const kept =
		run.importedItems === 0
			? "Nothing it added is affected."
			: `The ${formatRunCount(run.importedItems)} ${run.importedItems === 1 ? "item it added stays" : "items it added stay"} in your library.`;
	return `${removed} ${kept}`;
};

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
