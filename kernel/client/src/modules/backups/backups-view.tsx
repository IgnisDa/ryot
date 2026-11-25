import { useFormatters, useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { Button, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { BackupRunItem } from "@ryot-app/ryotql-recipes/backups";
import clsx from "clsx";

import {
	backupExpiryLabel,
	backupRunFailureNotice,
	backupRunKindLabel,
	backupRunOutcomeLabel,
	backupRunProgress,
	backupRunProgressValue,
	canDeleteBackupRun,
	canDownloadBackupRun,
	liveBackupRun,
} from "#/modules/backups/presentation";
import { RunProgressBar } from "#/modules/ui/run/run-progress-bar";
import {
	formatRelativeTime,
	runHistoryCaption,
	runStartedLabel,
} from "#/modules/ui/run/run-status";
import { RunStatusGlyph, RunStatusPill } from "#/modules/ui/run/run-status-pill";
import { StatusState } from "#/modules/ui/status-state";

export const BACKUP_LOAD_ERROR = {
	title: kernelMessage("client.backups.load-error.title"),
	detail: kernelMessage("client.backups.load-error.detail"),
};

export type BackupRunListState =
	| { readonly status: "empty" }
	| { readonly status: "ready"; readonly runs: readonly BackupRunItem[] };

type BackupsViewProps = {
	readonly nowMs: number;
	readonly isCreating: boolean;
	readonly state: BackupRunListState;
	readonly onOpenRestore: () => void;
	readonly onCreateExport: () => void;
	readonly downloadingRunId: string | undefined;
	readonly createFailureDetail: string | undefined;
	readonly onDownload: (run: BackupRunItem) => void;
	readonly downloadFailureDetail: string | undefined;
	readonly onRequestDelete: (run: BackupRunItem, trigger: HTMLButtonElement) => void;
};

export function BackupsView(props: BackupsViewProps) {
	const t = useT();
	const runs = props.state.status === "ready" ? props.state.runs : [];
	const live = liveBackupRun(runs);
	const historyRuns = live === undefined ? runs : runs.filter((run) => run.id !== live.id);
	return (
		<div className="flex flex-col gap-6 pb-4">
			<p className="text-sm leading-6 text-text-muted">
				{t(kernelMessage("client.backups.intro"))}
			</p>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				{props.state.status === "empty" ? null : (
					<Button
						type="button"
						variant="primary"
						disabled={live !== undefined}
						onClick={props.onCreateExport}
						className="flex w-full items-center justify-center gap-2 sm:w-auto sm:px-6"
					>
						<AppIcon size={16} name="archive" className="text-accent-ink" />
						{t(
							props.isCreating
								? kernelMessage("common.status.starting")
								: kernelMessage("client.backups.create"),
						)}
					</Button>
				)}
				<Button
					type="button"
					variant="secondary"
					onClick={props.onOpenRestore}
					className="w-full sm:w-auto sm:px-6"
					disabled={live !== undefined || props.isCreating}
				>
					{t(kernelMessage("client.backups.wizard.title"))}
				</Button>
			</div>
			{live === undefined ? null : (
				<span className="text-xs text-text-subtle">
					{t(kernelMessage("client.backups.live-reason"))}
				</span>
			)}
			{props.createFailureDetail === undefined ? null : (
				<StatusMessage tone="error" className="text-sm">
					{props.createFailureDetail}
				</StatusMessage>
			)}
			{props.downloadFailureDetail === undefined ? null : (
				<StatusMessage tone="error" className="text-sm">
					{props.downloadFailureDetail}
				</StatusMessage>
			)}
			{live === undefined ? null : <LiveBackupRunCard run={live} nowMs={props.nowMs} />}
			{props.state.status !== "empty" ? null : (
				<StatusState
					className="py-12"
					title={t(kernelMessage("client.backups.empty.title"))}
					detail={t(kernelMessage("client.backups.empty.detail"))}
					icon={<AppIcon size={40} name="archive" className="text-text-subtle" />}
					action={
						<Button
							type="button"
							variant="primary"
							onClick={props.onCreateExport}
							className="w-full sm:w-auto sm:px-6"
						>
							{t(
								props.isCreating
									? kernelMessage("common.status.starting")
									: kernelMessage("client.backups.create"),
							)}
						</Button>
					}
				/>
			)}
			{props.state.status === "empty" || historyRuns.length === 0 ? null : (
				<div className="flex flex-col gap-2">
					<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
						{t(kernelMessage("client.backups.recent"))}
					</span>
					<div>
						{historyRuns.map((run, index) => (
							<BackupHistoryRow
								run={run}
								key={run.id}
								nowMs={props.nowMs}
								isFirst={index === 0}
								onDownload={props.onDownload}
								onRequestDelete={props.onRequestDelete}
								isDownloading={props.downloadingRunId === run.id}
								downloadDisabled={props.downloadingRunId !== undefined}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function LiveBackupRunCard(props: { readonly nowMs: number; readonly run: BackupRunItem }) {
	const t = useT();
	const formatters = useFormatters();
	const progress = backupRunProgress(t, formatters, props.run);
	const label = t(backupRunKindLabel(props.run.kind));
	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
			<div className="flex items-center justify-between gap-3">
				<span className="min-w-0 flex-1 truncate text-base font-semibold text-text">{label}</span>
				<RunStatusPill status={props.run.status} />
			</div>
			<div className="flex flex-col gap-2">
				<RunProgressBar
					label={label}
					progress={progress}
					value={backupRunProgressValue(t, formatters, props.run)}
				/>
				<div className="flex items-center justify-between gap-3">
					<span className="text-xs text-text-subtle">
						{runStartedLabel(formatters, t, props.run, props.nowMs)}
					</span>
					<span className="text-xs font-medium tabular-nums text-text-subtle">
						{progress.label}
					</span>
				</div>
			</div>
		</div>
	);
}

function BackupHistoryRow(props: {
	readonly nowMs: number;
	readonly isFirst: boolean;
	readonly run: BackupRunItem;
	readonly isDownloading: boolean;
	readonly downloadDisabled: boolean;
	readonly onDownload: (run: BackupRunItem) => void;
	readonly onRequestDelete: (run: BackupRunItem, trigger: HTMLButtonElement) => void;
}) {
	const t = useT();
	const formatters = useFormatters();
	const kind = t(backupRunKindLabel(props.run.kind));
	const relative = formatRelativeTime(formatters, t, props.run.createdAt, props.nowMs);
	const notice =
		props.run.status === "failed" ? backupRunFailureNotice(props.run.failure) : undefined;
	const expiry = backupExpiryLabel(props.run, props.nowMs);
	const canDownload = canDownloadBackupRun(props.run, props.nowMs);
	const canDelete = canDeleteBackupRun(props.run.status);
	return (
		<div
			className={clsx(
				"flex flex-col gap-2 border-b border-border py-3",
				props.isFirst && "border-t",
			)}
		>
			<div className="flex items-center gap-3">
				<RunStatusGlyph status={props.run.status} />
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="truncate text-sm font-medium text-text">{kind}</span>
					<span className="truncate text-xs text-text-subtle">
						{runHistoryCaption(formatters, t, props.run, props.nowMs)}
					</span>
				</span>
				<span className="line-clamp-2 max-w-40 text-right text-xs tabular-nums text-text-muted">
					{backupRunOutcomeLabel(t, formatters, props.run, props.nowMs)}
				</span>
			</div>
			{notice === undefined ? null : (
				<p className="text-xs leading-5 text-danger">{t(notice.detail)}</p>
			)}
			{!canDownload && !canDelete ? null : (
				<div className="flex items-center gap-3">
					{canDownload ? (
						<Button
							type="button"
							variant="secondary"
							disabled={props.downloadDisabled}
							onClick={() => props.onDownload(props.run)}
							className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-sm"
							aria-label={t(kernelMessage("client.backups.download-aria", { relative }))}
						>
							<AppIcon size={15} name="download" className="text-text" />
							{t(
								props.isDownloading
									? kernelMessage("client.backups.download-preparing")
									: kernelMessage("common.action.download"),
							)}
						</Button>
					) : null}
					{canDownload && expiry !== undefined ? (
						<span className="min-w-0 flex-1 text-xs text-text-subtle">{t(expiry)}</span>
					) : null}
					{canDelete ? (
						<button
							type="button"
							className="ml-auto shrink-0 p-1"
							onClick={(event) => props.onRequestDelete(props.run, event.currentTarget)}
							aria-label={t(
								kernelMessage("client.backups.delete-aria", { relative, kind: props.run.kind }),
							)}
						>
							<AppIcon size={16} name="trash-2" className="text-text-subtle" />
						</button>
					) : null}
				</div>
			)}
		</div>
	);
}
