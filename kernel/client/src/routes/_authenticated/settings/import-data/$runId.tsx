import { useRyot } from "@ryot-app/client-sdk/react";
import { Menu, type MenuItem } from "@ryot-app/client-ui-sdk";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import type { ImportRunDetail } from "@ryot-app/ryotql-recipes/import-runs";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { ImportsApi } from "#/api/imports";
import { createKernelRyotClient } from "#/api/ryot-client";
import { ImportRunDeleteConfirmation } from "#/modules/imports/delete-confirmation";
import { ImportRunView, type ImportRunDetailState } from "#/modules/imports/import-run-view";
import {
	canDeleteImportRun,
	importRunDeleteConfirmation,
	importSourceName,
} from "#/modules/imports/run-presentation";
import { IMPORT_FAILURES_PAGE_SIZE, ImportsService } from "#/modules/imports/service";
import { importSourceNames } from "#/modules/imports/source-selection";
import { AppIcon } from "#/modules/navigation/app-icon";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import {
	isTerminalRunStatus,
	runDurationLabel,
	runTimestampLabel,
} from "#/modules/ui/run/run-status";
import { RunStatusPill } from "#/modules/ui/run/run-status-pill";
import { RUN_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";
import { StatusState } from "#/modules/ui/status-state";

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
	errorComponent: ImportRunLoadError,
	pendingComponent: ImportRunPending,
	notFoundComponent: ImportRunNotFound,
	loader: async ({ abortController, context, params }) => {
		const trimmed = params.runId.trim();
		if (trimmed.length === 0) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
		const ryot = createKernelRyotClient(context.runtime, context.scope, context.theme);
		const [detail, sources] = await Promise.all([
			context.runtime.runPromise(
				Effect.flatMap(ImportsService, (service) =>
					service.loadRun(ryot, {
						runId: trimmed,
						failureLimit: IMPORT_FAILURES_PAGE_SIZE,
					}),
				),
				{ signal: abortController.signal },
			),
			context.runtime.runPromise(
				Effect.flatMap(ImportsApi, (api) => api.listSources(context.scope)).pipe(
					Effect.match({ onSuccess: (listed) => listed, onFailure: () => [] }),
				),
				{ signal: abortController.signal },
			),
		]);
		const state = detailState(detail);
		if (state === undefined) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
		return { sources, state };
	},
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
	const ryot = useRyot();
	const router = useRouter();
	const navigate = Route.useNavigate();
	const loaded = Route.useLoaderData();
	const { runId } = Route.useParams();
	const { backInterceptors, runtime, scope } = Route.useRouteContext();
	const menuTrigger = useRef<HTMLButtonElement>(null);
	const controller = useRef(new AbortController());
	const [deleting, setDeleting] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const [isConfirming, setIsConfirming] = useState(false);
	const [deleteFailed, setDeleteFailed] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [state, setState] = useState<ImportRunDetailState>(loaded.state);
	const [failureLimit, setFailureLimit] = useState(IMPORT_FAILURES_PAGE_SIZE);
	const nowMs = Date.now();
	const sourceNames = importSourceNames(loaded.sources);
	const run = state.status === "ready" ? state.run : undefined;
	const title = run === undefined ? "Import" : importSourceName(run.source, sourceNames);
	const duration = run === undefined ? undefined : runDurationLabel(run, nowMs);

	useEffect(() => () => controller.current.abort(), []);

	const reload = useEffectEvent(async (nextLimit: number) => {
		setIsLoadingMore(nextLimit > failureLimit);
		const outcome = await runtime.runPromise(
			Effect.flatMap(ImportsService, (service) =>
				service.loadRun(ryot, { runId, failureLimit: nextLimit }),
			).pipe(
				Effect.match({
					onFailure: () => undefined,
					onSuccess: (detail) => detailState(detail),
				}),
			),
			{ signal: controller.current.signal },
		);
		setIsLoadingMore(false);
		setFailureLimit(nextLimit);
		if (outcome !== undefined) {
			setState(outcome);
		}
	});

	useRunPolling({
		intervalMs: RUN_POLL_MS,
		refresh: () => void reload(failureLimit),
		enabled: run !== undefined && !isTerminalRunStatus(run.status),
	});

	useEffect(() => {
		if (!menuOpen && !isConfirming) {
			return undefined;
		}
		return backInterceptors.register(() => {
			if (deleting) {
				return true;
			}
			setMenuOpen(false);
			setIsConfirming(false);
			return true;
		});
	}, [backInterceptors, deleting, isConfirming, menuOpen]);

	const confirmDelete = useEffectEvent(async () => {
		setDeleting(true);
		setDeleteFailed(false);
		const removed = await runtime.runPromise(
			Effect.flatMap(ImportsApi, (api) =>
				api.deleteRun(scope, { params: { runId: ImportRunId.make(runId) } }),
			).pipe(Effect.match({ onFailure: () => false, onSuccess: () => true })),
			{ signal: controller.current.signal },
		);
		setDeleting(false);
		if (!removed) {
			setDeleteFailed(true);
			return;
		}
		setIsConfirming(false);
		if (router.history.canGoBack()) {
			router.history.back();
			return;
		}
		void navigate({ replace: true, to: "/settings/import-data", search: { start: undefined } });
	});

	const menuItems: readonly MenuItem[] = [
		{
			key: "delete",
			destructive: true,
			label: "Delete record",
			onSelect: () => {
				setMenuOpen(false);
				setDeleteFailed(false);
				setIsConfirming(true);
			},
		},
	];

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
				run !== undefined && canDeleteImportRun(run.status) ? (
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
								activeIndex={activeIndex}
								triggerRef={menuTrigger}
								onClose={() => setMenuOpen(false)}
								onActiveIndexChange={setActiveIndex}
							/>
						)}
					</>
				) : undefined
			}
		>
			<ImportRunView
				state={state}
				sourceNames={sourceNames}
				isLoadingMore={isLoadingMore}
				onRetry={() => void reload(failureLimit)}
				onCopy={(value) => void navigator.clipboard.writeText(value)}
				onShowMore={() => void reload(failureLimit + IMPORT_FAILURES_PAGE_SIZE)}
			/>
			{isConfirming && run !== undefined && (
				<ImportRunDeleteConfirmation
					pending={deleting}
					triggerRef={menuTrigger}
					detail={importRunDeleteConfirmation(run)}
					onConfirm={() => void confirmDelete()}
					errorMessage={deleteFailed ? "This record could not be deleted. Try again." : undefined}
					onClose={() => {
						setDeleteFailed(false);
						setIsConfirming(false);
					}}
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

function ImportRunLoadError() {
	const router = useRouter();
	return (
		<ImportRunFrame title="Import">
			<StatusState
				detailTone="danger"
				title="Unable to load this import"
				className="rounded-xl border border-border bg-surface p-6"
				detail="This import could not be loaded. Check the server and try again."
				action={
					<button
						type="button"
						onClick={() => void router.invalidate()}
						className="min-h-11 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-text"
					>
						Try again
					</button>
				}
			/>
		</ImportRunFrame>
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
