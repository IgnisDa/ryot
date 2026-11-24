import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";

import { importRunProvenanceLabel } from "#/modules/imports/run-presentation";
import { StatusState } from "#/modules/ui/status-state";

import { IngestionIssues } from "./ingestion-issues";
import { IngestionRunReport } from "./ingestion-run-report";

export type ImportRunDetailState =
	{ readonly status: "failed" } | { readonly status: "ready"; readonly run: ImportRunSummary };

type ImportRunViewProps = {
	readonly onRetry: () => void;
	readonly state: ImportRunDetailState;
	readonly onDownloadIssues: () => void;
	readonly isDownloadingIssues: boolean;
	readonly downloadIssuesFailed: boolean;
};

export function ImportRunView(props: ImportRunViewProps) {
	const t = useT();
	const formatters = useFormatters();
	if (props.state.status === "failed") {
		return (
			<StatusState
				detailTone="danger"
				className="rounded-xl border border-border bg-surface p-6"
				title={t(kernelMessage("client.imports.run-load-error.title"))}
				detail={t(kernelMessage("client.imports.run-load-error.detail"))}
				action={
					<Button type="button" variant="secondary" onClick={props.onRetry}>
						{t(kernelMessage("common.action.try-again"))}
					</Button>
				}
			/>
		);
	}
	const run = props.state.run;
	const provenance = importRunProvenanceLabel(t, formatters, run.inputSummary);
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
			>
				<Button
					type="button"
					variant="secondary"
					onClick={props.onDownloadIssues}
					disabled={props.isDownloadingIssues}
					aria-label={t(kernelMessage("client.imports.download-issues"))}
					className="flex min-h-9 self-start items-center gap-1.5 px-3 py-1.5 text-sm"
				>
					<AppIcon size={15} name="download" className="text-text-muted" />
					{t(
						props.isDownloadingIssues
							? kernelMessage("client.imports.preparing-download")
							: kernelMessage("client.imports.download-issues"),
					)}
				</Button>
				{props.downloadIssuesFailed ? (
					<p role="alert" className="text-sm text-danger">
						{t(kernelMessage("client.imports.download-issues-failed"))}
					</p>
				) : null}
			</IngestionIssues>
			{run.status === "running" || run.status === "pending" || run.status === "cancelling" ? (
				<p className="text-xs text-text-muted">
					{t(kernelMessage("client.imports.keeps-running"))}
				</p>
			) : null}
			{wasCancelled ? (
				<div className="flex gap-3 rounded-xl border border-border bg-surface p-4">
					<AppIcon size={18} name="circle-x" className="shrink-0 text-text-muted" />
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="text-sm font-medium text-text">
							{t(kernelMessage("client.imports.cancelled.title"))}
						</span>
						<span className="text-sm leading-5 text-text-muted">
							{t(kernelMessage("client.imports.cancelled.detail"))}
						</span>
					</div>
				</div>
			) : null}
		</div>
	);
}
