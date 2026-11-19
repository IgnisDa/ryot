import { useFormatters, useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { DestructiveConfirmation, Menu, type MenuItem } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ImportRunDetail } from "@ryot-app/ryotql-recipes/import-runs";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { ImportsApi } from "#/api/imports";
import { type ImportRunDetailState, ImportRunView } from "#/modules/imports/import-run-view";
import {
	canCancelImportRun,
	canDeleteImportRun,
	importRunCancelConfirmation,
	importRunDeleteConfirmation,
	importSourceName,
} from "#/modules/imports/run-presentation";
import {
	cancelImportRunMutation,
	deleteImportRunMutation,
	importRunQuery,
	importSourcesQuery,
	ImportsService,
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

const detailState = (detail: ImportRunDetail): undefined | ImportRunDetailState =>
	detail.run === undefined ? undefined : { status: "ready", run: detail.run };

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
					throw notFound();
				}
				const detail = yield* Effect.flatMap(ImportsService, (service) =>
					service.loadRun(context.ryot, { runId }),
				);
				if (detail.run === undefined) {
					throw notFound();
				}
				return { runId };
			}),
			{ signal: abortController.signal },
		),
});

function ImportRunLoaderError() {
	const t = useT();
	const router = useRouter();
	return (
		<ImportRunFrame title={t(kernelMessage("client.route.settings.import-run.title"))}>
			<ImportRunLoadErrorBody onRetry={() => void router.load()} />
		</ImportRunFrame>
	);
}

function ImportRunPending() {
	const t = useT();
	return (
		<ImportRunFrame title={t(kernelMessage("client.route.settings.import-run.title"))}>
			<StatusState
				className="py-16"
				detail={t(kernelMessage("client.route.settings.import-run.loading"))}
			/>
		</ImportRunFrame>
	);
}

function ImportRunFrame(props: {
	readonly title: Text;
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

function ImportRunNotFound() {
	const t = useT();
	return (
		<ImportRunFrame title={t(kernelMessage("client.route.settings.import-run.title"))}>
			<StatusState
				className="py-16"
				icon={<AppIcon size={36} name="search-x" className="text-text-subtle" />}
				title={t(kernelMessage("client.route.settings.import-run.not-found-title"))}
				detail={t(kernelMessage("client.route.settings.import-run.not-found-detail"))}
			/>
		</ImportRunFrame>
	);
}

function ImportRunLoadErrorBody(props: { readonly onRetry: () => void }) {
	const t = useT();
	return (
		<StatusState
			detailTone="danger"
			className="rounded-xl border border-border bg-surface p-6"
			title={t(kernelMessage("client.imports.run-load-error.title"))}
			detail={t(kernelMessage("client.imports.run-load-error.detail"))}
			action={
				<button
					type="button"
					onClick={props.onRetry}
					className="min-h-11 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-text"
				>
					{t(kernelMessage("common.action.try-again"))}
				</button>
			}
		/>
	);
}

function ImportRunRoute() {
	const formatters = useFormatters();
	const router = useRouter();
	const navigate = Route.useNavigate();
	const { runId } = Route.useLoaderData();
	const { scope, runtime, backInterceptors } = Route.useRouteContext();
	const menuTrigger = useRef<HTMLButtonElement>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const [confirmation, setConfirmation] = useState<null | "cancel" | "delete">(null);
	const [issueDownload, setIssueDownload] = useState<{
		readonly runId: string;
		readonly status: "failed" | "downloading";
	}>();
	const issueDownloadController = useRef<undefined | AbortController>(undefined);
	const t = useT();
	const detail = useRyotQuery(importRunQuery, { runId });
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
	const cancelPhrase = t(kernelMessage("client.route.settings.import-run.cancel-phrase"));
	const sourceNames = importSourceNames(sources.data ?? [], t);
	const run = state?.status === "ready" ? state.run : undefined;
	const title =
		run === undefined
			? t(kernelMessage("client.route.settings.import-run.title"))
			: importSourceName(t, run, sourceNames);
	const duration = run === undefined ? undefined : runDurationLabel(formatters, run, nowMs);

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

	useEffect(() => () => issueDownloadController.current?.abort(), []);

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
	const downloadIssues = () => {
		issueDownloadController.current?.abort();
		issueDownloadController.current = new AbortController();
		setIssueDownload({ runId, status: "downloading" });
		runtime.runFork(
			Effect.flatMap(ImportsApi, (api) => api.downloadIssues(scope, runId)).pipe(
				Effect.match({
					onSuccess: () => setIssueDownload(undefined),
					onFailure: () => setIssueDownload({ runId, status: "failed" }),
				}),
			),
			{ signal: issueDownloadController.current.signal },
		);
	};

	const menuItems: readonly MenuItem[] =
		run !== undefined && canCancelImportRun(run.status)
			? [
					{
						key: "cancel",
						destructive: true,
						label: t(kernelMessage("client.route.settings.import-run.cancel-action")),
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
						label: t(kernelMessage("client.route.settings.delete-record")),
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
				onDownloadIssues={downloadIssues}
				downloadIssuesFailed={issueDownload?.runId === runId && issueDownload.status === "failed"}
				isDownloadingIssues={
					issueDownload?.runId === runId && issueDownload.status === "downloading"
				}
			/>
		);
	} else if (detail.isPending) {
		body = (
			<StatusState
				className="py-16"
				detail={t(kernelMessage("client.route.settings.import-run.loading"))}
			/>
		);
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
							{t(
								kernelMessage("client.route.settings.import-run.meta", {
									timestamp: runTimestampLabel(formatters, run.createdAt),
								}),
							)}
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
							onClick={() => setMenuOpen((open) => !open)}
							aria-label={t(kernelMessage("client.route.settings.import-run.actions"))}
							className="flex size-11 shrink-0 items-center justify-center text-text-muted"
						>
							<AppIcon size={20} name="more-horizontal" />
						</button>
						{menuOpen && (
							<Menu
								items={menuItems}
								triggerRef={menuTrigger}
								activeIndex={activeIndex}
								onClose={() => setMenuOpen(false)}
								onActiveIndexChange={setActiveIndex}
								label={t(kernelMessage("client.route.settings.import-run.actions"))}
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
					pending={deletion.isPending}
					onConfirm={() => void confirmDelete()}
					detail={t(importRunDeleteConfirmation())}
					pendingLabel={t(kernelMessage("common.status.deleting"))}
					actionLabel={t(kernelMessage("client.route.settings.delete-record"))}
					title={t(kernelMessage("client.route.settings.import-run.delete-title"))}
					onClose={() => {
						deletion.reset();
						setConfirmation(null);
					}}
					errorMessage={
						deletion.status === "error"
							? t(kernelMessage("client.route.settings.record-delete-failed"))
							: undefined
					}
				/>
			)}
			{confirmation === "cancel" && run !== undefined && (
				<DestructiveConfirmation
					triggerRef={menuTrigger}
					pending={cancellation.isPending}
					confirmationPhrase={cancelPhrase}
					onConfirm={() => void confirmCancellation()}
					detail={t(importRunCancelConfirmation(cancelPhrase))}
					title={t(kernelMessage("client.route.settings.import-run.cancel-title"))}
					pendingLabel={t(kernelMessage("client.route.settings.import-run.cancelling"))}
					actionLabel={t(kernelMessage("client.route.settings.import-run.cancel-action"))}
					onClose={() => {
						cancellation.reset();
						setConfirmation(null);
					}}
					errorMessage={
						cancellation.status === "error"
							? t(kernelMessage("client.route.settings.import-run.cancel-failed"))
							: undefined
					}
				/>
			)}
		</ImportRunFrame>
	);
}
