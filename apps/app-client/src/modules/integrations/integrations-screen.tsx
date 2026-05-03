import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Exit } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { router } from "expo-router";
import { useState } from "react";

import { requestFailureMessage } from "@/api/request-failure";
import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { SearchParamModalHost, useSearchParamModal } from "@/modules/ui/search-param-modal";
import { SectionFrame } from "@/modules/ui/section-frame";

import {
	INTEGRATIONS_PAGE_SIZE,
	integrationProvidersAtom,
	integrationReactivityKeys,
	integrationsAtom,
	syncIntegrationsAtom,
} from "./atoms";
import { INTEGRATION_WIZARD_TITLE, IntegrationCreateWizard } from "./integration-create-wizard";
import { IntegrationsView } from "./integrations-view";
import { mapIntegrationList, mapIntegrationProviderNames } from "./state";

export function IntegrationsScreen() {
	const scope = useApiScope();
	const createModal = useSearchParamModal("create");
	const [limit, setLimit] = useState(INTEGRATIONS_PAGE_SIZE);
	const listAtom = integrationsAtom({ limit, scope });
	const result = useAtomValue(listAtom);
	const refresh = useAtomRefresh(listAtom);
	const syncIntegrations = useAtomSet(syncIntegrationsAtom(scope), { mode: "promiseExit" });
	const providers = useAtomValue(integrationProvidersAtom(scope));
	const [isSyncing, setIsSyncing] = useState(false);
	const [syncCause, setSyncCause] = useState<unknown>();
	const [syncDetail, setSyncDetail] = useState<string | undefined>();
	const [syncSucceeded, setSyncSucceeded] = useState(false);
	const state = mapIntegrationList(result);
	const loaded = state.status === "ready" ? state.integrations.length : 0;
	useInternalRequestFailureLogging(
		"integrations query failed",
		AsyncResult.isFailure(result) ? result.cause : undefined,
	);
	useInternalRequestFailureLogging(
		"integration providers query failed",
		AsyncResult.isFailure(providers) ? providers.cause : undefined,
	);
	useInternalRequestFailureLogging("integration sync failed", syncCause);

	async function syncAll() {
		setIsSyncing(true);
		setSyncCause(undefined);
		setSyncDetail(undefined);
		setSyncSucceeded(false);
		const exit = await syncIntegrations({ reactivityKeys: integrationReactivityKeys(scope) });
		setIsSyncing(false);
		if (Exit.isFailure(exit)) {
			setSyncCause(exit.cause);
			setSyncDetail(
				requestFailureMessage(exit.cause) ?? "Integration sync could not be started. Try again.",
			);
			return;
		}
		setSyncSucceeded(true);
		setSyncDetail("Sync started. Updates will appear as integrations finish.");
	}
	return (
		<SectionFrame title="Integrations">
			<IntegrationsView
				state={state}
				onRetry={refresh}
				nowMs={Date.now()}
				isSyncing={isSyncing}
				syncDetail={syncDetail}
				onConnect={createModal.open}
				syncSucceeded={syncSucceeded}
				onSyncAll={() => void syncAll()}
				isLoadingMore={result.waiting && loaded < limit}
				providerNames={mapIntegrationProviderNames(providers)}
				onOpenImports={() => router.push("/settings/import-data")}
				onShowMore={() => setLimit(limit + INTEGRATIONS_PAGE_SIZE)}
				onOpen={(integrationId) =>
					router.push({
						params: { integrationId },
						pathname: "/settings/integrations/[integrationId]",
					})
				}
			/>
			<SearchParamModalHost
				isOpen={createModal.isOpen}
				onClose={createModal.close}
				title={INTEGRATION_WIZARD_TITLE}
				closeLabel="Close the integration wizard"
			>
				<IntegrationCreateWizard onClose={createModal.close} />
			</SearchParamModalHost>
		</SectionFrame>
	);
}
