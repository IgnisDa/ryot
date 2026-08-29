import { Button, StatusMessage } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type { BackupRun } from "@ryot-app/contract/modules/backups/schemas";
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
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { RunProgressBar } from "#/modules/ui/run/run-progress-bar";
import { formatRelativeTime, runDurationLabel, runStartedLabel } from "#/modules/ui/run/run-status";
import { RunStatusGlyph, RunStatusPill } from "#/modules/ui/run/run-status-pill";
import { StatusState } from "#/modules/ui/status-state";

const INTRO =
	"A backup is a portable copy of everything in this account. It does not include your password, integrations, or notification channels. Download links expire 24 hours after the backup is made.";

const LIVE_REASON =
	"A backup or restore is already under way. You can start another when it finishes.";

const KEEPS_RUNNING = "This keeps running on your server, even if you close Ryot.";

export const BACKUP_LOAD_ERROR = {
	title: "Unable to load backups",
	detail: "Your backups could not be loaded. Check the server and try again.",
};

export type BackupRunListState =
	| { readonly status: "empty" }
	| { readonly status: "failed" }
	| { readonly status: "ready"; readonly runs: readonly BackupRun[] };

type BackupsViewProps = {
	readonly nowMs: number;
	readonly onRetry: () => void;
	readonly isCreating: boolean;
	readonly state: BackupRunListState;
	readonly onOpenRestore: () => void;
	readonly onCreateExport: () => void;
	readonly downloadingRunId: string | undefined;
	readonly onDownload: (run: BackupRun) => void;
	readonly createFailureDetail: string | undefined;
	readonly downloadFailureDetail: string | undefined;
	readonly onRequestDelete: (run: BackupRun, trigger: HTMLButtonElement) => void;
};

function LiveBackupRunCard(props: { readonly nowMs: number; readonly run: BackupRun }) {
	const progress = backupRunProgress(props.run);
	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
			<div className="flex items-center justify-between gap-3">
				<span className="min-w-0 flex-1 truncate text-base font-semibold text-text">
					{backupRunKindLabel(props.run.kind)}
				</span>
				<RunStatusPill status={props.run.status} />
			</div>
			<div className="flex flex-col gap-2">
				<RunProgressBar progress={progress} value={backupRunProgressValue(props.run)} />
				<div className="flex items-center justify-between gap-3">
					<span className="text-xs text-text-subtle">
						{runStartedLabel(props.run, props.nowMs)}
					</span>
					<span className="text-xs font-medium tabular-nums text-text-subtle">
						{progress.label}
					</span>
				</div>
			</div>
			<span className="text-xs text-text-muted">{KEEPS_RUNNING}</span>
		</div>
	);
}

function BackupHistoryRow(props: {
	readonly nowMs: number;
	readonly run: BackupRun;
	readonly isFirst: boolean;
	readonly isDownloading: boolean;
	readonly downloadDisabled: boolean;
	readonly onDownload: (run: BackupRun) => void;
	readonly onRequestDelete: (run: BackupRun, trigger: HTMLButtonElement) => void;
}) {
	const kind = backupRunKindLabel(props.run.kind);
	const duration = runDurationLabel(props.run, props.nowMs);
	const relative = formatRelativeTime(props.run.createdAt, props.nowMs);
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
						{duration === undefined ? relative : `${relative} · ${duration}`}
					</span>
				</span>
				<span className="line-clamp-2 max-w-40 text-right text-xs tabular-nums text-text-muted">
					{backupRunOutcomeLabel(props.run, props.nowMs)}
				</span>
			</div>
			{notice === undefined ? null : (
				<p className="text-xs leading-5 text-danger">{notice.detail}</p>
			)}
			{!canDownload && !canDelete ? null : (
				<div className="flex items-center gap-3">
					{canDownload ? (
						<Button
							type="button"
							variant="secondary"
							disabled={props.downloadDisabled}
							onClick={() => props.onDownload(props.run)}
							aria-label={`Download the backup from ${relative}`}
							className="flex min-h-9 items-center gap-1.5 px-3 py-1.5 text-sm"
						>
							<AppIcon size={15} name="download" className="text-text" />
							{props.isDownloading ? "Preparing..." : "Download"}
						</Button>
					) : null}
					{canDownload && expiry !== undefined ? (
						<span className="min-w-0 flex-1 text-xs text-text-subtle">{expiry}</span>
					) : null}
					{canDelete ? (
						<button
							type="button"
							className="ml-auto shrink-0 p-1"
							aria-label={`Delete the ${kind.toLowerCase()} record from ${relative}`}
							onClick={(event) => props.onRequestDelete(props.run, event.currentTarget)}
						>
							<AppIcon size={16} name="trash-2" className="text-text-subtle" />
						</button>
					) : null}
				</div>
			)}
		</div>
	);
}

export function BackupsView(props: BackupsViewProps) {
	if (props.state.status === "failed") {
		return (
			<LoadErrorState
				onRetry={props.onRetry}
				title={BACKUP_LOAD_ERROR.title}
				detail={BACKUP_LOAD_ERROR.detail}
			/>
		);
	}
	const runs = props.state.status === "ready" ? props.state.runs : [];
	const live = liveBackupRun(runs);
	const historyRuns = live === undefined ? runs : runs.filter((run) => run.id !== live.id);
	return (
		<div className="flex flex-col gap-6 pb-4">
			<p className="text-sm leading-6 text-text-muted">{INTRO}</p>
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
						{props.isCreating ? "Starting..." : "Create a backup"}
					</Button>
				)}
				<Button
					type="button"
					variant="secondary"
					onClick={props.onOpenRestore}
					className="w-full sm:w-auto sm:px-6"
					disabled={live !== undefined || props.isCreating}
				>
					Restore from a backup
				</Button>
			</div>
			{live === undefined ? null : <span className="text-xs text-text-subtle">{LIVE_REASON}</span>}
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
					title="No backups yet"
					icon={<AppIcon size={40} name="archive" className="text-text-subtle" />}
					detail="Make a backup whenever you want a copy you keep yourself. Every backup and restore shows up here."
					action={
						<Button
							type="button"
							variant="primary"
							onClick={props.onCreateExport}
							className="w-full sm:w-auto sm:px-6"
						>
							{props.isCreating ? "Starting..." : "Create a backup"}
						</Button>
					}
				/>
			)}
			{props.state.status === "empty" || historyRuns.length === 0 ? null : (
				<div className="flex flex-col gap-2">
					<span className="text-[11px] font-medium uppercase tracking-[0.8px] text-text-subtle">
						Recent
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
