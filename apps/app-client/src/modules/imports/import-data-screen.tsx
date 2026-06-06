import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { router } from "expo-router";
import { useState } from "react";

import { useApiScope } from "@/api/scope";
import { useInternalRequestFailureLogging } from "@/api/use-internal-request-failure-logging";
import { SettingsSectionFrame } from "@/modules/settings/settings-section-frame";

import { IMPORT_RUNS_PAGE_SIZE, importRunsAtom, importSourcesAtom } from "./atoms";
import { ImportDataView } from "./import-data-view";
import { ImportStartHost, useImportStartFlow } from "./import-start-host";
import { liveImportRun } from "./run-presentation";
import { mapImportRunList, mapImportSourceNames } from "./state";
import { IMPORT_LIST_POLL_MS, useImportRunPolling } from "./use-import-run-polling";

export function ImportDataScreen() {
	const scope = useApiScope();
	const startFlow = useImportStartFlow();
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
	useImportRunPolling({
		refresh,
		intervalMs: IMPORT_LIST_POLL_MS,
		enabled: liveImportRun(loaded) !== undefined,
	});

	return (
		<SettingsSectionFrame title="Import data">
			<ImportDataView
				state={state}
				onRetry={refresh}
				nowMs={Date.now()}
				onStartImport={startFlow.open}
				sourceNames={mapImportSourceNames(sources)}
				isLoadingOlder={result.waiting && loaded.length < limit}
				onShowOlder={() => setLimit(limit + IMPORT_RUNS_PAGE_SIZE)}
				onOpenIntegrations={() => router.push("/settings/integrations")}
				onOpenRun={(runId) =>
					router.push({ params: { runId }, pathname: "/settings/import-data/[runId]" })
				}
			/>
			<ImportStartHost />
		</SettingsSectionFrame>
	);
}
