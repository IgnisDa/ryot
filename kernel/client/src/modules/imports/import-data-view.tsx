import { useFormatters, useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button, LoadMoreButton } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";

import {
	importRunOutcomeLabel,
	importSourceName,
	liveImportRun,
} from "#/modules/imports/run-presentation";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import {
	formatRelativeTime,
	runHistoryCaption,
	runStartedLabel,
} from "#/modules/ui/run/run-status";
import { RunStatusGlyph, RunStatusPill } from "#/modules/ui/run/run-status-pill";
import { StatusState } from "#/modules/ui/status-state";

import { IngestionRunReport } from "./ingestion-run-report";

export type ImportRunListState =
	| { readonly status: "empty" }
	| { readonly status: "failed" }
	| { readonly status: "loading" }
	| {
			readonly status: "ready";
			readonly hasMore: boolean;
			readonly runs: readonly ImportRunSummary[];
	  };

type SourceNames = ReadonlyMap<string, Text>;

type ImportDataViewProps = {
	readonly nowMs: number;
	readonly onRetry: () => void;
	readonly isFetching?: boolean;
	readonly onShowOlder: () => void;
	readonly sourceNames: SourceNames;
	readonly onStartImport: () => void;
	readonly state: ImportRunListState;
	readonly isFetchingNextPage: boolean;
};

export function ImportDataView(props: ImportDataViewProps) {
	const t = useT();
	if (props.state.status === "failed") {
		return (
			<LoadErrorState
				onRetry={props.onRetry}
				title={t(kernelMessage("client.imports.load-error.title"))}
				detail={t(kernelMessage("client.imports.load-error.detail"))}
			/>
		);
	}
	if (props.state.status === "loading") {
		return <StatusState className="py-16" detail={t(kernelMessage("client.imports.loading"))} />;
	}
	const ready = props.state.status === "ready" ? props.state : undefined;
	const runs = ready?.runs ?? [];
	const live = liveImportRun(runs);
	return (
		<div className="flex flex-col gap-6 pb-4">
			<p className="text-sm leading-6 text-text-muted">
				{t(kernelMessage("client.imports.intro"))}
			</p>
			{ready === undefined ? null : (
				<Button
					type="button"
					variant="primary"
					onClick={props.onStartImport}
					className="flex w-full items-center justify-center gap-2 sm:w-auto sm:self-start sm:px-6"
				>
					<AppIcon size={16} name="plus" className="text-accent-ink" />
					{t(kernelMessage("client.imports.wizard.title"))}
				</Button>
			)}
			{live === undefined ? null : (
				<LiveImportRunCard
					run={live}
					nowMs={props.nowMs}
					sourceName={importSourceName(t, live, props.sourceNames)}
				/>
			)}
			{ready === undefined ? (
				<StatusState
					className="py-12"
					title={t(kernelMessage("client.imports.empty.title"))}
					detail={t(kernelMessage("client.imports.empty.detail"))}
					icon={<AppIcon size={40} name="clipboard-list" className="text-text-subtle" />}
					action={
						<Button
							type="button"
							variant="primary"
							onClick={props.onStartImport}
							className="w-full sm:w-auto sm:px-6"
						>
							{t(kernelMessage("client.imports.wizard.title"))}
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
					isFetching={props.isFetching === true}
					isFetchingNextPage={props.isFetchingNextPage}
				/>
			)}
			<Link
				to="/settings/integrations"
				search={{ create: undefined }}
				className="flex items-center gap-1.5 self-start py-1 text-sm"
				aria-label={t(kernelMessage("client.imports.integrations-link-label"))}
			>
				<span className="text-text-muted">
					{t(kernelMessage("client.imports.integrations-prompt"))}
				</span>
				<span className="font-medium text-accent-text">
					{t(kernelMessage("client.settings.section.integrations"))}
				</span>
				<AppIcon size={14} name="arrow-right" className="text-accent-text" />
			</Link>
		</div>
	);
}

function LiveImportRunCard(props: {
	readonly nowMs: number;
	readonly sourceName: string;
	readonly run: ImportRunSummary;
}) {
	const t = useT();
	const formatters = useFormatters();
	return (
		<Link
			params={{ runId: props.run.id }}
			to="/settings/import-data/$runId"
			className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4"
			aria-label={t(kernelMessage("client.imports.open-live", { source: props.sourceName }))}
		>
			<span className="flex items-center justify-between gap-3">
				<span className="min-w-0 flex-1 truncate text-base font-semibold text-text">
					{props.sourceName}
				</span>
				<RunStatusPill status={props.run.status} />
			</span>
			<IngestionRunReport run={props.run} />
			<span className="text-xs text-text-subtle">
				{runStartedLabel(formatters, t, props.run, props.nowMs)}
			</span>
			<span className="text-xs text-text-muted">
				{t(kernelMessage("client.imports.keeps-running"))}
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
	const t = useT();
	const formatters = useFormatters();
	const relative = formatRelativeTime(formatters, t, props.run.createdAt, props.nowMs);
	return (
		<Link
			params={{ runId: props.run.id }}
			to="/settings/import-data/$runId"
			aria-label={t(
				kernelMessage("client.imports.open-run", { relative, source: props.sourceName }),
			)}
			className={clsx(
				"flex items-center gap-3 border-b border-border py-3",
				props.isFirst && "border-t",
			)}
		>
			<RunStatusGlyph status={props.run.status} />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-sm font-medium text-text">{props.sourceName}</span>
				<span className="truncate text-xs text-text-subtle">
					{runHistoryCaption(formatters, t, props.run, props.nowMs)}
				</span>
			</span>
			<span className="line-clamp-2 max-w-40 text-right text-xs tabular-nums text-text-muted">
				{importRunOutcomeLabel(t, formatters, props.run)}
			</span>
			<AppIcon size={16} name="chevron-right" className="shrink-0 text-text-subtle" />
		</Link>
	);
}

function ImportHistory(props: {
	readonly nowMs: number;
	readonly hasMore: boolean;
	readonly isFetching?: boolean;
	readonly onShowOlder: () => void;
	readonly sourceNames: SourceNames;
	readonly isFetchingNextPage: boolean;
	readonly runs: readonly ImportRunSummary[];
}) {
	const t = useT();
	return (
		<div className="flex flex-col gap-2">
			<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
				{t(kernelMessage("client.imports.recent"))}
			</span>
			<div>
				{props.runs.map((run, index) => (
					<ImportHistoryRow
						run={run}
						key={run.id}
						nowMs={props.nowMs}
						isFirst={index === 0}
						sourceName={importSourceName(t, run, props.sourceNames)}
					/>
				))}
			</div>
			{props.hasMore ? (
				<LoadMoreButton
					type="button"
					variant="ghost"
					onClick={props.onShowOlder}
					disabled={props.isFetching}
					isFetchingNextPage={props.isFetchingNextPage}
					label={t(kernelMessage("client.imports.show-older"))}
					aria-label={t(kernelMessage("client.imports.show-older"))}
					loadingLabel={t(kernelMessage("client.imports.loading-older"))}
					className="self-start py-2 text-sm font-medium text-accent-text"
				/>
			) : null}
		</div>
	);
}
