import type { BackupRun, ListRunsResponse } from "@ryot-app/contract/modules/backups/schemas";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { backupArchiveFileName, BackupsApi } from "#/api/backups";
import {
	BACKUP_LOAD_ERROR,
	BackupsView,
	type BackupRunListState,
} from "#/modules/backups/backups-view";
import {
	backupRunDeleteConfirmation,
	canDeleteBackupRun,
	liveBackupRun,
} from "#/modules/backups/presentation";
import { BackupRestoreWizard } from "#/modules/backups/restore-wizard";
import { saveBackupArchive } from "#/modules/backups/save-archive";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { DestructiveConfirmation } from "#/modules/ui/destructive-confirmation";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { RUN_LIST_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";
import { useSearchParamModal } from "#/modules/ui/search-param-modal";
import { StatusState } from "#/modules/ui/status-state";

const CREATE_FAILURE_DETAIL = "This backup could not be started. Try again.";

const DELETE_FAILURE_DETAIL = "This record could not be deleted. Try again.";

const DOWNLOAD_FAILURE_DETAIL = "Could not download this backup. Try again.";

const listState = (response: ListRunsResponse): BackupRunListState =>
	response.items.length === 0 ? { status: "empty" } : { status: "ready", runs: response.items };

export const Route = createFileRoute("/_authenticated/settings/backups")({
	component: BackupsRoute,
	errorComponent: BackupsLoadError,
	pendingComponent: BackupsPending,
	validateSearch: (search) => ({
		restore: search.restore === true || search.restore === "true" ? true : undefined,
	}),
	loader: ({ abortController, context }) =>
		context.runtime.runPromise(
			Effect.flatMap(BackupsApi, (api) => api.listRuns(context.scope)),
			{ signal: abortController.signal },
		),
});

function BackupsFrame(props: { readonly children: ReactNode }) {
	return (
		<SettingsFrame title="Backups" backFallbackHref="/settings">
			{props.children}
		</SettingsFrame>
	);
}

function BackupsRoute() {
	const navigate = Route.useNavigate();
	const loaded = Route.useLoaderData();
	const { restore } = Route.useSearch();
	const { runtime, scope } = Route.useRouteContext();
	const downloading = useRef<string | undefined>(undefined);
	const controller = useRef(new AbortController());
	const deleteTrigger = useRef<HTMLButtonElement | null>(null);
	const [isCreating, setIsCreating] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);
	const [createFailed, setCreateFailed] = useState(false);
	const [deleteFailed, setDeleteFailed] = useState(false);
	const [state, setState] = useState(() => listState(loaded));
	const [downloadFailed, setDownloadFailed] = useState(false);
	const [downloadingRunId, setDownloadingRunId] = useState<string | undefined>();
	const [pendingDelete, setPendingDelete] = useState<BackupRun | undefined>();
	const runs = state.status === "ready" ? state.runs : [];
	const live = liveBackupRun(runs);

	useEffect(() => () => controller.current.abort(), []);

	const reload = useEffectEvent(async () => {
		const outcome = await runtime.runPromise(
			Effect.flatMap(BackupsApi, (api) => api.listRuns(scope)).pipe(
				Effect.match({ onFailure: () => undefined, onSuccess: listState }),
			),
			{ signal: controller.current.signal },
		);
		setState(outcome ?? { status: "failed" });
	});

	const wizard = useSearchParamModal({
		isOpen: restore === true,
		onCompleted: () => void reload(),
		open: () => void navigate({ search: { restore: true } }),
		close: () => void navigate({ replace: true, search: { restore: undefined } }),
	});

	const startExport = useEffectEvent(async () => {
		if (live !== undefined) {
			return;
		}
		setIsCreating(true);
		setCreateFailed(false);
		const started = await runtime.runPromise(
			Effect.flatMap(BackupsApi, (api) => api.createExport(scope)).pipe(
				Effect.match({ onFailure: () => false, onSuccess: () => true }),
			),
			{ signal: controller.current.signal },
		);
		setIsCreating(false);
		setCreateFailed(!started);
		if (started) {
			await reload();
		}
	});

	const confirmDelete = useEffectEvent(async (run: BackupRun) => {
		if (!canDeleteBackupRun(run.status)) {
			setPendingDelete(undefined);
			return;
		}
		setIsDeleting(true);
		setDeleteFailed(false);
		const deleted = await runtime.runPromise(
			Effect.flatMap(BackupsApi, (api) => api.deleteRun(scope, { params: { id: run.id } })).pipe(
				Effect.match({ onFailure: () => false, onSuccess: () => true }),
			),
			{ signal: controller.current.signal },
		);
		setIsDeleting(false);
		setDeleteFailed(!deleted);
		if (!deleted) {
			return;
		}
		setPendingDelete(undefined);
		await reload();
	});

	const startDownload = useEffectEvent(async (run: BackupRun) => {
		if (downloading.current !== undefined) {
			return;
		}
		downloading.current = run.id;
		setDownloadFailed(false);
		setDownloadingRunId(run.id);
		const blob = await runtime.runPromise(
			Effect.flatMap(BackupsApi, (api) => api.downloadArchive(scope, run.id)).pipe(
				Effect.match({ onFailure: () => undefined, onSuccess: (archive) => archive }),
			),
			{ signal: controller.current.signal },
		);
		downloading.current = undefined;
		setDownloadingRunId(undefined);
		if (blob === undefined) {
			setDownloadFailed(true);
			return;
		}
		saveBackupArchive(blob, backupArchiveFileName(run.id));
	});

	useRunPolling({
		intervalMs: RUN_LIST_POLL_MS,
		refresh: () => void reload(),
		enabled: live !== undefined,
	});

	return (
		<BackupsFrame>
			<BackupsView
				state={state}
				nowMs={Date.now()}
				isCreating={isCreating}
				onRetry={() => void reload()}
				onOpenRestore={wizard.open}
				downloadingRunId={downloadingRunId}
				onCreateExport={() => void startExport()}
				onDownload={(run) => void startDownload(run)}
				createFailureDetail={createFailed ? CREATE_FAILURE_DETAIL : undefined}
				downloadFailureDetail={downloadFailed ? DOWNLOAD_FAILURE_DETAIL : undefined}
				onRequestDelete={(run, trigger) => {
					deleteTrigger.current = trigger;
					setPendingDelete(run);
				}}
			/>
			{pendingDelete === undefined ? null : (
				<DestructiveConfirmation
					pending={isDeleting}
					pendingLabel="Deleting..."
					triggerRef={deleteTrigger}
					actionLabel="Delete record"
					title="Delete this backup record?"
					detail={backupRunDeleteConfirmation(pendingDelete)}
					onConfirm={() => void confirmDelete(pendingDelete)}
					errorMessage={deleteFailed ? DELETE_FAILURE_DETAIL : undefined}
					onClose={() => {
						setDeleteFailed(false);
						setPendingDelete(undefined);
					}}
				/>
			)}
			{restore === true && (
				<BackupRestoreWizard
					onClose={wizard.close}
					onRestoreStarted={wizard.markCompleted}
					disabled={live !== undefined || isCreating}
				/>
			)}
		</BackupsFrame>
	);
}

function BackupsPending() {
	return (
		<BackupsFrame>
			<StatusState className="py-16" detail="Loading your backups..." />
		</BackupsFrame>
	);
}

function BackupsLoadError() {
	const router = useRouter();
	return (
		<BackupsFrame>
			<LoadErrorState
				title={BACKUP_LOAD_ERROR.title}
				detail={BACKUP_LOAD_ERROR.detail}
				onRetry={() => void router.invalidate()}
			/>
		</BackupsFrame>
	);
}
