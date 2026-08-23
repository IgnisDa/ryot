import {
	createRyotMutation,
	createRyotQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/client-sdk/react";
import type {
	BackupRun,
	BackupRunIdResponse,
	ListRunsResponse,
} from "@ryot-app/contract/modules/backups/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { backupArchiveFileName, BackupsApi } from "#/api/backups";
import type { KernelHostServices } from "#/host-services";
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

const backupRunsQuery = createRyotQuery<void, ListRunsResponse, KernelHostServices>(
	({ signal, hostServices }) =>
		hostServices.runtime.runPromise(
			Effect.flatMap(BackupsApi, (api) => api.listRuns(hostServices.scope)),
			{ signal },
		),
	{ cancelOnUnmount: true },
);

const createBackupMutation = createRyotMutation<void, BackupRunIdResponse, KernelHostServices>(
	async ({ client, signal, hostServices }) => {
		const result = await hostServices.runtime.runPromise(
			Effect.flatMap(BackupsApi, (api) => api.createExport(hostServices.scope)),
			{ signal },
		);
		client.mutationCompleted.hint();
		return result;
	},
);

const deleteBackupMutation = createRyotMutation<BackupRun, BackupRunIdResponse, KernelHostServices>(
	async ({ input, client, signal, hostServices }) => {
		const result = await hostServices.runtime.runPromise(
			Effect.flatMap(BackupsApi, (api) =>
				api.deleteRun(hostServices.scope, { params: { id: input.id } }),
			),
			{ signal },
		);
		client.mutationCompleted.hint();
		return result;
	},
);

export const Route = createFileRoute("/_authenticated/settings/backups")({
	component: BackupsRoute,
	validateSearch: (search) => ({
		restore: search.restore === true || search.restore === "true" ? true : undefined,
	}),
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
	const { restore } = Route.useSearch();
	const query = useRyotQuery(backupRunsQuery);
	const createMutation = useRyotMutation(createBackupMutation);
	const deleteMutation = useRyotMutation(deleteBackupMutation);
	const { scope, runtime } = Route.useRouteContext();
	const downloading = useRef<string | undefined>(undefined);
	const controller = useRef(new AbortController());
	const deleteTrigger = useRef<HTMLButtonElement | null>(null);
	const [downloadFailed, setDownloadFailed] = useState(false);
	const [downloadingRunId, setDownloadingRunId] = useState<string | undefined>();
	const [pendingDelete, setPendingDelete] = useState<BackupRun | undefined>();
	const state = query.data === undefined ? undefined : listState(query.data);
	const runs: readonly BackupRun[] = state?.status === "ready" ? state.runs : [];
	const live = liveBackupRun(runs);

	useEffect(() => () => controller.current.abort(), []);

	const wizard = useSearchParamModal({
		isOpen: restore === true,
		onCompleted: () => undefined,
		open: () => void navigate({ search: { restore: true } }),
		close: () => void navigate({ replace: true, search: { restore: undefined } }),
	});

	const startExport = useEffectEvent(async () => {
		if (live !== undefined) {
			return;
		}
		await createMutation.mutateAsync().catch(() => undefined);
	});

	const confirmDelete = useEffectEvent(async (run: BackupRun) => {
		if (!canDeleteBackupRun(run.status)) {
			setPendingDelete(undefined);
			return;
		}
		const deleted = await deleteMutation
			.mutateAsync(run)
			.then(() => true)
			.catch(() => false);
		if (!deleted) {
			return;
		}
		setPendingDelete(undefined);
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
		refresh: query.refetch,
		enabled: live !== undefined,
		intervalMs: RUN_LIST_POLL_MS,
	});

	if (state === undefined) {
		return query.isError ? <BackupsLoadError onRetry={query.refetch} /> : <BackupsPending />;
	}

	return (
		<BackupsFrame>
			<BackupsView
				state={state}
				nowMs={Date.now()}
				onOpenRestore={wizard.open}
				downloadingRunId={downloadingRunId}
				isCreating={createMutation.isPending}
				onCreateExport={() => void startExport()}
				onDownload={(run) => void startDownload(run)}
				downloadFailureDetail={downloadFailed ? DOWNLOAD_FAILURE_DETAIL : undefined}
				createFailureDetail={createMutation.error === null ? undefined : CREATE_FAILURE_DETAIL}
				onRequestDelete={(run, trigger) => {
					deleteMutation.reset();
					deleteTrigger.current = trigger;
					setPendingDelete(run);
				}}
			/>
			{pendingDelete === undefined ? null : (
				<DestructiveConfirmation
					pendingLabel="Deleting..."
					triggerRef={deleteTrigger}
					actionLabel="Delete record"
					title="Delete this backup record?"
					pending={deleteMutation.isPending}
					detail={backupRunDeleteConfirmation(pendingDelete)}
					onConfirm={() => void confirmDelete(pendingDelete)}
					errorMessage={deleteMutation.error === null ? undefined : DELETE_FAILURE_DETAIL}
					onClose={() => {
						deleteMutation.reset();
						setPendingDelete(undefined);
					}}
				/>
			)}
			{restore === true && (
				<BackupRestoreWizard
					onClose={wizard.close}
					disabled={live !== undefined || createMutation.isPending}
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

function BackupsLoadError(props: { readonly onRetry: () => void }) {
	return (
		<BackupsFrame>
			<LoadErrorState
				onRetry={props.onRetry}
				title={BACKUP_LOAD_ERROR.title}
				detail={BACKUP_LOAD_ERROR.detail}
			/>
		</BackupsFrame>
	);
}
