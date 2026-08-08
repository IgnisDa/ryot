import type { BackupRun } from "@ryot/contract/modules/backups/schemas";
import clsx from "clsx";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { AppButton } from "@/modules/ui/button";
import { RunProgressBar } from "@/modules/ui/run/run-progress-bar";
import { formatRelativeTime, runDurationLabel, runStartedLabel } from "@/modules/ui/run/run-status";
import { RunStatusGlyph, RunStatusPill } from "@/modules/ui/run/run-status-pill";
import { AppStatusState } from "@/modules/ui/status-state";

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
} from "./run-presentation";
import { backupRunListError, type BackupRunListState } from "./state";

const INTRO =
	"A backup is a portable copy of everything in this account. It does not include your password, integrations, or notification channels. Download links expire 24 hours after the backup is made.";

const LIVE_REASON = "A backup is already under way. You can start another when it finishes.";

const KEEPS_RUNNING = "This keeps running on your server, even if you close Ryot.";

function LiveBackupRunCard(props: { readonly nowMs: number; readonly run: BackupRun }) {
	const progress = backupRunProgress(props.run);
	const kind = backupRunKindLabel(props.run.kind);
	return (
		<View className="gap-3 rounded-2xl border border-border bg-surface p-4">
			<View className="flex-row items-center justify-between gap-3">
				<Text numberOfLines={1} className="min-w-0 flex-1 font-ui-semibold text-base text-text">
					{kind}
				</Text>
				<RunStatusPill status={props.run.status} />
			</View>
			<View className="gap-2">
				<RunProgressBar progress={progress} value={backupRunProgressValue(props.run)} />
				<View className="flex-row items-center justify-between gap-3">
					<Text className="font-ui text-xs text-text-subtle">
						{runStartedLabel(props.run, props.nowMs)}
					</Text>
					<Text className="font-ui-medium text-xs tabular-nums text-text-subtle">
						{progress.label}
					</Text>
				</View>
			</View>
			<Text className="font-ui text-xs text-text-muted">{KEEPS_RUNNING}</Text>
		</View>
	);
}

function BackupHistoryRow(props: {
	readonly nowMs: number;
	readonly run: BackupRun;
	readonly isFirst: boolean;
	readonly isDownloading: boolean;
	readonly onDownload: (run: BackupRun) => void;
	readonly onRequestDelete: (run: BackupRun) => void;
}) {
	const kind = backupRunKindLabel(props.run.kind);
	const duration = runDurationLabel(props.run, props.nowMs);
	const relative = formatRelativeTime(props.run.createdAt, props.nowMs);
	const notice =
		props.run.status === "failed" ? backupRunFailureNotice(props.run.error) : undefined;
	const expiry = backupExpiryLabel(props.run, props.nowMs);
	const canDownload = canDownloadBackupRun(props.run, props.nowMs);
	const canDelete = canDeleteBackupRun(props.run.status);
	return (
		<View className={clsx("gap-2 border-b border-border py-3", props.isFirst && "border-t")}>
			<View className="flex-row items-center gap-3">
				<RunStatusGlyph status={props.run.status} />
				<View className="min-w-0 flex-1 gap-0.5">
					<Text numberOfLines={1} className="font-ui-medium text-sm text-text">
						{kind}
					</Text>
					<Text numberOfLines={1} className="font-ui text-xs text-text-subtle">
						{duration === undefined ? relative : `${relative} · ${duration}`}
					</Text>
				</View>
				<Text
					numberOfLines={2}
					className="max-w-40 text-right font-ui text-xs tabular-nums text-text-muted"
				>
					{backupRunOutcomeLabel(props.run, props.nowMs)}
				</Text>
			</View>
			{notice === undefined ? null : (
				<Text className="font-ui text-xs leading-5 text-danger">{notice.detail}</Text>
			)}
			{!canDownload && !canDelete ? null : (
				<View className="flex-row items-center gap-3">
					{canDownload ? (
						<AppButton
							label="Download"
							pendingLabel="Preparing..."
							pending={props.isDownloading}
							onPress={() => props.onDownload(props.run)}
							accessibilityLabel={`Download the backup from ${relative}`}
							leading={<AppIcon size={15} name="download" className="text-text" />}
						/>
					) : null}
					{canDownload && expiry !== undefined ? (
						<Text className="min-w-0 flex-1 font-ui text-xs text-text-subtle">{expiry}</Text>
					) : null}
					{canDelete ? (
						<Pressable
							accessibilityRole="button"
							className="ml-auto shrink-0 p-1"
							onPress={() => props.onRequestDelete(props.run)}
							accessibilityLabel={`Delete the ${kind.toLowerCase()} record from ${relative}`}
						>
							<AppIcon size={16} name="trash-2" className="text-text-subtle" />
						</Pressable>
					) : null}
				</View>
			)}
		</View>
	);
}

export function BackupsView(props: {
	readonly nowMs: number;
	readonly isCreating: boolean;
	readonly onRetry: () => void;
	readonly state: BackupRunListState;
	readonly onOpenRestore: () => void;
	readonly onCreateExport: () => void;
	readonly onDownload: (run: BackupRun) => void;
	readonly downloadingRunId: string | undefined;
	readonly createFailureDetail: string | undefined;
	readonly downloadFailureDetail: string | undefined;
	readonly onRequestDelete: (run: BackupRun) => void;
}) {
	if (props.state.status === "loading") {
		return (
			<AppStatusState
				className="py-16"
				detail="Loading your backups..."
				icon={<ActivityIndicator accessibilityLabel="Loading backups" />}
			/>
		);
	}
	if (props.state.status === "malformed" || props.state.status === "transport-error") {
		const error = backupRunListError(props.state);
		return (
			<AppStatusState
				detailTone="danger"
				title={error.title}
				detail={error.detail}
				className="rounded-xl border border-border bg-surface p-6"
				action={<AppButton label="Try again" onPress={props.onRetry} />}
			/>
		);
	}
	const runs = props.state.status === "ready" ? props.state.runs : [];
	const live = liveBackupRun(runs);
	return (
		<View className="gap-6 pb-4">
			<Text className="font-ui text-sm leading-6 text-text-muted">{INTRO}</Text>
			<View className="gap-2 sm:flex-row sm:items-center">
				{props.state.status === "empty" ? null : (
					<AppButton
						size="default"
						variant="primary"
						label="Create a backup"
						pending={props.isCreating}
						pendingLabel="Starting..."
						onPress={props.onCreateExport}
						disabled={live !== undefined}
						className="w-full sm:w-auto sm:px-6"
						leading={<AppIcon size={16} name="archive" className="text-accent-ink" />}
					/>
				)}
				<AppButton
					size="default"
					label="Restore from a backup"
					onPress={props.onOpenRestore}
					className="w-full sm:w-auto sm:px-6"
				/>
			</View>
			{live === undefined ? null : (
				<Text className="font-ui text-xs text-text-subtle">{LIVE_REASON}</Text>
			)}
			{props.createFailureDetail === undefined ? null : (
				<Text accessibilityRole="alert" className="font-ui text-sm text-danger">
					{props.createFailureDetail}
				</Text>
			)}
			{props.downloadFailureDetail === undefined ? null : (
				<Text accessibilityRole="alert" className="font-ui text-sm text-danger">
					{props.downloadFailureDetail}
				</Text>
			)}
			{live === undefined ? null : <LiveBackupRunCard run={live} nowMs={props.nowMs} />}
			{props.state.status === "empty" ? (
				<AppStatusState
					className="py-12"
					title="No backups yet"
					icon={<AppIcon size={40} name="archive" className="text-text-subtle" />}
					detail="Make a backup whenever you want a copy you keep yourself. Every backup and restore shows up here."
					action={
						<AppButton
							size="default"
							variant="primary"
							label="Create a backup"
							pending={props.isCreating}
							pendingLabel="Starting..."
							onPress={props.onCreateExport}
							className="w-full sm:w-auto sm:px-6"
						/>
					}
				/>
			) : (
				<View className="gap-2">
					<Text className="font-ui-medium text-[11px] uppercase tracking-[0.8px] text-text-subtle">
						Recent
					</Text>
					<View>
						{runs.map((run, index) => (
							<BackupHistoryRow
								run={run}
								key={run.id}
								nowMs={props.nowMs}
								isFirst={index === 0}
								onDownload={props.onDownload}
								onRequestDelete={props.onRequestDelete}
								isDownloading={props.downloadingRunId === run.id}
							/>
						))}
					</View>
				</View>
			)}
		</View>
	);
}
