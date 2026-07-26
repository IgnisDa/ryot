import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { BackupRun } from "@ryot/contract/modules/backups/schemas";
import { Exit } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";

import { backupArchiveDownloadOperation } from "@/api/backups";
import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { SettingsSectionFrame } from "@/modules/settings/settings-section-frame";
import { RUN_LIST_POLL_MS, useRunPolling } from "@/modules/ui/run/use-run-polling";
import { SearchParamModalHost, useSearchParamModal } from "@/modules/ui/search-param-modal";

import {
	backupRunReactivityKeys,
	backupRunsAtom,
	createBackupExportAtom,
	deleteBackupRunAtom,
} from "./atoms";
import { BACKUP_RESTORE_WIZARD_TITLE, BackupRestoreWizard } from "./backup-restore-wizard";
import { BackupRunDeleteSheet } from "./backup-run-delete-sheet";
import { BackupsView } from "./backups-view";
import { liveBackupRun } from "./run-presentation";
import { mapBackupRunList } from "./state";

const CREATE_FAILURE_DETAIL = "This backup could not be started. Try again.";

export function BackupsScreen() {
	const scope = useApiScope();
	const restoreModal = useSearchParamModal("restore");
	const runsAtom = backupRunsAtom(scope);
	const result = useAtomValue(runsAtom);
	const refresh = useAtomRefresh(runsAtom);
	const createExport = useAtomSet(createBackupExportAtom(scope), { mode: "promiseExit" });
	const deleteRun = useAtomSet(deleteBackupRunAtom(scope), { mode: "promiseExit" });
	const downloadArchive = backupArchiveDownloadOperation(scope);
	const [isCreating, setIsCreating] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [createCause, setCreateCause] = useState<unknown>();
	const [deleteCause, setDeleteCause] = useState<unknown>();
	const [pendingDelete, setPendingDelete] = useState<BackupRun | undefined>();
	const [downloadingRunId, setDownloadingRunId] = useState<string | undefined>();
	const [downloadFailure, setDownloadFailure] = useState<string | undefined>();
	const state = mapBackupRunList(result);
	const runs = state.status === "ready" ? state.runs : [];

	useInternalRequestFailureLogging(
		"backup runs query failed",
		AsyncResult.isFailure(result) ? result.cause : undefined,
	);
	useInternalRequestFailureLogging("backup export creation failed", createCause);
	useInternalRequestFailureLogging("backup run delete failed", deleteCause);
	useRunPolling({
		refresh,
		intervalMs: RUN_LIST_POLL_MS,
		enabled: liveBackupRun(runs) !== undefined,
	});

	async function startExport() {
		setIsCreating(true);
		setCreateCause(undefined);
		const exit = await createExport({ reactivityKeys: backupRunReactivityKeys(scope) });
		setIsCreating(false);
		if (Exit.isFailure(exit)) {
			setCreateCause(exit.cause);
		}
	}

	async function confirmDelete(run: BackupRun) {
		setIsDeleting(true);
		setDeleteCause(undefined);
		const exit = await deleteRun({
			params: { id: run.id },
			reactivityKeys: backupRunReactivityKeys(scope),
		});
		setIsDeleting(false);
		if (Exit.isFailure(exit)) {
			setDeleteCause(exit.cause);
			return;
		}
		setPendingDelete(undefined);
	}

	async function startDownload(run: BackupRun) {
		setDownloadingRunId(run.id);
		setDownloadFailure(undefined);
		const outcome = await downloadArchive(run.id);
		setDownloadingRunId(undefined);
		if (outcome.kind === "failed") {
			setDownloadFailure(outcome.message);
		}
	}

	return (
		<SettingsSectionFrame title="Backups">
			<BackupsView
				state={state}
				onRetry={refresh}
				nowMs={Date.now()}
				isCreating={isCreating}
				onOpenRestore={restoreModal.open}
				downloadingRunId={downloadingRunId}
				downloadFailureDetail={downloadFailure}
				onCreateExport={() => void startExport()}
				onDownload={(run) => void startDownload(run)}
				onRequestDelete={(run) => setPendingDelete(run)}
				createFailureDetail={createCause === undefined ? undefined : CREATE_FAILURE_DETAIL}
			/>
			{pendingDelete === undefined ? null : (
				<BackupRunDeleteSheet
					run={pendingDelete}
					pending={isDeleting}
					hasFailed={deleteCause !== undefined}
					onConfirm={() => void confirmDelete(pendingDelete)}
					onClose={() => {
						setDeleteCause(undefined);
						setPendingDelete(undefined);
					}}
				/>
			)}
			<SearchParamModalHost
				isOpen={restoreModal.isOpen}
				onClose={restoreModal.close}
				title={BACKUP_RESTORE_WIZARD_TITLE}
				closeLabel="Close the restore wizard"
			>
				<BackupRestoreWizard onRestoreStarted={refresh} onClose={restoreModal.close} />
			</SearchParamModalHost>
		</SettingsSectionFrame>
	);
}
