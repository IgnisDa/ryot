import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { router } from "expo-router";
import { useState } from "react";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { liveImportRun } from "@/modules/import-runs/run-presentation";
import { SettingsSectionFrame } from "@/modules/settings/settings-section-frame";
import { RUN_LIST_POLL_MS, useRunPolling } from "@/modules/ui/run/use-run-polling";
import { SearchParamModalHost, useSearchParamModal } from "@/modules/ui/search-param-modal";

import { IMPORT_RUNS_PAGE_SIZE, importRunsAtom, importSourcesAtom } from "./atoms";
import { ImportDataView } from "./import-data-view";
import { IMPORT_WIZARD_TITLE, ImportStartWizard } from "./import-start-wizard";
import { mapImportRunList, mapImportSourceNames } from "./state";

export function ImportDataScreen() {
	const scope = useApiScope();
	const startModal = useSearchParamModal("start");
	const [limit, setLimit] = useState(IMPORT_RUNS_PAGE_SIZE);
	const runsAtom = importRunsAtom({ limit, scope });
	const result = useAtomValue(runsAtom);
	const refresh = useAtomRefresh(runsAtom);
	const sources = useAtomValue(importSourcesAtom(scope));
	const state = mapImportRunList(result);
	const loaded = state.status === "ready" ? state.runs : [];
	useInternalRequestFailureLogging(
		"import runs query failed",
		AsyncResult.isFailure(result) ? result.cause : undefined,
	);
	useInternalRequestFailureLogging(
		"import sources query failed",
		AsyncResult.isFailure(sources) ? sources.cause : undefined,
	);
	useRunPolling({
		refresh,
		intervalMs: RUN_LIST_POLL_MS,
		enabled: liveImportRun(loaded) !== undefined,
	});

	return (
		<SettingsSectionFrame title="Import data">
			<ImportDataView
				state={state}
				onRetry={refresh}
				nowMs={Date.now()}
				onStartImport={startModal.open}
				sourceNames={mapImportSourceNames(sources)}
				isLoadingOlder={result.waiting && loaded.length < limit}
				onShowOlder={() => setLimit(limit + IMPORT_RUNS_PAGE_SIZE)}
				onOpenIntegrations={() => router.push("/settings/integrations")}
				onOpenRun={(runId) =>
					router.push({ params: { runId }, pathname: "/settings/import-data/[runId]" })
				}
			/>
			<SearchParamModalHost
				isOpen={startModal.isOpen}
				onClose={startModal.close}
				title={IMPORT_WIZARD_TITLE}
				closeLabel="Close the import wizard"
			>
				<ImportStartWizard onClose={startModal.close} />
			</SearchParamModalHost>
		</SettingsSectionFrame>
	);
}
