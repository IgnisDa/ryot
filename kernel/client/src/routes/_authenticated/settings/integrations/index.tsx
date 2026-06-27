import { useRyot } from "@ryot-app/client-sdk/react";
import type { IntegrationList } from "@ryot-app/ryotql-recipes/integrations";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { IntegrationsApi } from "#/api/integrations";
import {
	IntegrationCreateWizard,
	type IntegrationProviderPickerState,
} from "#/modules/integrations/create-wizard";
import {
	INTEGRATION_LOAD_ERROR,
	IntegrationsView,
	type IntegrationListState,
} from "#/modules/integrations/integrations-view";
import { integrationProviderNames } from "#/modules/integrations/provider-selection";
import { INTEGRATIONS_PAGE_SIZE, IntegrationsService } from "#/modules/integrations/service";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { LoadErrorState } from "#/modules/ui/load-error-state";
import { useSearchParamModal } from "#/modules/ui/search-param-modal";
import { StatusState } from "#/modules/ui/status-state";

const listState = (page: IntegrationList): IntegrationListState =>
	page.items.length === 0
		? { status: "empty" }
		: { status: "ready", integrations: page.items, hasMore: page.pageInfo.hasMore };

export const Route = createFileRoute("/_authenticated/settings/integrations/")({
	component: IntegrationsRoute,
	errorComponent: IntegrationsLoadError,
	pendingComponent: IntegrationsPending,
	validateSearch: (search) => ({
		create: search.create === true || search.create === "true" ? true : undefined,
	}),
	loader: async ({ abortController, context }) => {
		const [page, providers] = await Promise.all([
			context.runtime.runPromise(
				Effect.flatMap(IntegrationsService, (service) =>
					service.loadIntegrations(context.ryot, { limit: INTEGRATIONS_PAGE_SIZE }),
				),
				{ signal: abortController.signal },
			),
			context.runtime.runPromise(
				Effect.flatMap(IntegrationsApi, (api) => api.listProviders(context.scope)).pipe(
					Effect.match({
						onFailure: (): IntegrationProviderPickerState => ({ status: "failed" }),
						onSuccess: (listed): IntegrationProviderPickerState =>
							listed.length === 0 ? { status: "empty" } : { status: "ready", sources: listed },
					}),
				),
				{ signal: abortController.signal },
			),
		]);
		return { page, providers };
	},
});

function IntegrationsFrame(props: { readonly children: ReactNode }) {
	return (
		<SettingsFrame title="Integrations" backFallbackHref="/settings">
			{props.children}
		</SettingsFrame>
	);
}

function IntegrationsRoute() {
	const ryot = useRyot();
	const navigate = Route.useNavigate();
	const { create } = Route.useSearch();
	const loaded = Route.useLoaderData();
	const { runtime, scope } = Route.useRouteContext();
	const controller = useRef(new AbortController());
	const [isSyncing, setIsSyncing] = useState(false);
	const [isLoadingMore, setIsLoadingMore] = useState(false);
	const [syncSucceeded, setSyncSucceeded] = useState(false);
	const [limit, setLimit] = useState(INTEGRATIONS_PAGE_SIZE);
	const [syncDetail, setSyncDetail] = useState<string | undefined>();
	const [providers, setProviders] = useState(loaded.providers);
	const [state, setState] = useState(() => listState(loaded.page));

	useEffect(() => () => controller.current.abort(), []);

	const reload = useEffectEvent(async (nextLimit: number) => {
		setIsLoadingMore(nextLimit > limit);
		const outcome = await runtime.runPromise(
			Effect.flatMap(IntegrationsService, (service) =>
				service.loadIntegrations(ryot, { limit: nextLimit }),
			).pipe(
				Effect.match({
					onFailure: () => undefined,
					onSuccess: (page) => listState(page),
				}),
			),
			{ signal: controller.current.signal },
		);
		setIsLoadingMore(false);
		setLimit(nextLimit);
		setState(outcome ?? { status: "failed" });
	});

	const reloadProviders = useEffectEvent(async () => {
		setProviders({ status: "loading" });
		const next = await runtime.runPromise(
			Effect.flatMap(IntegrationsApi, (api) => api.listProviders(scope)).pipe(
				Effect.match({
					onFailure: (): IntegrationProviderPickerState => ({ status: "failed" }),
					onSuccess: (listed): IntegrationProviderPickerState =>
						listed.length === 0 ? { status: "empty" } : { status: "ready", sources: listed },
				}),
			),
			{ signal: controller.current.signal },
		);
		setProviders(next);
	});

	const syncAll = useEffectEvent(async () => {
		setIsSyncing(true);
		setSyncDetail(undefined);
		setSyncSucceeded(false);
		const started = await runtime.runPromise(
			Effect.flatMap(IntegrationsApi, (api) => api.sync(scope)).pipe(
				Effect.match({ onFailure: () => false, onSuccess: () => true }),
			),
			{ signal: controller.current.signal },
		);
		setIsSyncing(false);
		if (!started) {
			setSyncDetail("Integration sync could not be started. Try again.");
			return;
		}
		setSyncSucceeded(true);
		setSyncDetail("Sync started. Updates will appear as integrations finish.");
		await reload(limit);
	});

	const wizard = useSearchParamModal({
		isOpen: create === true,
		open: () => void navigate({ search: { create: true } }),
		onCompleted: () => void reload(INTEGRATIONS_PAGE_SIZE),
		close: () => void navigate({ replace: true, search: { create: undefined } }),
	});

	return (
		<IntegrationsFrame>
			<IntegrationsView
				state={state}
				nowMs={Date.now()}
				isSyncing={isSyncing}
				onConnect={wizard.open}
				syncDetail={syncDetail}
				isLoadingMore={isLoadingMore}
				syncSucceeded={syncSucceeded}
				onSyncAll={() => void syncAll()}
				onRetry={() => void reload(limit)}
				onShowMore={() => void reload(limit + INTEGRATIONS_PAGE_SIZE)}
				providerNames={integrationProviderNames(
					providers.status === "ready" ? providers.sources : [],
				)}
			/>
			{create === true && (
				<IntegrationCreateWizard
					providers={providers}
					onClose={wizard.close}
					onCreated={wizard.markCompleted}
					onRetryProviders={() => void reloadProviders()}
				/>
			)}
		</IntegrationsFrame>
	);
}

function IntegrationsPending() {
	return (
		<IntegrationsFrame>
			<StatusState className="py-16" detail="Loading your integrations..." />
		</IntegrationsFrame>
	);
}

function IntegrationsLoadError() {
	const router = useRouter();
	return (
		<IntegrationsFrame>
			<LoadErrorState
				title={INTEGRATION_LOAD_ERROR.title}
				detail={INTEGRATION_LOAD_ERROR.detail}
				onRetry={() => void router.invalidate()}
			/>
		</IntegrationsFrame>
	);
}
