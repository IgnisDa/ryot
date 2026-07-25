import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { RunStatus } from "@ryot-app/contract/schema/run-status";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";
import { DateTime, Match } from "effect";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const STOPPED_EARLY = "Stopped early";

export type RunStatusTone = "info" | "muted" | "danger" | "success";

type RunCounts = Pick<ImportRunSummary, "failedItems" | "importedItems">;

const instant = (value: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(value));

const formatDateLabel = (value: string) =>
	DateTime.formatLocal(DateTime.makeUnsafe(value), {
		day: "numeric",
		month: "short",
		year: "numeric",
		locale: "en-US",
	});

const formatRunCount = (value: number) => Math.max(Math.round(value), 0).toLocaleString("en-US");

export const isTerminalRunStatus = (status: RunStatus) =>
	status === "completed" || status === "failed";

export const runStatusPill = (status: RunStatus) =>
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

export const formatRelativeTime = (value: string, nowMs: number) => {
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
	return days < 7 ? `${days} days ago` : formatDateLabel(value);
};

const importRunFailureLabel = (reason: ImportRunFailureReason | null) => {
	if (reason === null) {
		return STOPPED_EARLY;
	}
	return Match.value(reason).pipe(
		Match.when({ code: "source-fetch-failed" }, () => "Source unavailable"),
		Match.when({ code: "input-transformation-failed" }, () => "Data unreadable"),
		Match.when({ code: "provider-resolution-failed" }, () => STOPPED_EARLY),
		Match.when({ code: "provider-details-failed" }, () => STOPPED_EARLY),
		Match.when({ code: "event-policy-failed" }, () => STOPPED_EARLY),
		Match.when({ code: "database-commit-failed" }, () => STOPPED_EARLY),
		Match.when({ code: "integration-not-found" }, () => "Integration unavailable"),
		Match.when({ code: "integration-disabled" }, () => "Integration paused"),
		Match.when({ code: "integrations-disabled" }, () => "Integrations paused"),
		Match.when({ code: "pro-key-required" }, () => "Ryot Pro required"),
		Match.when({ code: "queue-unavailable" }, () => STOPPED_EARLY),
		Match.when({ code: "unexpected-failure" }, () => STOPPED_EARLY),
		Match.exhaustive,
	);
};

export const importRunOutcomeLabel = (
	run: RunCounts & Pick<ImportRunSummary, "status" | "failureReason">,
) => {
	if (run.status === "failed") {
		return importRunFailureLabel(run.failureReason);
	}
	return run.failedItems === 0
		? `${formatRunCount(run.importedItems)} added`
		: `${formatRunCount(run.importedItems)} added · ${formatRunCount(run.failedItems)} failed`;
};
