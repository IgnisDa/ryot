import { useRyotMutation, useRyotQuery } from "@ryot-app/client-sdk/react";
import { DestructiveConfirmation, Menu, type MenuItem } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import type { ImportRunDetail } from "@ryot-app/ryotql-recipes/import-runs";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ImportsApi } from "#/api/imports";
import { ImportRunView, type ImportRunDetailState } from "#/modules/imports/import-run-view";
import {
	canDeleteImportRun,
	canCancelImportRun,
	importRunCancelConfirmation,
	importRunDeleteConfirmation,
	importSourceName,
} from "#/modules/imports/run-presentation";
import {
	IMPORT_FAILURES_PAGE_SIZE,
	ImportsService,
	cancelImportRunMutation,
	deleteImportRunMutation,
	importRunQuery,
	importSourcesQuery,
} from "#/modules/imports/service";
import { importSourceNames } from "#/modules/imports/source-selection";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import {
	isTerminalRunStatus,
	runDurationLabel,
	runTimestampLabel,
} from "#/modules/ui/run/run-status";
import { RunStatusPill } from "#/modules/ui/run/run-status-pill";
import { RUN_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";
import { StatusState } from "#/modules/ui/status-state";
import { useNowMs } from "#/modules/ui/use-now-ms";

const detailState = (detail: ImportRunDetail): ImportRunDetailState | undefined =>
	detail.run === undefined
		? undefined
		: {
				status: "ready",
				run: detail.run,
				failures: detail.failures.items,
				hasMoreFailures: detail.failures.pageInfo.hasMore,
			};

export const Route = createFileRoute("/_authenticated/settings/import-data/$runId")({
	component: ImportRunRoute,
	pendingComponent: ImportRunPending,
	errorComponent: ImportRunLoaderError,
	notFoundComponent: ImportRunNotFound,
	loader: ({ params, context, abortController }) =>
		context.runtime.runPromise(
			Effect.gen(function* () {
				const runId = params.runId.trim();
				if (runId.length === 0) {
					// oxlint-disable-next-line typescript/only-throw-error
					throw notFound();
				}
				const detail = yield* Effect.flatMap(ImportsService, (service) =>
					service.loadRun(context.ryot, { runId, failureLimit: IMPORT_FAILURES_PAGE_SIZE }),
				);
				if (detail.run === undefined) {
					// oxlint-disable-next-line typescript/only-throw-error
					throw notFound();
				}
				return { runId };
			}),
			{ signal: abortController.signal },
		),
});

function ImportRunFrame(props: {
	readonly title: string;
	readonly meta?: ReactNode;
	readonly actions?: ReactNode;
	readonly children: ReactNode;
}) {
	return (
		<SettingsFrame
			meta={props.meta}
			title={props.title}
			actions={props.actions}
			backFallbackHref="/settings/import-data"
		>
			{props.children}
		</SettingsFrame>
	);
}

function ImportRunRoute() {
	const router = useRouter();
	const navigate = Route.useNavigate();
	const { runId } = Route.useLoaderData();
	const { scope, runtime, backInterceptors } = Route.useRouteContext();
	const menuTrigger = useRef<HTMLButtonElement>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const [confirmation, setConfirmation] = useState<"cancel" | "delete" | null>(null);
	const [failureLimit, setFailureLimit] = useState(IMPORT_FAILURES_PAGE_SIZE);
	const [failureDownload, setFailureDownload] = useState<{
		readonly runId: string;
		readonly status: "downloading" | "failed";
	}>();
	const failureDownloadController = useRef<AbortController | undefined>(undefined);
	const detail = useRyotQuery(importRunQuery, { runId, failureLimit });
	const sources = useRyotQuery(importSourcesQuery);
	const deletion = useRyotMutation(deleteImportRunMutation);
	const cancellation = useRyotMutation(cancelImportRunMutation);
	const [retainedDetail, setRetainedDetail] = useState<{
		readonly runId: string;
		readonly detail: ImportRunDetail;
	}>();
	if (
		detail.data !== undefined &&
		(retainedDetail?.runId !== runId || retainedDetail.detail !== detail.data)
	) {
		setRetainedDetail({ runId, detail: detail.data });
	}
	const displayedDetail =
		detail.data ?? (retainedDetail?.runId === runId ? retainedDetail.detail : undefined);
	const state = displayedDetail === undefined ? undefined : detailState(displayedDetail);
	const nowMs = useNowMs(RUN_POLL_MS);
	const sourceNames = importSourceNames(sources.data ?? []);
	const run = state?.status === "ready" ? state.run : undefined;
	const title = run === undefined ? "Import" : importSourceName(run.source, sourceNames);
	const duration = run === undefined ? undefined : runDurationLabel(run, nowMs);

	useRunPolling({
		intervalMs: RUN_POLL_MS,
		refresh: detail.refetch,
		enabled: run !== undefined && !isTerminalRunStatus(run.status),
	});

	useEffect(() => {
		if (!menuOpen && confirmation === null) {
			return undefined;
		}
		return backInterceptors.register(() => {
			if (deletion.isPending || cancellation.isPending) {
				return true;
			}
			setMenuOpen(false);
			setConfirmation(null);
			return true;
		});
	}, [backInterceptors, cancellation.isPending, confirmation, deletion.isPending, menuOpen]);

	useEffect(() => () => failureDownloadController.current?.abort(), []);

	const confirmDelete = () => {
		deletion.reset();
		return Effect.runPromise(
			deletion.mutateEffect(runId).pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						setConfirmation(null);
						if (router.history.canGoBack()) {
							router.history.back();
							return;
						}
						void navigate({
							replace: true,
							to: "/settings/import-data",
							search: { start: undefined },
						});
					}),
				),
				Effect.ignoreCause,
				Effect.asVoid,
			),
		);
	};
	const confirmCancellation = () => {
		cancellation.reset();
		return Effect.runPromise(
			cancellation.mutateEffect(runId).pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						setConfirmation(null);
						detail.refetch();
					}),
				),
				Effect.ignoreCause,
				Effect.asVoid,
			),
		);
	};
	const downloadFailures = () => {
		failureDownloadController.current?.abort();
		failureDownloadController.current = new AbortController();
		setFailureDownload({ runId, status: "downloading" });
		runtime.runFork(
			Effect.flatMap(ImportsApi, (api) => api.downloadFailures(scope, runId)).pipe(
				Effect.match({
					onSuccess: () => setFailureDownload(undefined),
					onFailure: () => setFailureDownload({ runId, status: "failed" }),
				}),
			),
			{ signal: failureDownloadController.current.signal },
		);
	};

	const menuItems: readonly MenuItem[] =
		run !== undefined && canCancelImportRun(run.status)
			? [
					{
						key: "cancel",
						destructive: true,
						label: "Cancel import",
						onSelect: () => {
							setMenuOpen(false);
							cancellation.reset();
							setConfirmation("cancel");
						},
					},
				]
			: [
					{
						key: "delete",
						destructive: true,
						label: "Delete record",
						onSelect: () => {
							setMenuOpen(false);
							deletion.reset();
							setConfirmation("delete");
						},
					},
				];
	let body: ReactNode;
	if (state !== undefined) {
		body = (
			<ImportRunView
				state={state}
				onRetry={detail.refetch}
				isLoadingMore={detail.isFetching}
				onDownloadFailures={downloadFailures}
				onShowMore={() => setFailureLimit((current) => current + IMPORT_FAILURES_PAGE_SIZE)}
				downloadFailuresFailed={
					failureDownload?.runId === runId && failureDownload.status === "failed"
				}
				isDownloadingFailures={
					failureDownload?.runId === runId && failureDownload.status === "downloading"
				}
			/>
		);
	} else if (detail.isPending) {
		body = <StatusState className="py-16" detail="Loading this import..." />;
	} else {
		body = <ImportRunLoadErrorBody onRetry={detail.refetch} />;
	}

	return (
		<ImportRunFrame
			title={title}
			meta={
				run === undefined ? undefined : (
					<div className="flex flex-col gap-2">
						<p className="text-xs text-text-subtle">
							{`Import · ${runTimestampLabel(run.createdAt)}`}
						</p>
						<div className="flex items-center gap-2">
							<RunStatusPill status={run.status} />
							{duration === undefined ? null : (
								<span className="text-xs tabular-nums text-text-subtle">{duration}</span>
							)}
						</div>
					</div>
				)
			}
			actions={
				run !== undefined && (canDeleteImportRun(run.status) || canCancelImportRun(run.status)) ? (
					<>
						<button
							type="button"
							ref={menuTrigger}
							aria-haspopup="menu"
							aria-expanded={menuOpen}
							aria-label="Import actions"
							onClick={() => setMenuOpen((open) => !open)}
							className="flex size-11 shrink-0 items-center justify-center text-text-muted"
						>
							<AppIcon size={20} name="more-horizontal" />
						</button>
						{menuOpen && (
							<Menu
								items={menuItems}
								label="Import actions"
								triggerRef={menuTrigger}
								activeIndex={activeIndex}
								onClose={() => setMenuOpen(false)}
								onActiveIndexChange={setActiveIndex}
							/>
						)}
					</>
				) : undefined
			}
		>
			{body}
			{confirmation === "delete" && run !== undefined && (
				<DestructiveConfirmation
					triggerRef={menuTrigger}
					pendingLabel="Deleting..."
					actionLabel="Delete record"
					pending={deletion.isPending}
					title="Delete this import record?"
					onConfirm={() => void confirmDelete()}
					detail={importRunDeleteConfirmation(run)}
					onClose={() => {
						deletion.reset();
						setConfirmation(null);
					}}
					errorMessage={
						deletion.status === "error" ? "This record could not be deleted. Try again." : undefined
					}
				/>
			)}
			{confirmation === "cancel" && run !== undefined && (
				<DestructiveConfirmation
					triggerRef={menuTrigger}
					actionLabel="Cancel import"
					title="Cancel this import?"
					pendingLabel="Cancelling..."
					pending={cancellation.isPending}
					detail={importRunCancelConfirmation}
					confirmationPhrase="Cancel this import"
					onConfirm={() => void confirmCancellation()}
					onClose={() => {
						cancellation.reset();
						setConfirmation(null);
					}}
					errorMessage={
						cancellation.status === "error"
							? "This import could not be cancelled. Try again."
							: undefined
					}
				/>
			)}
		</ImportRunFrame>
	);
}

function ImportRunPending() {
	return (
		<ImportRunFrame title="Import">
			<StatusState className="py-16" detail="Loading this import..." />
		</ImportRunFrame>
	);
}

function ImportRunLoaderError() {
	const router = useRouter();
	return (
		<ImportRunFrame title="Import">
			<ImportRunLoadErrorBody onRetry={() => void router.load()} />
		</ImportRunFrame>
	);
}

function ImportRunLoadErrorBody(props: { readonly onRetry: () => void }) {
	return (
		<StatusState
			detailTone="danger"
			title="Unable to load this import"
			className="rounded-xl border border-border bg-surface p-6"
			detail="This import could not be loaded. Check the server and try again."
			action={
				<button
					type="button"
					onClick={props.onRetry}
					className="min-h-11 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-text"
				>
					Try again
				</button>
			}
		/>
	);
}

function ImportRunNotFound() {
	return (
		<ImportRunFrame title="Import">
			<StatusState
				className="py-16"
				title="Import not found"
				detail="This import is no longer on your server."
				icon={<AppIcon size={36} name="search-x" className="text-text-subtle" />}
			/>
		</ImportRunFrame>
	);
}
