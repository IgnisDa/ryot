import { Button } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type { ImportRunFailure, ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";
import clsx from "clsx";
import { useState } from "react";

import {
	buildImportFailureClipboardText,
	groupImportFailuresByStage,
	importFailureProvenanceEntries,
	importFailureReasonDetail,
	importFailureRowLabel,
} from "#/modules/imports/failure-presentation";
import {
	importRunCountsLabel,
	importRunFailureNotice,
	importRunProgress,
	importRunProgressValue,
	importRunProvenanceLabel,
	importSourceName,
} from "#/modules/imports/run-presentation";
import { RunProgressBar } from "#/modules/ui/run/run-progress-bar";
import { formatRunCount } from "#/modules/ui/run/run-status";
import { StatusState } from "#/modules/ui/status-state";

export type ImportRunDetailState =
	| { readonly status: "failed" }
	| {
			readonly status: "ready";
			readonly run: ImportRunSummary;
			readonly hasMoreFailures: boolean;
			readonly failures: readonly ImportRunFailure[];
	  };

type ImportRunViewProps = {
	readonly onRetry: () => void;
	readonly isLoadingMore: boolean;
	readonly onShowMore: () => void;
	readonly state: ImportRunDetailState;
	readonly onCopy: (text: string) => void;
	readonly sourceNames: ReadonlyMap<string, string>;
};

function RunCounts(props: { readonly run: ImportRunSummary }) {
	const progress = importRunProgress(props.run);
	const figures = [
		{ label: "Read", value: formatRunCount(props.run.processedItems) },
		{ label: "Added", value: formatRunCount(props.run.importedItems) },
		{ label: "Failed", value: formatRunCount(props.run.failedItems) },
	];
	return (
		<div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4">
			<div className="flex">
				{figures.map((figure) => (
					<div key={figure.label} className="flex flex-1 flex-col gap-0.5">
						<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
							{figure.label}
						</span>
						<span className="text-xl font-semibold tabular-nums text-text">{figure.value}</span>
					</div>
				))}
			</div>
			<div className="flex flex-col gap-2">
				<RunProgressBar progress={progress} value={importRunProgressValue(props.run)} />
				<div className="flex items-center justify-between gap-3">
					<span className="text-xs tabular-nums text-text-muted">
						{importRunCountsLabel(props.run)}
					</span>
					<span className="text-xs font-medium text-text-subtle">{progress.label}</span>
				</div>
			</div>
		</div>
	);
}

function FailureRow(props: { readonly failure: ImportRunFailure; readonly pill: string }) {
	const [isExpanded, setIsExpanded] = useState(false);
	const label = importFailureRowLabel(props.failure);
	const entries = importFailureProvenanceEntries(props.failure);
	return (
		<div className="border-b border-border">
			<button
				type="button"
				aria-label={label}
				aria-expanded={isExpanded}
				onClick={() => setIsExpanded(!isExpanded)}
				className="flex w-full items-center gap-3 py-3 text-left"
			>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="truncate text-sm font-medium text-text">{label}</span>
					<span className="line-clamp-2 text-xs text-text-muted">
						{importFailureReasonDetail(props.failure)}
					</span>
				</span>
				<span className="text-[11px] font-medium text-text-subtle">{props.pill}</span>
				<AppIcon
					size={16}
					className="shrink-0 text-text-subtle"
					name={isExpanded ? "chevron-up" : "chevron-down"}
				/>
			</button>
			{isExpanded ? (
				<div className="flex flex-col gap-1 pb-3">
					{entries.length === 0 ? (
						<span className="text-xs text-text-subtle">No extra detail was recorded.</span>
					) : (
						entries.map((entry) => (
							<div key={entry.key} className="flex gap-2">
								<span className="w-32 font-mono text-[11px] text-text-subtle">{entry.key}</span>
								<span className="min-w-0 flex-1 font-mono text-[11px] break-all text-text-muted">
									{entry.value}
								</span>
							</div>
						))
					)}
				</div>
			) : null}
		</div>
	);
}

function RunFailures(props: {
	readonly runId: string;
	readonly hasMore: boolean;
	readonly sourceName: string;
	readonly isLoadingMore: boolean;
	readonly onShowMore: () => void;
	readonly onCopy: (text: string) => void;
	readonly failures: readonly ImportRunFailure[];
}) {
	const [isCopied, setIsCopied] = useState(false);
	const groups = groupImportFailuresByStage(props.failures);

	const copy = () => {
		props.onCopy(
			buildImportFailureClipboardText({
				runId: props.runId,
				failures: props.failures,
				sourceName: props.sourceName,
			}),
		);
		setIsCopied(true);
	};

	return (
		<div className="flex flex-col gap-5">
			<div className="flex items-center justify-between gap-3">
				<h2 className="text-base font-semibold text-text">What could not be brought over</h2>
				<Button
					type="button"
					onClick={copy}
					variant="secondary"
					aria-label="Copy details"
					className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-sm"
				>
					<AppIcon size={15} name="copy" className="text-text-muted" />
					{isCopied ? "Copied" : "Copy details"}
				</Button>
			</div>
			{groups.map((group) => (
				<div key={group.stage} className="flex flex-col gap-1">
					<span className="text-sm font-medium text-text-muted">{group.heading}</span>
					<div>
						{group.failures.map((failure) => (
							<FailureRow key={failure.id} failure={failure} pill={group.pill} />
						))}
					</div>
				</div>
			))}
			{props.hasMore ? (
				<button
					type="button"
					onClick={props.onShowMore}
					disabled={props.isLoadingMore}
					aria-label="Show more failures"
					className={clsx(
						"self-start py-2 text-sm font-medium text-accent-text",
						props.isLoadingMore && "opacity-50",
					)}
				>
					{props.isLoadingMore ? "Loading more failures..." : "Show more failures"}
				</button>
			) : null}
		</div>
	);
}

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
	const sourceName = importSourceName(run.source, props.sourceNames);
	const notice = run.status === "failed" ? importRunFailureNotice(run.failureReason) : undefined;
	return (
		<div className="flex flex-col gap-6 pb-4">
			{provenance === undefined ? null : (
				<p className="line-clamp-2 text-sm text-text-muted">{provenance}</p>
			)}
			<RunCounts run={run} />
			{run.status === "running" || run.status === "pending" ? (
				<p className="text-xs text-text-muted">
					This runs on your server and can&apos;t be stopped once started.
				</p>
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
			{props.state.failures.length === 0 ? null : (
				<RunFailures
					runId={run.id}
					onCopy={props.onCopy}
					sourceName={sourceName}
					onShowMore={props.onShowMore}
					failures={props.state.failures}
					isLoadingMore={props.isLoadingMore}
					hasMore={props.state.hasMoreFailures}
				/>
			)}
		</div>
	);
}
