import type { BackupRunIdResponse } from "@ryot-app/contract/modules/backups/schemas";
import {
	createRyotMutation,
	createRyotQuery,
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
	useRyotMutation,
} from "@ryot-app/plugin-client-sdk/react";
import { DestructiveConfirmation, LoadMoreButton } from "@ryot-app/plugin-ui-sdk";
import {
	type BackupRunItem,
	type BackupRunsPage,
	backupRunsRecipe,
} from "@ryot-app/ryotql-recipes/backups";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { AuthenticatedApiError } from "#/api/authenticated";
import { BackupsApi } from "#/api/backups";
import type { KernelHostServices } from "#/host-services";
import { AuthService } from "#/modules/auth/service";
import {
	BACKUP_LOAD_ERROR,
	type BackupRunListState,
	BackupsView,
} from "#/modules/backups/backups-view";
import {
	backupRunDeleteConfirmation,
	canDeleteBackupRun,
	liveBackupRun,
} from "#/modules/backups/presentation";
import { BackupRestoreWizard } from "#/modules/backups/restore-wizard";
import { DEMO_PROTECTION_MESSAGE, useIsDemoSession } from "#/modules/demo-protection";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { RUN_LIST_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";
import { useSearchParamModal } from "#/modules/ui/search-param-modal";
import { StatusState } from "#/modules/ui/status-state";
import { RELATIVE_TIME_REFRESH_MS, useNowMs } from "#/modules/ui/use-now-ms";

const CREATE_FAILURE_DETAIL = "This backup could not be started. Try again.";

const DELETE_FAILURE_DETAIL = "This record could not be deleted. Try again.";

const DOWNLOAD_FAILURE_DETAIL = "Could not download this backup. Try again.";

const PAGE_SIZE = 50;

const backupRunsQuery = createRyotQuery<string | undefined, BackupRunsPage>(
	({ client, input: after }) => client.data.query(backupRunsRecipe({ after, limit: PAGE_SIZE })),
);

const createBackupMutation = createRyotMutation<
	void,
	BackupRunIdResponse,
	KernelHostServices,
	AuthenticatedApiError
>(({ client, hostServices }) =>
	hostServices.runtime
		.runSync(BackupsApi)
		.createExport(hostServices.scope)
		.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
);

const deleteBackupMutation = createRyotMutation<
	BackupRunItem,
	BackupRunIdResponse,
	KernelHostServices,
	AuthenticatedApiError
>(({ input, client, hostServices }) =>
	hostServices.runtime
		.runSync(BackupsApi)
		.deleteRun(hostServices.scope, { params: { id: input.id } })
		.pipe(Effect.tap(() => Effect.sync(client.mutationCompleted.hint))),
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
	const { server, runtime } = Route.useRouteContext();
	const isDemo = useIsDemoSession(runtime.runSync(AuthService).session(server));
	return isDemo ? <BackupsDemoProtected /> : <BackupsStandard />;
}

function BackupsDemoProtected() {
	return (
		<BackupsFrame>
			<StatusState
				className="py-16"
				title="Backups are unavailable"
				detail={DEMO_PROTECTION_MESSAGE}
			/>
		</BackupsFrame>
	);
}

function BackupsStandard() {
	const navigate = Route.useNavigate();
	const { restore } = Route.useSearch();
	const pagination = useRyotInfiniteQuery(backupRunsQuery, undefined, {
		initialPageParam: undefined,
		getNextPageParam: nextPageCursor,
		getPageInput: (_, after: string | undefined) => after,
	});
	const createMutation = useRyotMutation(createBackupMutation);
	const deleteMutation = useRyotMutation(deleteBackupMutation);
	const { scope, runtime } = Route.useRouteContext();
	const downloading = useRef<string | undefined>(undefined);
	const controller = useRef(new AbortController());
	const deleteTrigger = useRef<HTMLButtonElement | null>(null);
	const [downloadFailed, setDownloadFailed] = useState(false);
	const [downloadingRunId, setDownloadingRunId] = useState<string | undefined>();
	const [pendingDelete, setPendingDelete] = useState<BackupRunItem | undefined>();
	const firstPage = pagination.pages.at(0);
	const runs = paginationItems(
		pagination.pages,
		(page) => page.items,
		(run) => run.id,
	);
	let state: BackupRunListState | undefined;
	if (firstPage !== undefined) {
		state = runs.length === 0 ? { status: "empty" } : { runs, status: "ready" };
	}
	const live = liveBackupRun(runs);
	const nowMs = useNowMs(RELATIVE_TIME_REFRESH_MS);

	useEffect(() => () => controller.current.abort(), []);

	const wizard = useSearchParamModal({
		isOpen: restore === true,
		onCompleted: () => undefined,
		open: () => void navigate({ search: { restore: true } }),
		close: () => void navigate({ replace: true, search: { restore: undefined } }),
	});

	const startExport = () => {
		return Effect.runPromise(
			Effect.gen(function* () {
				if (live !== undefined) {
					return;
				}
				yield* createMutation.mutateEffect().pipe(Effect.ignoreCause);
			}),
		);
	};

	const confirmDelete = (run: BackupRunItem) => {
		return Effect.runPromise(
			Effect.gen(function* () {
				if (!canDeleteBackupRun(run.status)) {
					setPendingDelete(undefined);
					return;
				}
				const deleted = yield* deleteMutation.mutateEffect(run).pipe(
					Effect.as(true),
					Effect.catchCause(() => Effect.succeed(false)),
				);
				if (!deleted) {
					return;
				}
				setPendingDelete(undefined);
			}),
		);
	};

	const startDownload = (run: BackupRunItem) => {
		if (downloading.current !== undefined) {
			return;
		}
		downloading.current = run.id;
		setDownloadFailed(false);
		setDownloadingRunId(run.id);
		runtime.runFork(
			Effect.flatMap(BackupsApi, (api) => api.downloadArchive(scope, run.id)).pipe(
				Effect.match({
					onSuccess: () => {
						downloading.current = undefined;
						setDownloadingRunId(undefined);
					},
					onFailure: () => {
						downloading.current = undefined;
						setDownloadingRunId(undefined);
						setDownloadFailed(true);
					},
				}),
			),
			{ signal: controller.current.signal },
		);
	};

	useRunPolling({
		refresh: pagination.refetch,
		enabled: live !== undefined,
		intervalMs: RUN_LIST_POLL_MS,
	});

	if (state === undefined) {
		return pagination.isError ? (
			<BackupsLoadError onRetry={pagination.refetch} />
		) : (
			<BackupsPending />
		);
	}

	return (
		<BackupsFrame>
			<BackupsView
				state={state}
				nowMs={nowMs}
				onDownload={startDownload}
				onOpenRestore={wizard.open}
				downloadingRunId={downloadingRunId}
				isCreating={createMutation.isPending}
				onCreateExport={() => void startExport()}
				downloadFailureDetail={downloadFailed ? DOWNLOAD_FAILURE_DETAIL : undefined}
				createFailureDetail={createMutation.error === null ? undefined : CREATE_FAILURE_DETAIL}
				onRequestDelete={(run, trigger) => {
					deleteMutation.reset();
					deleteTrigger.current = trigger;
					setPendingDelete(run);
				}}
			/>
			{pagination.hasNextPage && pagination.errorOperation !== "append" && (
				<div className="grid justify-items-center gap-2">
					<LoadMoreButton
						type="button"
						label="Load more backups"
						loadingLabel="Loading..."
						onClick={pagination.fetchNextPage}
						isFetchingNextPage={pagination.isFetchingNextPage}
						disabled={pagination.isFetching && !pagination.isFetchingNextPage}
					/>
				</div>
			)}
			{pagination.errorOperation === "append" && (
				<div className="grid justify-items-center gap-2">
					<p role="alert" className="text-sm text-danger">
						Could not load more backups. Try again.
					</p>
					<LoadMoreButton
						type="button"
						label="Load more backups"
						loadingLabel="Loading..."
						onClick={pagination.retry}
						isFetchingNextPage={pagination.isFetchingNextPage}
					/>
				</div>
			)}
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
