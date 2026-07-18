import type { RunStatus } from "@ryot/contract/schema/run-status";
import type { ImportRunSummary } from "@ryot/ryotql-recipes/import-runs";

import {
	formatRunCount,
	isTerminalRunStatus,
	type RunProgress,
	type RunProgressValue,
} from "@/modules/ui/run/run-status";

type RunCounts = Pick<
	ImportRunSummary,
	"totalItems" | "failedItems" | "importedItems" | "processedItems"
>;

type ImportRunFailureNotice = {
	readonly label: string;
	readonly detail: string;
};

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

export const importRunFailureNotice = (errorSummary: string | null): ImportRunFailureNotice => {
	const summary = (errorSummary ?? "").toLowerCase();
	if (/timed ?out|timeout|deadline/.test(summary)) {
		return {
			label: "Ran out of time",
			detail: "This import ran out of time before it finished. Nothing further was added.",
		};
	}
	if (/unauthor|forbidden|credential|token|api key|permission/.test(summary)) {
		return {
			label: "Access refused",
			detail:
				"The source refused access. Check this plugin's configuration on your server, then start the import again.",
		};
	}
	if (/network|connect|unreachable|dns|socket|refused/.test(summary)) {
		return {
			label: "Source unreachable",
			detail:
				"Your server could not reach the source. Check the connection, then start the import again.",
		};
	}
	if (/parse|invalid|malformed|decode|schema|format|column|header/.test(summary)) {
		return {
			label: "File unreadable",
			detail:
				"The uploaded file was not in the shape this source expects. Export it again and retry.",
		};
	}
	if (/not found|missing|no such|absent|empty/.test(summary)) {
		return {
			label: "Nothing to read",
			detail: "There was nothing to read for this import, so nothing was added.",
		};
	}
	return {
		label: "Stopped early",
		detail: "This import stopped before it finished. Nothing further was added.",
	};
};

export const importRunOutcomeLabel = (
	run: RunCounts & Pick<ImportRunSummary, "status" | "errorSummary">,
) => {
	if (run.status === "failed") {
		return importRunFailureNotice(run.errorSummary).label;
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
