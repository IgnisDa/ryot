import type { Message } from "@ryot-app/i18n/message";
import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";

import { RunProgressBar } from "#/modules/ui/run/run-progress-bar";
import { determinateRunProgress, isTerminalRunStatus } from "#/modules/ui/run/run-status";

import {
	importRunFailureNotice,
	ingestionActivityProgressValue,
	ingestionBlockReasonMessage,
} from "./run-presentation";

const outcomes = ["created", "updated", "unchanged", "skipped", "unsuccessful"] as const;

export function IngestionRunTechnicalDetails(props: { readonly run: ImportRunSummary }) {
	const t = useT();
	const formatters = useFormatters();
	const { activities, failureReason } = props.run;
	if (activities.length === 0 && failureReason === null) {
		return null;
	}
	const dateTime = formatters.dateTime({ timeStyle: "short", dateStyle: "medium" });
	return (
		<details className="rounded-xl border border-border px-4 text-sm">
			<summary className="cursor-pointer py-3 font-medium text-text">
				{t(kernelMessage("client.imports.report.technical-details"))}
			</summary>
			<div className="grid gap-3 pb-4 text-text-muted">
				{failureReason === null ? null : (
					<p className="break-all font-mono text-xs">{failureReason.code}</p>
				)}
				<ol className="grid gap-3">
					{activities.map((activity) => (
						<li key={activity.id} className="grid gap-1 border-t border-border pt-3">
							<p className="font-medium text-text">
								{t(
									kernelMessage("client.imports.report.activity", {
										kind: activity.kind,
										state: activity.state,
									}),
								)}
							</p>
							<p>{ingestionActivityProgressValue(t, activity).text}</p>
							<time className="text-xs" dateTime={activity.lastAdvancedAt}>
								{t(
									kernelMessage("client.imports.report.last-advancement", {
										time: dateTime.format(new Date(activity.lastAdvancedAt)),
									}),
								)}
							</time>
							{activity.wait === null ? null : (
								<p className="text-xs">
									{t(
										activity.wait.key === null
											? kernelMessage("client.imports.report.waiting", { code: activity.wait.code })
											: kernelMessage("client.imports.report.waiting-with-key", {
													key: activity.wait.key,
													code: activity.wait.code,
												}),
									)}
								</p>
							)}
						</li>
					))}
				</ol>
			</div>
		</details>
	);
}

export function IngestionRunReport(props: {
	readonly hasIssues?: boolean;
	readonly run: ImportRunSummary;
	readonly failureDetail?: Message | undefined;
}) {
	const t = useT();
	const formatters = useFormatters();
	const { run } = props;
	const { status } = run;
	const terminal = isTerminalRunStatus(status);
	const completedWithIssues =
		status === "completed" &&
		(props.hasIssues === true || run.summary.some(({ counts }) => counts.unsuccessful > 0));
	const activity =
		status === "running"
			? run.activities.reduce<undefined | ImportRunSummary["activities"][number]>(
					(latest, item) => {
						if (item.state !== "running" && item.state !== "waiting") {
							return latest;
						}
						if (!latest || (item.state === "running" && latest.state === "waiting")) {
							return item;
						}
						return item.state === latest.state && item.lastAdvancedAt > latest.lastAdvancedAt
							? item
							: latest;
					},
					undefined,
				)
			: undefined;
	const working = activity?.state === "running";
	const progress = activity === undefined ? undefined : ingestionActivityProgressValue(t, activity);
	const total = activity?.exactTotal ?? 0;
	const showBar = working && total > 0 && progress !== undefined;
	const statusMessage = completedWithIssues
		? kernelMessage("client.imports.report.completed-with-issues")
		: kernelMessage("client.ui.run.status", { status });
	let title = statusMessage;
	if (status === "blocked") {
		title = kernelMessage("client.imports.waiting-for-setup");
	} else if (activity?.state === "running") {
		title = kernelMessage("client.imports.report.current-step", { kind: activity.kind });
	} else if (activity?.state === "waiting") {
		title = kernelMessage("client.imports.report.activity", {
			kind: activity.kind,
			state: activity.state,
		});
	}
	const notice = status === "failed" ? importRunFailureNotice(run.failureReason) : undefined;
	const failed = status === "failed";
	const showSpinner = status === "running" && activity?.state !== "waiting" && !showBar;
	const saved = run.summary.some(({ counts }) => counts.created > 0 || counts.updated > 0);
	const results = run.summary.filter(({ counts }) =>
		outcomes.some((outcome) => counts[outcome] > 0),
	);
	const dateTime = formatters.dateTime({ timeStyle: "short", dateStyle: "medium" });
	return (
		<section className="grid gap-4 rounded-2xl border border-border bg-surface p-4 sm:p-5">
			<div role="status" className="grid gap-2">
				<h2 className="flex items-center gap-2 text-base font-semibold text-text">
					{(failed || completedWithIssues) && (
						<AppIcon
							size={18}
							name="circle-alert"
							className={failed ? "shrink-0 text-danger" : "shrink-0 text-warning"}
						/>
					)}
					{status === "completed" && !completedWithIssues && (
						<AppIcon size={18} name="circle-check" className="shrink-0 text-success" />
					)}
					{showSpinner && (
						<span
							aria-hidden="true"
							className="size-4 shrink-0 animate-spin rounded-full border-2 border-accent border-e-transparent motion-reduce:animate-none"
						/>
					)}
					{t(title)}
				</h2>
				{notice ? (
					<div className="grid gap-1">
						<p className="text-sm font-medium text-text">
							{t(props.failureDetail ?? notice.label)}
						</p>
						{props.failureDetail === undefined ? (
							<p className="text-sm text-text-muted">{t(notice.detail)}</p>
						) : null}
					</div>
				) : null}
				{status === "blocked" ? (
					<>
						<ul className="grid gap-1 text-sm text-text">
							{run.blockReasons.map((reason) => (
								<li key={`${reason.code}:${reason.key}`}>
									{t(ingestionBlockReasonMessage(reason))}
								</li>
							))}
						</ul>
						<p className="text-sm text-text-muted">
							{t(kernelMessage("client.imports.report.resumes"))}
						</p>
						{run.blockDeadline === null ? null : (
							<time dateTime={run.blockDeadline} className="text-xs text-text-muted">
								{t(
									kernelMessage("client.imports.report.deadline", {
										deadline: dateTime.format(new Date(run.blockDeadline)),
									}),
								)}
							</time>
						)}
					</>
				) : null}
				{status === "expired" ? (
					<p className="text-sm text-text-muted">
						{t(kernelMessage("client.imports.report.expired"))}
					</p>
				) : null}
				{progress === undefined ? null : (
					<p className="text-sm tabular-nums text-text-muted">{progress.text}</p>
				)}
				{showBar ? (
					<RunProgressBar
						label={t(title)}
						value={progress}
						progress={determinateRunProgress(formatters, (activity.completed / total) * 100)}
					/>
				) : null}
			</div>
			{terminal && !saved ? (
				<p className="text-sm text-text-muted">
					{t(kernelMessage("client.imports.report.nothing-saved"))}
				</p>
			) : null}
			{results.length === 0 ? null : (
				<dl className="grid gap-3 border-t border-border pt-4">
					{results.map(({ unit, counts, recordKind }) => (
						<div key={`${recordKind}:${unit}`} className="flex flex-col gap-1">
							<dt className="text-xs font-medium text-text-muted">{unit}</dt>
							<dd className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums text-text">
								{outcomes
									.filter((outcome) => counts[outcome] > 0)
									.map((outcome) => (
										<span
											key={outcome}
											className={outcome === "unsuccessful" ? "text-danger" : undefined}
										>
											{t(
												kernelMessage("client.imports.report.outcome", {
													outcome,
													count: counts[outcome],
												}),
											)}
										</span>
									))}
							</dd>
						</div>
					))}
				</dl>
			)}
		</section>
	);
}
