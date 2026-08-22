import { useRyotMutation, useRyotQuery } from "@ryot-app/client-sdk/react";
import type { IntegrationList } from "@ryot-app/ryotql-recipes/integrations";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useState } from "react";

import { AuthService } from "#/modules/auth/service";
import { useIsDemoSession } from "#/modules/demo-protection";
import {
	IntegrationCreateWizard,
	type IntegrationProviderPickerState,
} from "#/modules/integrations/create-wizard";
import {
	IntegrationsView,
	type IntegrationListState,
} from "#/modules/integrations/integrations-view";
import { integrationProviderNames } from "#/modules/integrations/provider-selection";
import {
	INTEGRATIONS_PAGE_SIZE,
	integrationProvidersQuery,
	integrationsQuery,
	syncIntegrationsMutation,
} from "#/modules/integrations/service";
import { SettingsFrame } from "#/modules/settings/settings-frame";
import { useSearchParamModal } from "#/modules/ui/search-param-modal";
import { StatusState } from "#/modules/ui/status-state";

const listState = (page: IntegrationList): IntegrationListState =>
	page.items.length === 0
		? { status: "empty" }
		: { status: "ready", integrations: page.items, hasMore: page.pageInfo.hasMore };

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
	const [limit, setLimit] = useState(INTEGRATIONS_PAGE_SIZE);
	const [syncDetail, setSyncDetail] = useState<string | undefined>();
	const listed = useRyotQuery(integrationsQuery, limit);
	const providerQuery = useRyotQuery(integrationProvidersQuery);
	const sync = useRyotMutation(syncIntegrationsMutation);
	const [state, setState] = useState<IntegrationListState | undefined>();

	useEffect(() => {
		if (listed.data !== undefined) {
			setState(listState(listed.data));
		} else if (listed.isError) {
			setState((current) => current ?? { status: "failed" });
		}
	}, [listed.data, listed.isError]);

	let providers: IntegrationProviderPickerState = { status: "loading" };
	if (providerQuery.data !== undefined) {
		providers =
			providerQuery.data.length === 0
				? { status: "empty" }
				: { status: "ready", sources: providerQuery.data };
	} else if (providerQuery.isError) {
		providers = { status: "failed" };
	}

	const syncAll = useEffectEvent(async () => {
		setSyncDetail(undefined);
		setSyncSucceeded(false);
		try {
			await sync.mutateAsync();
		} catch {
			setSyncDetail("Integration sync could not be started. Try again.");
			return;
		}
		setSyncSucceeded(true);
		setSyncDetail("Sync started. Updates will appear as integrations finish.");
	});

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
					readOnly={isDemo}
					nowMs={Date.now()}
					onConnect={wizard.open}
					syncDetail={syncDetail}
					onRetry={listed.refetch}
					isSyncing={sync.isPending}
					syncSucceeded={syncSucceeded}
					onSyncAll={() => void syncAll()}
					isLoadingMore={listed.isFetching && limit > INTEGRATIONS_PAGE_SIZE}
					onShowMore={() => setLimit((current) => current + INTEGRATIONS_PAGE_SIZE)}
					providerNames={integrationProviderNames(
						providers.status === "ready" ? providers.sources : [],
					)}
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
