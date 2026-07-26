import type { ImportRunStatus } from "@ryot/contract/modules/imports/types";
import type { ImportRunSummary } from "@ryot/ryotql-recipes/import-runs";
import { DateTime, Match } from "effect";

import { formatLocalDateLabel } from "@/modules/ui/date";

type RunCounts = Pick<
	ImportRunSummary,
	"totalItems" | "failedItems" | "importedItems" | "processedItems"
>;

type RunTiming = Pick<ImportRunSummary, "createdAt" | "startedAt" | "finishedAt">;

export type ImportRunStatusTone = "info" | "muted" | "danger" | "success";

export type ImportRunStatusPill = {
	readonly icon: string;
	readonly label: string;
	readonly tone: ImportRunStatusTone;
};

export type ImportRunProgress =
	| { readonly kind: "indeterminate"; readonly label: string }
	| { readonly kind: "determinate"; readonly label: string; readonly percent: number };

export type ImportRunProgressValue = {
	readonly text: string;
	readonly now?: number;
	readonly min?: number;
	readonly max?: number;
};

export type ImportRunFailureNotice = {
	readonly label: string;
	readonly detail: string;
};

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const isTerminalImportRunStatus = (status: ImportRunStatus) =>
	status === "completed" || status === "failed";

export const canDeleteImportRun = (status: ImportRunStatus) =>
	status === "completed" || status === "failed";

export const importRunStatusPill = (status: ImportRunStatus): ImportRunStatusPill =>
	Match.value(status).pipe(
		Match.when("pending", () => ({ icon: "clock", label: "Queued", tone: "muted" }) as const),
		Match.when("running", () => ({ icon: "rotate-ccw", label: "Running", tone: "info" }) as const),
		Match.when(
			"completed",
			() => ({ icon: "circle-check", label: "Completed", tone: "success" }) as const,
		),
		Match.when(
			"failed",
			() => ({ icon: "circle-alert", label: "Failed", tone: "danger" }) as const,
		),
		Match.exhaustive,
	);

export const formatImportCount = (value: number) =>
	Math.max(Math.round(value), 0).toLocaleString("en-US");

export const importRunProgress = (run: RunCounts): ImportRunProgress => {
	if (run.totalItems === null) {
		return { kind: "indeterminate", label: "Preparing" };
	}
	const percent =
		run.totalItems <= 0
			? 100
			: Math.min(Math.max(Math.round((run.processedItems / run.totalItems) * 100), 0), 100);
	return { kind: "determinate", label: `${percent}%`, percent };
};

export const importRunProgressValue = (run: RunCounts): ImportRunProgressValue =>
	run.totalItems === null
		? { text: `${formatImportCount(run.processedItems)} read so far` }
		: {
				min: 0,
				max: run.totalItems,
				now: run.processedItems,
				text: `${formatImportCount(run.processedItems)} of ${formatImportCount(run.totalItems)}`,
			};

export const importRunCountsLabel = (run: RunCounts) => {
	const read =
		run.totalItems === null
			? `${formatImportCount(run.processedItems)} read`
			: `${formatImportCount(run.processedItems)} of ${formatImportCount(run.totalItems)} read`;
	return `${read} · ${formatImportCount(run.importedItems)} added · ${formatImportCount(run.failedItems)} failed`;
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
		? `${formatImportCount(run.importedItems)} added`
		: `${formatImportCount(run.importedItems)} added · ${formatImportCount(run.failedItems)} failed`;
};

export const importRunDeleteConfirmation = (run: RunCounts) => {
	const removed =
		run.failedItems === 0
			? "This removes the record of this import."
			: `This removes the record and its list of ${formatImportCount(run.failedItems)} ${run.failedItems === 1 ? "failure" : "failures"}.`;
	const kept =
		run.importedItems === 0
			? "Nothing it added is affected."
			: `The ${formatImportCount(run.importedItems)} ${run.importedItems === 1 ? "item it added stays" : "items it added stay"} in your library.`;
	return `${removed} ${kept}`;
};

export const formatImportDuration = (milliseconds: number) => {
	const seconds = Math.max(Math.round(milliseconds / 1000), 0);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		const rest = seconds % 60;
		return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
	}
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

const instant = (value: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(value));

export const importRunDurationLabel = (
	run: RunTiming & Pick<ImportRunSummary, "status">,
	nowMs: number,
) => {
	if (run.startedAt === null) {
		return undefined;
	}
	const startedAt = instant(run.startedAt);
	if (run.finishedAt !== null) {
		return formatImportDuration(instant(run.finishedAt) - startedAt);
	}
	return isTerminalImportRunStatus(run.status)
		? undefined
		: formatImportDuration(nowMs - startedAt);
};

export const formatImportRelativeTime = (value: string, nowMs: number) => {
	const elapsed = nowMs - instant(value);
	if (elapsed < 45_000) {
		return "just now";
	}
	if (elapsed < HOUR_MS) {
		const minutes = Math.round(elapsed / MINUTE_MS);
		return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
	}
	if (elapsed < DAY_MS) {
		const hours = Math.round(elapsed / HOUR_MS);
		return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
	}
	const days = Math.floor(elapsed / DAY_MS);
	if (days === 1) {
		return "yesterday";
	}
	return days < 7 ? `${days} days ago` : formatLocalDateLabel(value);
};

export const importRunStartedLabel = (run: RunTiming, nowMs: number) =>
	`Started ${formatImportRelativeTime(run.startedAt ?? run.createdAt, nowMs)}`;

export const importRunTimestampLabel = (value: string) => {
	const stamp = DateTime.makeUnsafe(value);
	const day = DateTime.formatLocal(stamp, {
		day: "numeric",
		month: "short",
		year: "numeric",
		locale: "en-GB",
	});
	const time = DateTime.formatLocal(stamp, {
		hour12: false,
		hour: "2-digit",
		locale: "en-GB",
		minute: "2-digit",
	});
	return `${day}, ${time}`;
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

export const importRunFileNames = (inputSummary: Record<string, unknown>) => {
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
	runs.find((run) => !isTerminalImportRunStatus(run.status));
