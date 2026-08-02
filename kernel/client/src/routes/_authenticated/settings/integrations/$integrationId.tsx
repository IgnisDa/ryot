import { useRyotMutation, useRyotQuery } from "@ryot-app/client-sdk/react";
import { Button, Menu, type MenuItem } from "@ryot-app/client-ui-sdk";
import { AppIcon } from "@ryot-app/client-ui-sdk/icon";
import { useSchemaForm, type SchemaFormValues } from "@ryot-app/client-ui-sdk/schema-form";
import { IntegrationNotFoundError } from "@ryot-app/contract/modules/integrations/schemas";
import { IntegrationId } from "@ryot-app/contract/schema/brands";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { AuthenticatedApiError } from "#/api/authenticated";
import { IntegrationsApi } from "#/api/integrations";
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
import {
	deleteIntegrationMutation,
	integrationDetailQuery,
	integrationProvidersQuery,
	integrationRunsQuery,
	updateIntegrationMutation,
} from "#/modules/integrations/service";
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
	loader: async ({ params, context, abortController }) => {
		const trimmed = params.integrationId.trim();
		if (trimmed.length === 0) {
			// oxlint-disable-next-line typescript/only-throw-error
			throw notFound();
		}
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
		return { integration: outcome.integration };
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
	const router = useRouter();
	const navigate = Route.useNavigate();
	const loaded = Route.useLoaderData();
	const uploadFile = useSchemaFileUpload();
	const [menuOpen, setMenuOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	const menuTrigger = useRef<HTMLButtonElement>(null);
	const [isConfirming, setIsConfirming] = useState(false);
	const [deleteFailed, setDeleteFailed] = useState(false);
	const detail = useRyotQuery(integrationDetailQuery, loaded.integration.id);
	const providers = useRyotQuery(integrationProvidersQuery);
	const integration = detail.data ?? loaded.integration;
	const runs = useRyotQuery(integrationRunsQuery, integration.id);
	const update = useRyotMutation(updateIntegrationMutation);
	const remove = useRyotMutation(deleteIntegrationMutation);
	const providerNames = integrationProviderNames(providers.data ?? []);
	const title = integrationTitle(integration, providerNames);
	const [saveDetail, setSaveDetail] = useState<string | undefined>();
	const { backInterceptors } = Route.useRouteContext();
	const provider = findOwnedIntegrationProvider(providers.data ?? [], integration);

	const save = useEffectEvent(async (values: SchemaFormValues) => {
		if (provider === undefined) {
			return;
		}
		setSaveDetail(undefined);
		try {
			await update.mutateAsync({
				id: integration.id,
				payload: updateIntegrationBody({ values, provider }),
			});
		} catch (error) {
			setSaveDetail(integrationSaveFailure(error).detail);
		}
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

	const isPolling = (runs.data?.items ?? []).some((run) => !isTerminalRunStatus(run.status));
	const refreshRuns = useEffectEvent(runs.refetch);

	useEffect(() => {
		if (!isPolling) {
			return undefined;
		}
		const interval = setInterval(() => {
			if (document.visibilityState === "visible") {
				refreshRuns();
			}
		}, RUN_LIST_POLL_MS);
		return () => clearInterval(interval);
	}, [isPolling]);

	useEffect(() => {
		if (!menuOpen && !isConfirming) {
			return undefined;
		}
		return backInterceptors.register(() => {
			if (remove.isPending) {
				return true;
			}
			setMenuOpen(false);
			setIsConfirming(false);
			return true;
		});
	}, [backInterceptors, remove.isPending, isConfirming, menuOpen]);

	const confirmDelete = useEffectEvent(async () => {
		setDeleteFailed(false);
		try {
			await remove.mutateAsync(integration.id);
		} catch {
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
							triggerRef={menuTrigger}
							activeIndex={activeIndex}
							label="Integration actions"
							onClose={() => setMenuOpen(false)}
							onActiveIndexChange={setActiveIndex}
						/>
					)}
				</>
			}
		>
			<IntegrationDetailView
				form={form}
				nowMs={Date.now()}
				provider={provider}
				uploadFile={uploadFile}
				saveDetail={saveDetail}
				integration={integration}
				saving={update.isPending}
				runs={runs.data?.items ?? []}
				onSave={() => void form.handleSubmit()}
				onCopy={(value) => void navigator.clipboard.writeText(value)}
			/>
			{isConfirming && (
				<DestructiveConfirmation
					triggerRef={menuTrigger}
					pending={remove.isPending}
					pendingLabel="Deleting..."
					title="Delete this integration?"
					actionLabel="Delete integration"
					onConfirm={() => void confirmDelete()}
					detail={integrationDeleteConfirmation(integration, providerNames)}
					onClose={() => {
						setDeleteFailed(false);
						setIsConfirming(false);
					}}
					errorMessage={
						deleteFailed ? "This integration could not be deleted. Try again." : undefined
					}
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
					<Button type="button" variant="secondary" onClick={() => void router.load()}>
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
