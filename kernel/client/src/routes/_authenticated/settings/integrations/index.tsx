import {
	useRyotInfiniteQuery,
	useRyotMutation,
	useRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import type { IntegrationList } from "@ryot-app/ryotql-recipes/integrations";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { useState } from "react";

import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import {
	IntegrationCreateWizard,
	type IntegrationProviderPickerState,
} from "#/modules/integrations/create-wizard";
import {
	type IntegrationListState,
	type IntegrationPauseState,
	IntegrationsView,
} from "#/modules/integrations/integrations-view";
import { integrationProviderNames } from "#/modules/integrations/provider-selection";
import {
	integrationProvidersQuery,
	INTEGRATIONS_PAGE_SIZE,
	integrationsQuery,
	syncIntegrationsMutation,
} from "#/modules/integrations/service";
import { useIngestionCatalogRefresh } from "#/modules/plugins/catalog/provider";
import {
	preferencesQuery,
	updatePreferencesMutation,
} from "#/modules/settings/preferences-service";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { useSearchParamModal } from "#/modules/ui/search-param-modal";
import { StatusState } from "#/modules/ui/status-state";
import { RELATIVE_TIME_REFRESH_MS, useNowMs } from "#/modules/ui/use-now-ms";

const listState = (page: IntegrationList): IntegrationListState =>
	page.items.length === 0
		? { status: "empty" }
		: { status: "ready", integrations: page.items, hasMore: page.pageInfo.hasMore };

const queryListState = (
	page: undefined | IntegrationList,
	pending: boolean,
): undefined | IntegrationListState => {
	if (page !== undefined) {
		return listState(page);
	}
	return pending ? undefined : { status: "failed" };
};

export const Route = createFileRoute("/_authenticated/settings/integrations/")({
	component: IntegrationsRoute,
	validateSearch: (search) => ({
		create: search.create === true || search.create === "true" ? true : undefined,
	}),
});

function IntegrationsRoute() {
	const { server, runtime } = Route.useRouteContext();
	const isDemo = useIsDemoSession(runtime.runSync(AuthService).session(server));
	const navigate = Route.useNavigate();
	const { create } = Route.useSearch();
	const [syncSucceeded, setSyncSucceeded] = useState(false);
	const [syncDetail, setSyncDetail] = useState<string | undefined>();
	const listed = useRyotInfiniteQuery(integrationsQuery, undefined, {
		mode: "replace",
		getPageInput: (_input, limit) => limit,
		initialPageParam: INTEGRATIONS_PAGE_SIZE,
		getNextPageParam: (page, limit) =>
			page.pageInfo.hasMore ? limit + INTEGRATIONS_PAGE_SIZE : null,
	});
	const providerQuery = useRyotQuery(integrationProvidersQuery);
	useIngestionCatalogRefresh(providerQuery.refetch);
	const sync = useRyotMutation(syncIntegrationsMutation);
	const preferences = useRyotQuery(preferencesQuery);
	const updatePreferences = useRyotMutation(updatePreferencesMutation);
	const [requestedPause, setRequestedPause] = useState<boolean | undefined>();
	const state = queryListState(listed.data, listed.isPending);
	const nowMs = useNowMs(RELATIVE_TIME_REFRESH_MS);

	let providers: IntegrationProviderPickerState = { status: "loading" };
	if (providerQuery.data !== undefined) {
		providers =
			providerQuery.data.length === 0
				? { status: "empty" }
				: { status: "ready", sources: providerQuery.data };
	} else if (providerQuery.isError) {
		providers = { status: "failed" };
	}

	const syncAll = () => {
		setSyncDetail(undefined);
		setSyncSucceeded(false);
		return Effect.runPromise(
			sync.mutateEffect().pipe(
				Effect.tap(() =>
					Effect.sync(() => {
						setSyncSucceeded(true);
						setSyncDetail("Sync started. Updates will appear as integrations finish.");
					}),
				),
				Effect.catchCause(() =>
					Effect.sync(() => setSyncDetail("Integration sync could not be started. Try again.")),
				),
			),
		);
	};

	const storedPause = preferences.data?.disableIntegrations;
	const pause: undefined | IntegrationPauseState =
		storedPause === undefined
			? undefined
			: {
					paused: requestedPause ?? storedPause,
					isSaving: updatePreferences.isPending,
					failed: updatePreferences.status === "error",
				};

	const changePause = (paused: boolean) => {
		setRequestedPause(paused);
		return Effect.runPromise(
			updatePreferences
				.mutateEffect({ disableIntegrations: paused })
				.pipe(Effect.catchCause(() => Effect.sync(() => setRequestedPause(undefined)))),
		);
	};

	const wizard = useSearchParamModal({
		isOpen: create === true,
		onCompleted: () => undefined,
		open: () => void navigate({ search: { create: true } }),
		close: () => void navigate({ replace: true, search: { create: undefined } }),
	});

	return (
		<SettingsFrame title="Integrations" backFallbackHref="/settings">
			{state === undefined ? (
				<StatusState className="py-16" detail="Loading your integrations..." />
			) : (
				<IntegrationsView
					state={state}
					nowMs={nowMs}
					pause={pause}
					readOnly={isDemo}
					onConnect={wizard.open}
					syncDetail={syncDetail}
					onRetry={listed.refetch}
					isSyncing={sync.isPending}
					syncSucceeded={syncSucceeded}
					isFetching={listed.isFetching}
					onSyncAll={() => void syncAll()}
					isFetchingNextPage={listed.isFetchingNextPage}
					onPauseChange={(paused) => void changePause(paused)}
					providerNames={integrationProviderNames(
						providers.status === "ready" ? providers.sources : [],
					)}
					onShowMore={() => {
						if (listed.errorOperation === "append") {
							listed.retry();
						} else {
							listed.fetchNextPage();
						}
					}}
				/>
			)}
			{create === true && !isDemo && (
				<IntegrationCreateWizard
					providers={providers}
					onClose={wizard.close}
					onCreated={wizard.markCompleted}
					onRetryProviders={providerQuery.refetch}
				/>
			)}
		</SettingsFrame>
	);
}
