import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { formatDisplayText } from "@ryot-app/i18n/format";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import {
	useRyotInfiniteQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Button, DestructiveConfirmation, Menu, type MenuItem } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { type SchemaFormValues, useSchemaForm } from "@ryot-app/plugin-ui-sdk/schema-form";
import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { Cause, Effect, Option } from "effect";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { AuthService } from "#/modules/auth/service";
import { demoProtectionMessage } from "#/modules/demo-protection";
import { IntegrationDetailView } from "#/modules/integrations/integration-detail-view";
import { useOAuthConnect } from "#/modules/integrations/oauth-connect";
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
import type { IntegrationClientDetail } from "#/modules/integrations/service";
import {
	deleteIntegrationMutation,
	getIntegration,
	INTEGRATION_RUNS_PAGE_SIZE,
	integrationDetailQuery,
	integrationProvidersQuery,
	integrationRunsQuery,
	updateIntegrationMutation,
} from "#/modules/integrations/service";
import { useIngestionCatalogRefresh } from "#/modules/plugins/catalog/provider";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { isTerminalRunStatus } from "#/modules/ui/run/run-status";
import { useSchemaFileUpload } from "#/modules/ui/schema-form-upload";
import { StatusState } from "#/modules/ui/status-state";
import { useFormSeed } from "#/modules/ui/use-form-seed";
import { useLatestDefined } from "#/modules/ui/use-latest-defined";
import { RELATIVE_TIME_REFRESH_MS, useNowMs } from "#/modules/ui/use-now-ms";

const RUN_LIST_POLL_MS = 10_000;

export const Route = createFileRoute("/_authenticated/settings/integrations/$integrationId")({
	component: IntegrationDetailRoute,
	errorComponent: IntegrationLoadError,
	pendingComponent: IntegrationPending,
	notFoundComponent: IntegrationNotFound,
	loader: ({ params, context, abortController }) =>
		context.runtime.runPromise(
			Effect.gen(function* () {
				const trimmed = params.integrationId.trim();
				if (trimmed.length === 0) {
					throw notFound();
				}
				const auth = yield* AuthService;
				const session = auth.session(context.server).getSnapshot();
				if (session.status === "authenticated" && session.accessClass === "demo") {
					return { access: "demo" as const };
				}
				const outcome = yield* getIntegration(context.ryot, context.server, trimmed);
				if (Option.isNone(outcome)) {
					throw notFound();
				}
				return { integration: outcome.value, access: "standard" as const };
			}),
			{ signal: abortController.signal },
		),
});

function IntegrationDetailRoute() {
	const loaded = Route.useLoaderData();
	if (loaded.access === "demo") {
		return <DemoIntegrationDetail />;
	}
	return <StandardIntegrationDetail integration={loaded.integration} />;
}

function IntegrationPending() {
	const t = useT();
	return (
		<IntegrationFrame title={t(kernelMessage("client.route.settings.integration.title"))}>
			<StatusState
				className="py-16"
				detail={t(kernelMessage("client.route.settings.integration.loading"))}
			/>
		</IntegrationFrame>
	);
}

function IntegrationFrame(props: {
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
			backFallbackHref="/settings/integrations"
		>
			{props.children}
		</SettingsFrame>
	);
}

function DemoIntegrationDetail() {
	const t = useT();
	return (
		<IntegrationFrame title={t(kernelMessage("client.route.settings.integration.title"))}>
			<StatusState
				detail={t(demoProtectionMessage)}
				className="rounded-xl border border-border bg-surface p-6"
				title={t(kernelMessage("client.route.settings.integration.demo-unavailable"))}
			/>
		</IntegrationFrame>
	);
}

function IntegrationNotFound() {
	const t = useT();
	return (
		<IntegrationFrame title={t(kernelMessage("client.route.settings.integration.title"))}>
			<StatusState
				className="py-16"
				icon={<AppIcon size={36} name="search-x" className="text-text-subtle" />}
				title={t(kernelMessage("client.route.settings.integration.not-found-title"))}
				detail={t(kernelMessage("client.route.settings.integration.not-found-detail"))}
			/>
		</IntegrationFrame>
	);
}

function IntegrationLoadError() {
	const t = useT();
	const router = useRouter();
	return (
		<IntegrationFrame title={t(kernelMessage("client.route.settings.integration.title"))}>
			<StatusState
				detailTone="danger"
				className="rounded-xl border border-border bg-surface p-6"
				title={t(kernelMessage("client.route.settings.integration.load-failed-title"))}
				detail={t(kernelMessage("client.route.settings.integration.load-failed-detail"))}
				action={
					<Button type="button" variant="secondary" onClick={() => void router.load()}>
						{t(kernelMessage("common.action.try-again"))}
					</Button>
				}
			/>
		</IntegrationFrame>
	);
}

function StandardIntegrationDetail(props: { readonly integration: IntegrationClientDetail }) {
	const router = useRouter();
	const navigate = Route.useNavigate();
	const uploadFile = useSchemaFileUpload();
	const menuTrigger = useRef<HTMLButtonElement>(null);
	const [isConfirming, setIsConfirming] = useState(false);
	const [deleteFailed, setDeleteFailed] = useState(false);
	const detail = useRyotQuery(integrationDetailQuery, props.integration.id);
	const t = useT();
	const providers = useRyotQuery(integrationProvidersQuery);
	useIngestionCatalogRefresh(providers.refetch);
	const integration = detail.data ?? props.integration;
	const runs = useRyotInfiniteQuery(integrationRunsQuery, integration.id, {
		mode: "replace",
		initialPageParam: INTEGRATION_RUNS_PAGE_SIZE,
		getPageInput: (integrationId, limit) => ({ limit, integrationId }),
		getNextPageParam: (page, limit) =>
			page.pageInfo.hasMore ? limit + INTEGRATION_RUNS_PAGE_SIZE : null,
	});
	const update = useRyotMutation(updateIntegrationMutation);
	const remove = useRyotMutation(deleteIntegrationMutation);
	const providerNames = integrationProviderNames(providers.data ?? [], t);
	const title = formatDisplayText(t, integrationTitle(integration, providerNames));
	const [saveDetail, setSaveDetail] = useState<Message | undefined>();
	const provider = useLatestDefined(
		findOwnedIntegrationProvider(providers.data ?? [], integration),
	);
	const oauth = useOAuthConnect({
		integrationId: integration.id,
		integrationProvider: {
			slug: integration.provider,
			owner: definitionOwner(integration.pluginId),
		},
	});

	const save = (values: SchemaFormValues) => {
		return Effect.runPromise(
			Effect.gen(function* () {
				if (provider === undefined) {
					return;
				}
				setSaveDetail(undefined);
				yield* update
					.mutateEffect({
						id: integration.id,
						payload: updateIntegrationBody({
							values,
							provider,
							originalSettings: integration.providerSpecifics,
						}),
					})
					.pipe(
						Effect.catchCause((cause) =>
							Effect.sync(() => setSaveDetail(integrationSaveFailure(Cause.squash(cause)).detail)),
						),
						Effect.asVoid,
					);
			}),
		);
	};

	const form = useSchemaForm({
		mode: "edit",
		onSubmit: (values) => void save(values),
		schemas: [provider?.commonSchema, provider?.settingsSchema],
	});

	useFormSeed(form, JSON.stringify([integration.id, integration.updatedAt, provider?.slug]), () =>
		provider === undefined ? {} : storedIntegrationFormValues({ provider, integration }),
	);
	const nowMs = useNowMs(RELATIVE_TIME_REFRESH_MS);

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

	const confirmDelete = () => {
		setDeleteFailed(false);
		return Effect.runPromise(
			remove.mutateEffect(integration.id).pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						setIsConfirming(false);
						if (router.history.canGoBack()) {
							router.history.back();
							return;
						}
						void navigate({
							replace: true,
							to: "/settings/integrations",
							search: { create: undefined },
						});
					}),
				),
				Effect.catchCause(() => Effect.sync(() => setDeleteFailed(true))),
				Effect.asVoid,
			),
		);
	};

	const menuItems: readonly MenuItem[] = [
		{
			key: "delete",
			destructive: true,
			label: t(kernelMessage("client.route.settings.integration.delete-action")),
			onSelect: () => {
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
					{t(
						kernelMessage("client.route.settings.integration.meta", {
							lot: integrationLotLabel(integration.lot),
							state: integration.isDisabled ? "paused" : "active",
						}),
					)}
				</p>
			}
			actions={
				<Menu
					items={menuItems}
					label={t(kernelMessage("client.route.settings.integration.actions"))}
					trigger={
						<button
							type="button"
							ref={menuTrigger}

							aria-label={t(kernelMessage("client.route.settings.integration.actions"))}
							className="flex size-11 shrink-0 items-center justify-center text-text-muted"
						>
							<AppIcon size={20} name="more-horizontal" />
						</button>
					}
				/>
			}
		>
			<IntegrationDetailView
				form={form}
				nowMs={nowMs}
				provider={provider}
				uploadFile={uploadFile}
				integration={integration}
				saving={update.isPending}
				connectOAuth={oauth.connect}
				runs={runs.data?.items ?? []}
				isFetchingRuns={runs.isFetching}
				onSave={() => void form.handleSubmit()}
				oauthDisabledReason={oauth.disabledReason}
				isFetchingNextRuns={runs.isFetchingNextPage}
				hasMoreRuns={runs.data?.pageInfo.hasMore === true}
				saveDetail={saveDetail === undefined ? undefined : t(saveDetail)}
				onShowOlderRuns={() => {
					if (runs.errorOperation === "append") {
						runs.retry();
					} else {
						runs.fetchNextPage();
					}
				}}
			/>
			{isConfirming && (
				<DestructiveConfirmation
					triggerRef={menuTrigger}
					pending={remove.isPending}
					onConfirm={() => void confirmDelete()}
					pendingLabel={t(kernelMessage("common.status.deleting"))}
					detail={t(integrationDeleteConfirmation(integration, providerNames))}
					title={t(kernelMessage("client.route.settings.integration.delete-title"))}
					actionLabel={t(kernelMessage("client.route.settings.integration.delete-action"))}
					onClose={() => {
						setDeleteFailed(false);
						setIsConfirming(false);
					}}
					errorMessage={
						deleteFailed
							? t(kernelMessage("client.route.settings.integration.delete-failed"))
							: undefined
					}
				/>
			)}
		</IntegrationFrame>
	);
}
