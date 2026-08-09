import { useRyot } from "@ryot-app/client-sdk/react";
import { Button, Menu, type MenuItem } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { useSchemaForm, type SchemaFormValues } from "@ryot-app/client-ui-sdk/schema-form";
import {
	IntegrationNotFoundError,
	type ListedIntegration,
	type ListedIntegrationProvider,
} from "@ryot-app/contract/modules/integrations/schemas";
import { IntegrationId } from "@ryot-app/contract/schema/brands";
import type { ImportRunSummary } from "@ryot-app/ryotql-recipes/import-runs";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { AuthenticatedApiError } from "#/api/authenticated";
import { IntegrationsApi } from "#/api/integrations";
import { createKernelRyotClient } from "#/api/ryot-client";
import { IntegrationDetailView } from "#/modules/integrations/integration-detail-view";
import { storedIntegrationFormValues, updateIntegrationBody } from "#/modules/integrations/payload";
import {
	integrationDeleteConfirmation,
	integrationTitle,
} from "#/modules/integrations/presentation";
import {
	findOwnedIntegrationProvider,
	integrationLotLabel,
	integrationProviderNames,
} from "#/modules/integrations/provider-selection";
import { integrationSaveFailure } from "#/modules/integrations/save-failure";
import { INTEGRATION_RUNS_PAGE_SIZE, IntegrationsService } from "#/modules/integrations/service";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { DestructiveConfirmation } from "#/modules/ui/destructive-confirmation";
import { isTerminalRunStatus } from "#/modules/ui/run/run-status";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { StatusState } from "#/modules/ui/status-state";

const RUN_LIST_POLL_MS = 10_000;

const isNotFound = (error: unknown) =>
	error instanceof AuthenticatedApiError && error.cause instanceof IntegrationNotFoundError;

export const Route = createFileRoute("/_authenticated/settings/integrations/$integrationId")({
	component: IntegrationDetailRoute,
	errorComponent: IntegrationLoadError,
	pendingComponent: IntegrationPending,
	notFoundComponent: IntegrationNotFound,
	loader: async ({ abortController, context, params }) => {
		const trimmed = params.integrationId.trim();
		if (trimmed.length === 0) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
		const ryot = createKernelRyotClient(context.runtime, context.scope, context.theme);
		const outcome = await context.runtime.runPromise(
			Effect.flatMap(IntegrationsApi, (api) =>
				api.get(context.scope, { params: { integrationId: IntegrationId.make(trimmed) } }),
			).pipe(
				Effect.match({
					onFailure: (failure) => ({ failure, integration: undefined }),
					onSuccess: (integration) => ({ integration, failure: undefined }),
				}),
			),
			{ signal: abortController.signal },
		);
		if (outcome.integration === undefined) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw isNotFound(outcome.failure) ? notFound() : outcome.failure;
		}
		const integration = outcome.integration;
		const [runs, providers] = await Promise.all([
			context.runtime.runPromise(
				Effect.flatMap(IntegrationsService, (service) =>
					service.loadRuns(ryot, {
						integrationId: trimmed,
						limit: INTEGRATION_RUNS_PAGE_SIZE,
					}),
				).pipe(
					Effect.match({
						onFailure: (): readonly ImportRunSummary[] => [],
						onSuccess: (page) => page.items,
					}),
				),
				{ signal: abortController.signal },
			),
			context.runtime.runPromise(
				Effect.flatMap(IntegrationsApi, (api) => api.listProviders(context.scope)).pipe(
					Effect.match({
						onSuccess: (listed) => listed,
						onFailure: (): readonly ListedIntegrationProvider[] => [],
					}),
				),
				{ signal: abortController.signal },
			),
		]);
		return { runs, providers, integration };
	},
});

function IntegrationFrame(props: {
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
			backFallbackHref="/settings/integrations"
		>
			{props.children}
		</SettingsFrame>
	);
}

function IntegrationDetailRoute() {
	const ryot = useRyot();
	const uploadFile = useSchemaFileUpload();
	const router = useRouter();
	const navigate = Route.useNavigate();
	const loaded = Route.useLoaderData();
	const { backInterceptors, runtime, scope } = Route.useRouteContext();
	const menuTrigger = useRef<HTMLButtonElement>(null);
	const controller = useRef(new AbortController());
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const [isConfirming, setIsConfirming] = useState(false);
	const [runs, setRuns] = useState(loaded.runs);
	const [deleteFailed, setDeleteFailed] = useState(false);
	const [saveDetail, setSaveDetail] = useState<string | undefined>();
	const [integration, setIntegration] = useState<ListedIntegration>(loaded.integration);
	const providerNames = integrationProviderNames(loaded.providers);
	const provider = findOwnedIntegrationProvider(loaded.providers, integration);
	const title = integrationTitle(integration, providerNames);

	useEffect(() => () => controller.current.abort(), []);

	const save = useEffectEvent(async (values: SchemaFormValues) => {
		if (provider === undefined) {
			return;
		}
		setSaving(true);
		setSaveDetail(undefined);
		const outcome = await runtime.runPromise(
			Effect.flatMap(IntegrationsApi, (api) =>
				api.update(scope, {
					payload: updateIntegrationBody({ provider, values }),
					params: { integrationId: IntegrationId.make(integration.id) },
				}),
			).pipe(
				Effect.match({
					onSuccess: (updated) => ({ updated, detail: undefined }),
					onFailure: (error) => ({
						updated: undefined,
						detail: integrationSaveFailure(error).detail,
					}),
				}),
			),
			{ signal: controller.current.signal },
		);
		setSaving(false);
		if (outcome.updated === undefined) {
			setSaveDetail(outcome.detail);
			return;
		}
		setIntegration(outcome.updated);
	});

	const form = useSchemaForm({
		mode: "edit",
		onSubmit: (values) => void save(values),
		schemas: [provider?.commonSchema, provider?.settingsSchema],
	});

	const seedForm = useEffectEvent(() => {
		form.reset(
			provider === undefined ? {} : storedIntegrationFormValues({ provider, integration }),
		);
	});

	useEffect(() => {
		seedForm();
	}, [integration.id, integration.updatedAt, provider?.slug]);

	const refreshRuns = useEffectEvent(async () => {
		const next = await runtime.runPromise(
			Effect.flatMap(IntegrationsService, (service) =>
				service.loadRuns(ryot, {
					integrationId: integration.id,
					limit: INTEGRATION_RUNS_PAGE_SIZE,
				}),
			).pipe(
				Effect.match({
					onFailure: () => undefined,
					onSuccess: (page) => page.items,
				}),
			),
			{ signal: controller.current.signal },
		);
		if (next !== undefined) {
			setRuns(next);
		}
	});

	const isPolling = runs.some((run) => !isTerminalRunStatus(run.status));

	useEffect(() => {
		if (!isPolling) {
			return undefined;
		}
		const interval = setInterval(() => {
			if (document.visibilityState === "visible") {
				void refreshRuns();
			}
		}, RUN_LIST_POLL_MS);
		return () => clearInterval(interval);
	}, [isPolling]);

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
			Effect.flatMap(IntegrationsApi, (api) =>
				api.delete(scope, { params: { integrationId: IntegrationId.make(integration.id) } }),
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
		void navigate({ replace: true, to: "/settings/integrations", search: { create: undefined } });
	});

	const menuItems: readonly MenuItem[] = [
		{
			key: "delete",
			destructive: true,
			label: "Delete integration",
			onSelect: () => {
				setMenuOpen(false);
				setDeleteFailed(false);
				setIsConfirming(true);
			},
		},
	];

	return (
		<IntegrationFrame
			title={title}
			meta={
				<p className="text-xs text-text-subtle">
					{`${integrationLotLabel(integration.lot)} · ${integration.isDisabled ? "Paused" : "Active"}`}
				</p>
			}
			actions={
				<>
					<button
						type="button"
						ref={menuTrigger}
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						aria-label="Integration actions"
						onClick={() => setMenuOpen((open) => !open)}
						className="flex size-11 shrink-0 items-center justify-center text-text-muted"
					>
						<AppIcon size={20} name="more-horizontal" />
					</button>
					{menuOpen && (
						<Menu
							items={menuItems}
							activeIndex={activeIndex}
							triggerRef={menuTrigger}
							label="Integration actions"
							onClose={() => setMenuOpen(false)}
							onActiveIndexChange={setActiveIndex}
						/>
					)}
				</>
			}
		>
			<IntegrationDetailView
				runs={runs}
				form={form}
				saving={saving}
				nowMs={Date.now()}
				provider={provider}
				uploadFile={uploadFile}
				saveDetail={saveDetail}
				integration={integration}
				onSave={() => void form.handleSubmit()}
				onCopy={(value) => void navigator.clipboard.writeText(value)}
			/>
			{isConfirming && (
				<DestructiveConfirmation
					pending={deleting}
					triggerRef={menuTrigger}
					pendingLabel="Deleting..."
					title="Delete this integration?"
					actionLabel="Delete integration"
					onConfirm={() => void confirmDelete()}
					detail={integrationDeleteConfirmation(integration, providerNames)}
					errorMessage={
						deleteFailed ? "This integration could not be deleted. Try again." : undefined
					}
					onClose={() => {
						setDeleteFailed(false);
						setIsConfirming(false);
					}}
				/>
			)}
		</IntegrationFrame>
	);
}

function IntegrationPending() {
	return (
		<IntegrationFrame title="Integration">
			<StatusState className="py-16" detail="Loading this integration..." />
		</IntegrationFrame>
	);
}

function IntegrationLoadError() {
	const router = useRouter();
	return (
		<IntegrationFrame title="Integration">
			<StatusState
				detailTone="danger"
				title="Unable to load this integration"
				className="rounded-xl border border-border bg-surface p-6"
				detail="This integration could not be loaded. Check the server and try again."
				action={
					<Button type="button" variant="secondary" onClick={() => void router.invalidate()}>
						Try again
					</Button>
				}
			/>
		</IntegrationFrame>
	);
}

function IntegrationNotFound() {
	return (
		<IntegrationFrame title="Integration">
			<StatusState
				className="py-16"
				title="Integration not found"
				detail="This integration may have been deleted from another device."
				icon={<AppIcon size={36} name="search-x" className="text-text-subtle" />}
			/>
		</IntegrationFrame>
	);
}
