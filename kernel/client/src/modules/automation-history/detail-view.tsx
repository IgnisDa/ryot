import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import type { AutomationHistoryRetryResult } from "@ryot-app/contract/modules/automations/history-schemas";
import type { JsonValue } from "@ryot-app/contract/schema/json";

import type { AutomationRunDetail } from "#/modules/automation-history/service";
import { AutomationStatusPill } from "#/modules/automation-history/status";
import { DemoProtectionMessage } from "#/modules/demo-protection";
import { formatRunDuration, runTimestampLabel } from "#/modules/ui/run/run-status";

type AutomationHistoryAttempt = AutomationRunDetail["attempts"][number];

type AutomationHistoryDetailViewProps = {
	readonly detail: AutomationRunDetail;
	readonly isRetrying: boolean;
	readonly retryFailed: boolean;
	readonly retryResult: AutomationHistoryRetryResult | undefined;
	readonly onRetry: () => void;
	readonly isDemoProtected: boolean;
};

type RetryUnavailableReason = Exclude<AutomationRunDetail["retryEligibility"]["reason"], null>;

const unavailableLabels: Record<RetryUnavailableReason, string> = {
	"not-failed": "Only failed runs can be retried.",
	expired: "The retained artifacts for this run have expired.",
	"before-policy": "Before-change policy runs cannot be retried.",
	"missing-artifact": "The exact script or configuration needed for this run is unavailable.",
};

const titleCase = (value: string) =>
	value
		.split("-")
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ");

const json = (value: JsonValue) => JSON.stringify(value, null, 2);

function Definition(props: { readonly label: string; readonly value: string }) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<dt className="text-[11px] font-medium uppercase tracking-[0.7px] text-text-subtle">
				{props.label}
			</dt>
			<dd className="wrap-break-word text-sm text-text">{props.value}</dd>
		</div>
	);
}

function JsonBlock(props: { readonly value: JsonValue }) {
	return (
		<pre className="overflow-x-auto whitespace-pre-wrap wrap-break-word rounded-lg bg-surface-2 p-3 font-mono text-xs leading-5 text-text-muted">
			{json(props.value)}
		</pre>
	);
}

function AttemptLogs(props: { readonly attempt: AutomationHistoryAttempt }) {
	const { attempt } = props;
	if (attempt.logs === null) {
		return (
			<p className="text-sm text-text-muted">
				{attempt.artifactsPrunedAt === null
					? "No retained logs."
					: `Diagnostics were pruned ${runTimestampLabel(attempt.artifactsPrunedAt)}.`}
			</p>
		);
	}
	if (attempt.logs.length === 0) {
		return <p className="text-sm text-text-muted">No logs were recorded.</p>;
	}
	return (
		<ol className="flex flex-col gap-2">
			{attempt.logs.map((entry, index) => (
				// oxlint-disable-next-line react/no-array-index-key -- retained log entries carry no identity and the list is immutable
				<li key={`${entry.level}-${index}`} className="rounded-lg bg-surface-2 p-3">
					<div className="flex items-start gap-3">
						<span className="w-14 shrink-0 font-mono text-[11px] uppercase text-text-subtle">
							{entry.level}
						</span>
						<span className="min-w-0 whitespace-pre-wrap wrap-break-word text-sm text-text">
							{entry.message}
						</span>
					</div>
					{entry.attributes === undefined ? null : (
						<div className="mt-2">
							<JsonBlock value={entry.attributes} />
						</div>
					)}
				</li>
			))}
		</ol>
	);
}

function TriggerPayload(props: { readonly trigger: AutomationRunDetail["trigger"] }) {
	const { trigger } = props;
	if (trigger.payload !== null) {
		return <JsonBlock value={trigger.payload} />;
	}
	if (trigger.payloadTruncated) {
		return (
			<p className="text-sm text-text-muted">
				The redacted payload exceeded the retained display limit.
			</p>
		);
	}
	return (
		<p className="text-sm text-text-muted">
			{trigger.payloadPrunedAt === null
				? "No retained payload."
				: `The payload was pruned ${runTimestampLabel(trigger.payloadPrunedAt)}.`}
		</p>
	);
}

function AttemptCard(props: { readonly attempt: AutomationHistoryAttempt }) {
	const { attempt } = props;
	const duration = attempt.timing === null ? undefined : formatRunDuration(attempt.timing.totalMs);
	return (
		<article className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
			<div className="flex flex-wrap items-center gap-2">
				<h3 className="mr-auto text-sm font-semibold text-text">Attempt {attempt.attemptNumber}</h3>
				{duration === undefined ? null : (
					<span className="text-xs tabular-nums text-text-subtle">{duration}</span>
				)}
				<AutomationStatusPill status={attempt.status} />
			</div>
			<p className="text-xs text-text-subtle">Started {runTimestampLabel(attempt.startedAt)}</p>
			{attempt.error === null ? null : (
				<section
					className="flex flex-col gap-2"
					aria-label={`Attempt ${attempt.attemptNumber} error`}
				>
					<h4 className="text-xs font-semibold uppercase tracking-[0.7px] text-danger">Error</h4>
					<div className="rounded-lg border border-danger bg-surface-2 p-3">
						<p className="font-mono text-xs text-danger">{attempt.error.code}</p>
						<p className="mt-1 whitespace-pre-wrap wrap-break-word text-sm text-text">
							{attempt.error.message}
						</p>
					</div>
				</section>
			)}
			<section className="flex flex-col gap-2" aria-label={`Attempt ${attempt.attemptNumber} logs`}>
				<h4 className="text-xs font-semibold uppercase tracking-[0.7px] text-text-subtle">Logs</h4>
				<AttemptLogs attempt={attempt} />
				{attempt.artifactsTruncated ? (
					<p className="text-xs text-text-subtle">Some diagnostics exceeded the retained limit.</p>
				) : null}
			</section>
		</article>
	);
}

export function AutomationHistoryDetailView(props: AutomationHistoryDetailViewProps) {
	const { run, trigger } = props.detail;
	const unavailable = props.detail.retryEligibility.reason;
	return (
		<div className="flex flex-col gap-6 pb-4">
			<section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
				<div className="flex flex-wrap items-center gap-2">
					<AutomationStatusPill status={run.status} />
					<span className="text-xs text-text-subtle">
						{run.attemptCount} {run.attemptCount === 1 ? "attempt" : "attempts"}
					</span>
				</div>
				<dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<Definition label="Hook" value={`${run.hookName} (${run.hookSlug})`} />
					<Definition
						label="Source"
						value={
							run.pluginName === null
								? "Kernel"
								: `${run.pluginName} (${run.pluginId ?? "unknown plugin"})`
						}
					/>
					<Definition label="Queued" value={runTimestampLabel(run.queuedAt)} />
					<Definition
						label="Delivery"
						value={`${titleCase(run.stage)} · ${titleCase(run.delivery)}`}
					/>
					<Definition
						label="Trigger"
						value={`${titleCase(trigger.kind.category)} · ${titleCase(trigger.kind.operation)} ${titleCase(trigger.kind.resource)}`}
					/>
					<Definition label="Artifacts expire" value={runTimestampLabel(run.artifactsExpireAt)} />
				</dl>
				{unavailable === null ? (
					<>
						{props.isDemoProtected ? <DemoProtectionMessage /> : null}
						<Button
							type="button"
							variant="primary"
							onClick={props.onRetry}
							className="w-full sm:w-auto sm:self-start sm:px-6"
							disabled={props.isDemoProtected || props.isRetrying}
						>
							{props.isRetrying ? "Retrying..." : "Retry run"}
						</Button>
					</>
				) : (
					<p className="text-sm text-text-muted">{unavailableLabels[unavailable]}</p>
				)}
				{props.retryFailed ? (
					<StatusMessage tone="error" className="text-sm">
						This run could not be retried. Its latest state has been refreshed.
					</StatusMessage>
				) : null}
				{props.retryResult === undefined ? null : (
					<StatusMessage tone="success" className="text-sm">
						Retry queued as attempt {props.retryResult.attemptNumber}. Dispatch is{" "}
						{props.retryResult.dispatch}.
					</StatusMessage>
				)}
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="font-display text-xl font-semibold text-text">Trigger data</h2>
				<p className="text-xs text-text-subtle">Occurred {runTimestampLabel(trigger.occurredAt)}</p>
				<TriggerPayload trigger={trigger} />
			</section>

			<section className="flex flex-col gap-3">
				<div className="flex items-baseline justify-between gap-3">
					<h2 className="font-display text-xl font-semibold text-text">Attempts</h2>
					{props.detail.attemptsTruncated ? (
						<span className="text-xs text-text-subtle">Showing latest retained attempts</span>
					) : null}
				</div>
				{props.detail.attempts.length === 0 ? (
					<p className="text-sm text-text-muted">No attempts have been recorded yet.</p>
				) : (
					<div className="flex flex-col gap-3">
						{props.detail.attempts.map((attempt) => (
							<AttemptCard key={attempt.id} attempt={attempt} />
						))}
					</div>
				)}
			</section>
		</div>
	);
}
