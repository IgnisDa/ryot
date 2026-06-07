import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { router } from "expo-router";
import { useState } from "react";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { SearchParamModalHost, useSearchParamModal } from "@/modules/ui/search-param-modal";
import { SectionFrame } from "@/modules/ui/section-frame";

import { INTEGRATIONS_PAGE_SIZE, integrationProvidersAtom, integrationsAtom } from "./atoms";
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
	const providers = useAtomValue(integrationProvidersAtom(scope));
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

	return (
		<SectionFrame title="Integrations">
			<IntegrationsView
				state={state}
				onRetry={refresh}
				nowMs={Date.now()}
				onConnect={createModal.open}
				isLoadingMore={result.waiting && loaded < limit}
				providerNames={mapIntegrationProviderNames(providers)}
				onOpenImports={() => router.push("/settings/import-data")}
				onShowMore={() => setLimit(limit + INTEGRATIONS_PAGE_SIZE)}
				onSyncAll={() => console.log("TODO: trigger a sync for all integrations")}
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
