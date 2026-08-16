import { useRyot } from "@ryot-app/client-sdk/react";
import { Button } from "@ryot-app/client-ui-sdk";
import type { IntegrationList } from "@ryot-app/ryotql-recipes/integrations";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Effect } from "effect";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";

import { IntegrationsApi } from "#/api/integrations";
import { createKernelRyotClient } from "#/api/ryot-client";
import type { CatalogPickerState } from "#/modules/integrations/catalog-picker";
import { IntegrationCreateWizard } from "#/modules/integrations/create-wizard";
import {
	IntegrationsView,
	type IntegrationListState,
} from "#/modules/integrations/integrations-view";
import { integrationProviderNames } from "#/modules/integrations/provider-selection";
import { INTEGRATIONS_PAGE_SIZE, IntegrationsService } from "#/modules/integrations/service";
import { StatusState } from "#/modules/integrations/status-state";
import { SettingsFrame } from "#/modules/settings/settings-frame";

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
		const ryot = createKernelRyotClient(context.runtime, context.scope, context.theme);
		const [page, providers] = await Promise.all([
			context.runtime.runPromise(
				Effect.flatMap(IntegrationsService, (service) =>
					service.loadIntegrations(ryot, { limit: INTEGRATIONS_PAGE_SIZE }),
				),
				{ signal: abortController.signal },
			),
			context.runtime.runPromise(
				Effect.flatMap(IntegrationsApi, (api) => api.listProviders(context.scope)).pipe(
					Effect.match({
						onFailure: (): CatalogPickerState => ({ status: "failed" }),
						onSuccess: (listed): CatalogPickerState =>
							listed.length === 0 ? { status: "empty" } : { status: "ready", providers: listed },
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
	const router = useRouter();
	const navigate = Route.useNavigate();
	const { create } = Route.useSearch();
	const loaded = Route.useLoaderData();
	const { runtime, scope } = Route.useRouteContext();
	const created = useRef(false);
	const pushedCreate = useRef(false);
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
					onFailure: (): CatalogPickerState => ({ status: "failed" }),
					onSuccess: (listed): CatalogPickerState =>
						listed.length === 0 ? { status: "empty" } : { status: "ready", providers: listed },
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

	const openWizard = () => {
		pushedCreate.current = true;
		void navigate({ search: { create: true } });
	};

	const closeWizard = () => {
		if (pushedCreate.current) {
			pushedCreate.current = false;
			router.history.back();
			return;
		}
		void navigate({ replace: true, search: { create: undefined } });
	};

	useEffect(() => {
		if (create === true) {
			return;
		}
		pushedCreate.current = false;
		if (!created.current) {
			return;
		}
		created.current = false;
		void reload(INTEGRATIONS_PAGE_SIZE);
	}, [create]);

	return (
		<IntegrationsFrame>
			<IntegrationsView
				state={state}
				nowMs={Date.now()}
				isSyncing={isSyncing}
				onConnect={openWizard}
				syncDetail={syncDetail}
				isLoadingMore={isLoadingMore}
				syncSucceeded={syncSucceeded}
				onSyncAll={() => void syncAll()}
				onRetry={() => void reload(limit)}
				onShowMore={() => void reload(limit + INTEGRATIONS_PAGE_SIZE)}
				providerNames={integrationProviderNames(
					providers.status === "ready" ? providers.providers : [],
				)}
			/>
			{create === true && (
				<IntegrationCreateWizard
					onClose={closeWizard}
					providers={providers}
					onRetryProviders={() => void reloadProviders()}
					onCreated={() => {
						created.current = true;
					}}
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
			<StatusState
				detailTone="danger"
				title="Unable to load integrations"
				className="rounded-xl border border-border bg-surface p-6"
				detail="Your integrations could not be loaded. Check the server and try again."
				action={
					<Button type="button" variant="secondary" onClick={() => void router.invalidate()}>
						Try again
					</Button>
				}
			/>
		</IntegrationsFrame>
	);
}
