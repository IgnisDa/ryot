import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";

import { importRunProvenanceLabel } from "#/modules/imports/run-presentation";
import { StatusState } from "#/modules/ui/status-state";

import { IngestionIssues, useIngestionIssues } from "./ingestion-issues";
import { IngestionRunReport, IngestionRunTechnicalDetails } from "./ingestion-run-report";

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
	return <ImportRunContent key={props.state.run.id} {...props} run={props.state.run} />;
}

function ImportRunContent(
	props: { readonly run: ImportRunSummary } & Omit<ImportRunViewProps, "state" | "onRetry">,
) {
	const t = useT();
	const formatters = useFormatters();
	const { run } = props;
	const provenance = importRunProvenanceLabel(t, formatters, run.inputSummary);
	const revision = `${run.status}:${run.activities.map(({ id, lastAdvancedAt }) => `${id}:${lastAdvancedAt}`).join(";")}`;
	const issues = useIngestionIssues(run.id, revision);
	const lead =
		run.status === "failed"
			? issues.issues.find(
					({ data }) =>
						data.severity === "error" &&
						data.reason.code === run.failureReason?.code &&
						"detail" in data.reason &&
						data.reason.detail !== undefined,
				)
			: undefined;
	const reason = lead?.data.reason;
	const failureDetail = reason && "detail" in reason ? reason.detail : undefined;
	return (
		<div className="flex flex-col gap-6 pb-4">
			{provenance === undefined ? null : (
				<p className="line-clamp-2 text-sm text-text-muted">{provenance}</p>
			)}
			<IngestionRunReport
				run={run}
				failureDetail={failureDetail}
				hasIssues={issues.issues.length > 0}
			/>
			<IngestionIssues {...issues} leadIssueId={lead?.id}>
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
			<IngestionRunTechnicalDetails run={run} />
		</div>
	);
}
