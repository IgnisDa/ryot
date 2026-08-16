import { Button } from "@ryot-app/client-ui-sdk";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";

import {
	importRunCountsLabel,
	importRunOutcomeLabel,
	importRunProgress,
	importRunProgressValue,
	importSourceName,
	liveImportRun,
} from "#/modules/imports/run-presentation";
import { AppIcon } from "#/modules/navigation/app-icon";
import { RunProgressBar } from "#/modules/ui/run/run-progress-bar";
import { formatRelativeTime, runDurationLabel, runStartedLabel } from "#/modules/ui/run/run-status";
import { RunStatusGlyph, RunStatusPill } from "#/modules/ui/run/run-status-pill";
import { StatusState } from "#/modules/ui/status-state";

const INTRO =
	"Bring your history over from another service. Files are uploaded to your own server, read once, and deleted when the import finishes.";

type SourceNames = ReadonlyMap<string, string>;

export type ImportRunListState =
	| { readonly status: "empty" }
	| { readonly status: "failed" }
	| {
			readonly status: "ready";
			readonly hasMore: boolean;
			readonly runs: readonly ImportRunSummary[];
	  };

type ImportDataViewProps = {
	readonly nowMs: number;
	readonly onRetry: () => void;
	readonly isLoadingOlder: boolean;
	readonly onShowOlder: () => void;
	readonly sourceNames: SourceNames;
	readonly onStartImport: () => void;
	readonly state: ImportRunListState;
};

function LiveImportRunCard(props: {
	readonly nowMs: number;
	readonly sourceName: string;
	readonly run: ImportRunSummary;
}) {
	const progress = importRunProgress(props.run);
	return (
		<Link
			params={{ runId: props.run.id }}
			to="/settings/import-data/$runId"
			aria-label={`Open the ${props.sourceName} import in progress`}
			className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
		>
			<span className="flex items-center justify-between gap-3">
				<span className="min-w-0 flex-1 truncate text-base font-semibold text-text">
					{props.sourceName}
				</span>
				<RunStatusPill status={props.run.status} />
			</span>
			<span className="flex flex-col gap-2">
				<RunProgressBar progress={progress} value={importRunProgressValue(props.run)} />
				<span className="flex items-center justify-between gap-3">
					<span className="text-xs tabular-nums text-text-muted">
						{importRunCountsLabel(props.run)}
					</span>
					<span className="text-xs font-medium text-text-subtle">{progress.label}</span>
				</span>
			</span>
			<span className="text-xs text-text-subtle">{runStartedLabel(props.run, props.nowMs)}</span>
			<span className="text-xs text-text-muted">
				This keeps running on your server, even if you close Ryot.
			</span>
		</Link>
	);
}

function ImportHistoryRow(props: {
	readonly nowMs: number;
	readonly isFirst: boolean;
	readonly sourceName: string;
	readonly run: ImportRunSummary;
}) {
	const duration = runDurationLabel(props.run, props.nowMs);
	const relative = formatRelativeTime(props.run.createdAt, props.nowMs);
	return (
		<Link
			params={{ runId: props.run.id }}
			to="/settings/import-data/$runId"
			aria-label={`Open the ${props.sourceName} import from ${relative}`}
			className={clsx(
				"flex items-center gap-3 border-b border-border py-3",
				props.isFirst && "border-t",
			)}
		>
			<RunStatusGlyph status={props.run.status} />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-sm font-medium text-text">{props.sourceName}</span>
				<span className="truncate text-xs text-text-subtle">
					{duration === undefined ? relative : `${relative} · ${duration}`}
				</span>
			</span>
			<span className="line-clamp-2 max-w-40 text-right text-xs tabular-nums text-text-muted">
				{importRunOutcomeLabel(props.run)}
			</span>
			<AppIcon size={16} name="chevron-right" className="shrink-0 text-text-subtle" />
		</Link>
	);
}

function ImportHistory(props: {
	readonly nowMs: number;
	readonly hasMore: boolean;
	readonly isLoadingOlder: boolean;
	readonly onShowOlder: () => void;
	readonly sourceNames: SourceNames;
	readonly runs: readonly ImportRunSummary[];
}) {
	return (
		<div className="flex flex-col gap-2">
			<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
				Recent
			</span>
			<div>
				{props.runs.map((run, index) => (
					<ImportHistoryRow
						run={run}
						key={run.id}
						nowMs={props.nowMs}
						isFirst={index === 0}
						sourceName={importSourceName(run.source, props.sourceNames)}
					/>
				))}
			</div>
			{props.hasMore ? (
				<button
					type="button"
					onClick={props.onShowOlder}
					disabled={props.isLoadingOlder}
					aria-label="Show older imports"
					className={clsx(
						"self-start py-2 text-sm font-medium text-accent-text",
						props.isLoadingOlder && "opacity-50",
					)}
				>
					{props.isLoadingOlder ? "Loading older imports..." : "Show older imports"}
				</button>
			) : null}
		</div>
	);
}

export function ImportDataView(props: ImportDataViewProps) {
	if (props.state.status === "failed") {
		return (
			<StatusState
				detailTone="danger"
				title="Unable to load imports"
				className="rounded-xl border border-border bg-surface p-6"
				detail="Your import history could not be loaded. Check the server and try again."
				action={
					<Button type="button" variant="secondary" onClick={props.onRetry}>
						Try again
					</Button>
				}
			/>
		);
	}
	const ready = props.state.status === "ready" ? props.state : undefined;
	const runs = ready?.runs ?? [];
	const live = liveImportRun(runs);
	return (
		<div className="flex flex-col gap-6 pb-4">
			<p className="text-sm leading-6 text-text-muted">{INTRO}</p>
			{ready === undefined ? null : (
				<Button
					type="button"
					variant="primary"
					onClick={props.onStartImport}
					className="flex w-full items-center justify-center gap-2 sm:w-auto sm:self-start sm:px-6"
				>
					<AppIcon size={16} name="plus" className="text-accent-ink" />
					Start an import
				</Button>
			)}
			{live === undefined ? null : (
				<LiveImportRunCard
					run={live}
					nowMs={props.nowMs}
					sourceName={importSourceName(live.source, props.sourceNames)}
				/>
			)}
			{ready === undefined ? (
				<StatusState
					className="py-12"
					title="No imports yet"
					icon={<AppIcon size={40} name="clipboard-list" className="text-text-subtle" />}
					detail="When you bring history over from another service, every run shows up here with its progress and anything it could not read."
					action={
						<Button
							type="button"
							variant="primary"
							onClick={props.onStartImport}
							className="w-full sm:w-auto sm:px-6"
						>
							Start an import
						</Button>
					}
				/>
			) : (
				<ImportHistory
					runs={runs}
					nowMs={props.nowMs}
					hasMore={ready.hasMore}
					sourceNames={props.sourceNames}
					onShowOlder={props.onShowOlder}
					isLoadingOlder={props.isLoadingOlder}
				/>
			)}
			<Link
				to="/settings/integrations"
				search={{ create: undefined }}
				aria-label="Syncing on a schedule? Integrations"
				className="flex items-center gap-1.5 self-start py-1 text-sm"
			>
				<span className="text-text-muted">Syncing on a schedule?</span>
				<span className="font-medium text-accent-text">Integrations</span>
				<AppIcon size={14} name="arrow-right" className="text-accent-text" />
			</Link>
		</div>
	);
}
