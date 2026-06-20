import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { BackupRun } from "@ryot/contract/modules/backups/schemas";
import { Exit } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useRef, useState } from "react";

import { backupArchiveDownloadOperation, pruneBackupDownloadCache } from "@/api/backups";
import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { useTrackEvent } from "@/modules/analytics/state";
import { DestructiveActionSheet } from "@/modules/ui/destructive-action-sheet";
import { RUN_LIST_POLL_MS, useRunPolling } from "@/modules/ui/run/use-run-polling";
import { SearchParamModalHost, useSearchParamModal } from "@/modules/ui/search-param-modal";
import { SectionFrame } from "@/modules/ui/section-frame";

import {
	backupRunReactivityKeys,
	backupRunsAtom,
	createBackupExportAtom,
	deleteBackupRunAtom,
} from "../atoms";
import { BACKUP_RESTORE_WIZARD_TITLE, BackupRestoreWizard } from "../restore/wizard";
import { backupRunDeleteConfirmation, canDeleteBackupRun, liveBackupRun } from "./presentation";
import { mapBackupRunList, withBackupDownloadLock } from "./state";
import { BackupsView } from "./view";

const CREATE_FAILURE_DETAIL = "This backup could not be started. Try again.";

export function BackupsScreen() {
	const scope = useApiScope();
	const restoreModal = useSearchParamModal("restore");
	const runsAtom = backupRunsAtom(scope);
	const result = useAtomValue(runsAtom);
	const refresh = useAtomRefresh(runsAtom);
	const trackEvent = useTrackEvent();
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
	const downloadPending = useRef<string | undefined>(undefined);
	const state = mapBackupRunList(result);
	const runs = state.status === "ready" ? state.runs : [];
	const live = liveBackupRun(runs);

	useInternalRequestFailureLogging(
		"backup runs query failed",
		AsyncResult.isFailure(result) ? result.cause : undefined,
	);
	useInternalRequestFailureLogging("backup export creation failed", createCause);
	useInternalRequestFailureLogging("backup run delete failed", deleteCause);
	useEffect(() => {
		pruneBackupDownloadCache();
	}, []);
	useRunPolling({
		refresh,
		intervalMs: RUN_LIST_POLL_MS,
		enabled: live !== undefined,
	});

	async function startExport() {
		if (live !== undefined) {
			return;
		}
		setIsCreating(true);
		setCreateCause(undefined);
		const exit = await createExport({ reactivityKeys: backupRunReactivityKeys(scope) });
		setIsCreating(false);
		if (Exit.isFailure(exit)) {
			setCreateCause(exit.cause);
			return;
		}
		trackEvent("Create Backup");
	}

	async function confirmDelete(run: BackupRun) {
		if (!canDeleteBackupRun(run.status)) {
			setPendingDelete(undefined);
			return;
		}
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
		await withBackupDownloadLock(downloadPending, run.id, async () => {
			setDownloadingRunId(run.id);
			setDownloadFailure(undefined);
			try {
				const outcome = await downloadArchive(run.id);
				if (outcome.kind === "failed") {
					setDownloadFailure(outcome.message);
				}
			} finally {
				setDownloadingRunId(undefined);
			}
		});
	}

	return (
		<SectionFrame title="Backups">
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
				onRequestDelete={(run) => {
					if (canDeleteBackupRun(run.status)) {
						setPendingDelete(run);
					}
				}}
				createFailureDetail={createCause === undefined ? undefined : CREATE_FAILURE_DETAIL}
			/>
			{pendingDelete === undefined ? null : (
				<DestructiveActionSheet
					snapPoints={[320]}
					pending={isDeleting}
					pendingLabel="Deleting..."
					actionLabel="Delete record"
					title="Delete this backup record?"
					onConfirm={() => void confirmDelete(pendingDelete)}
					detail={backupRunDeleteConfirmation(pendingDelete)}
					actionDisabled={!canDeleteBackupRun(pendingDelete.status)}
					errorMessage={
						deleteCause === undefined ? undefined : "This record could not be deleted. Try again."
					}
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
				<BackupRestoreWizard
					onRestoreStarted={refresh}
					onClose={restoreModal.close}
					disabled={live !== undefined || isCreating}
				/>
			</SearchParamModalHost>
		</SectionFrame>
	);
}
