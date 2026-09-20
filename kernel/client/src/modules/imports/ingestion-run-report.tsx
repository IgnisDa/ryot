import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";

import { RunProgressBar } from "#/modules/ui/run/run-progress-bar";

import {
	ingestionActivityProgress,
	ingestionActivityProgressValue,
	ingestionBlockReasonLabel,
	importRunCountsLabel,
} from "./run-presentation";

export function IngestionRunReport(props: { readonly run: ImportRunSummary }) {
	const run = props.run;
	return (
		<div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4">
			{run.status === "blocked" ? (
				<div role="status">
					<p className="text-sm font-medium text-text">Waiting for setup</p>
					<ul className="text-sm text-text-muted">
						{run.blockReasons.map((reason) => (
							<li key={`${reason.code}:${reason.key}`}>{ingestionBlockReasonLabel(reason)}</li>
						))}
					</ul>
					<p className="text-xs text-text-muted">
						This delivery resumes automatically after setup is fixed.{" "}
						{run.blockDeadline === null ? null : (
							<>
								Setup deadline:{" "}
								<time dateTime={run.blockDeadline}>
									{new Date(run.blockDeadline).toLocaleString()}
								</time>
								. The deadline does not extend.
							</>
						)}
					</p>
				</div>
			) : null}
			{run.status === "expired" ? (
				<p role="status" className="text-sm text-text-muted">
					The seven-day setup deadline expired. This delivery will not run. Fix setup, then send a
					new delivery. Its captured input has been released.
				</p>
			) : null}
			{run.activities.map((activity) => (
				<div key={activity.id} className="flex flex-col gap-2">
					<p className="text-sm font-medium capitalize text-text">
						{activity.kind} · {activity.state}
					</p>
					<RunProgressBar
						progress={ingestionActivityProgress(activity)}
						value={ingestionActivityProgressValue(activity)}
					/>
					<p className="text-xs tabular-nums text-text-muted">
						{ingestionActivityProgressValue(activity).text}
					</p>
					<p className="text-xs text-text-subtle">
						Last advancement:{" "}
						<time dateTime={activity.lastAdvancedAt}>
							{new Date(activity.lastAdvancedAt).toLocaleString()}
						</time>
					</p>
					{activity.wait === null ? null : (
						<p className="text-xs text-text-muted">
							Waiting: {activity.wait.code}
							{activity.wait.key === null ? "" : ` · ${activity.wait.key}`}
						</p>
					)}
				</div>
			))}
			<p className="text-sm tabular-nums text-text-muted">{importRunCountsLabel(run)}</p>
		</div>
	);
}
