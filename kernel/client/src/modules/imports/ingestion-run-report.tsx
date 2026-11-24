import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";

import { RunProgressBar } from "#/modules/ui/run/run-progress-bar";

import {
	importRunCountsLabel,
	importRunFailureNotice,
	ingestionActivityProgress,
	ingestionActivityProgressValue,
	ingestionBlockReasonMessage,
} from "./run-presentation";

export function IngestionRunReport(props: { readonly run: ImportRunSummary }) {
	const t = useT();
	const formatters = useFormatters();
	const run = props.run;
	const notice = run.status === "failed" ? importRunFailureNotice(run.failureReason) : undefined;
	const dateTime = formatters.dateTime({ timeStyle: "short", dateStyle: "medium" });
	return (
		<div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4">
			{notice === undefined ? null : (
				<div className="flex gap-3">
					<AppIcon size={18} name="circle-alert" className="shrink-0 text-danger" />
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="text-sm font-medium text-danger">{t(notice.label)}</span>
						<span className="text-sm leading-5 text-text-muted">{t(notice.detail)}</span>
					</div>
				</div>
			)}
			{run.status === "blocked" ? (
				<div role="status">
					<p className="text-sm font-medium text-text">
						{t(kernelMessage("client.imports.waiting-for-setup"))}
					</p>
					<ul className="text-sm text-text-muted">
						{run.blockReasons.map((reason) => (
							<li key={`${reason.code}:${reason.key}`}>{t(ingestionBlockReasonMessage(reason))}</li>
						))}
					</ul>
					<p className="text-xs text-text-muted">
						{t(kernelMessage("client.imports.report.resumes"))}{" "}
						{run.blockDeadline === null ? null : (
							<time dateTime={run.blockDeadline}>
								{t(
									kernelMessage("client.imports.report.deadline", {
										deadline: dateTime.format(new Date(run.blockDeadline)),
									}),
								)}
							</time>
						)}
					</p>
				</div>
			) : null}
			{run.status === "expired" ? (
				<p role="status" className="text-sm text-text-muted">
					{t(kernelMessage("client.imports.report.expired"))}
				</p>
			) : null}
			{run.activities.map((activity) => {
				const label = t(
					kernelMessage("client.imports.report.activity", {
						kind: activity.kind,
						state: activity.state,
					}),
				);
				return (
					<div key={activity.id} className="flex flex-col gap-2">
						<p className="text-sm font-medium text-text">{label}</p>
						<RunProgressBar
							label={label}
							value={ingestionActivityProgressValue(t, activity)}
							progress={ingestionActivityProgress(t, formatters, activity)}
						/>
						<p className="text-xs tabular-nums text-text-muted">
							{ingestionActivityProgressValue(t, activity).text}
						</p>
						<p className="text-xs text-text-subtle">
							<time dateTime={activity.lastAdvancedAt}>
								{t(
									kernelMessage("client.imports.report.last-advancement", {
										time: dateTime.format(new Date(activity.lastAdvancedAt)),
									}),
								)}
							</time>
						</p>
						{activity.wait === null ? null : (
							<p className="text-xs text-text-muted">
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
					</div>
				);
			})}
			<p className="text-sm tabular-nums text-text-muted">
				{importRunCountsLabel(t, formatters, run)}
			</p>
		</div>
	);
}
