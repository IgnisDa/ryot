import { Button } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";

import {
	importRunFailureNotice,
	importRunProvenanceLabel,
} from "#/modules/imports/run-presentation";
import { StatusState } from "#/modules/ui/status-state";

import { IngestionIssues } from "./ingestion-issues";
import { IngestionRunReport } from "./ingestion-run-report";

export type ImportRunDetailState =
	| { readonly status: "failed" }
	| { readonly status: "ready"; readonly run: ImportRunSummary };

type ImportRunViewProps = {
	readonly onRetry: () => void;
	readonly state: ImportRunDetailState;
	readonly onDownloadIssues: () => void;
	readonly isDownloadingIssues: boolean;
	readonly downloadIssuesFailed: boolean;
};

export function ImportRunView(props: ImportRunViewProps) {
	if (props.state.status === "failed") {
		return (
			<StatusState
				detailTone="danger"
				title="Unable to load this import"
				className="rounded-xl border border-border bg-surface p-6"
				detail="This import could not be loaded. Check the server and try again."
				action={
					<Button type="button" variant="secondary" onClick={props.onRetry}>
						Try again
					</Button>
				}
			/>
		);
	}
	const run = props.state.run;
	const provenance = importRunProvenanceLabel(run.inputSummary);
	const notice = run.status === "failed" ? importRunFailureNotice(run.failureReason) : undefined;
	const wasCancelled = run.status === "cancelled";
	return (
		<div className="flex flex-col gap-6 pb-4">
			{provenance === undefined ? null : (
				<p className="line-clamp-2 text-sm text-text-muted">{provenance}</p>
			)}
			<IngestionRunReport run={run} />
			<IngestionIssues
				key={run.id}
				runId={run.id}
				revision={`${run.status}:${run.activities.map(({ id, lastAdvancedAt }) => `${id}:${lastAdvancedAt}`).join(";")}`}
			/>
			<Button
				type="button"
				variant="secondary"
				aria-label="Download issues"
				onClick={props.onDownloadIssues}
				disabled={props.isDownloadingIssues}
				className="flex min-h-9 self-start items-center gap-1.5 px-3 py-1.5 text-sm"
			>
				<AppIcon size={15} name="download" className="text-text-muted" />
				{props.isDownloadingIssues ? "Preparing download..." : "Download issues"}
			</Button>
			{props.downloadIssuesFailed ? (
				<p role="alert" className="text-sm text-danger">
					Could not download these issues. Try again.
				</p>
			) : null}
			{run.status === "running" || run.status === "pending" || run.status === "cancelling" ? (
				<p className="text-xs text-text-muted">
					This keeps running on your server, even if you close Ryot or the server restarts.
				</p>
			) : null}
			{wasCancelled ? (
				<div className="flex gap-3 rounded-xl border border-border bg-surface p-4">
					<AppIcon size={18} name="circle-x" className="shrink-0 text-text-muted" />
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="text-sm font-medium text-text">Import cancelled</span>
						<span className="text-sm leading-5 text-text-muted">
							Future work stopped. Items already added remain in your library.
						</span>
					</div>
				</div>
			) : null}
			{notice === undefined ? null : (
				<div className="flex gap-3 rounded-xl border border-border bg-surface p-4">
					<AppIcon size={18} name="circle-alert" className="shrink-0 text-danger" />
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="text-sm font-medium text-danger">{notice.label}</span>
						<span className="text-sm leading-5 text-text-muted">{notice.detail}</span>
					</div>
				</div>
			)}
		</div>
	);
}
