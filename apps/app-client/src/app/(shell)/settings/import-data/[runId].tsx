import { useLocalSearchParams } from "expo-router";

import { ImportRunScreen } from "@/modules/imports/import-run-screen";
import { NavigationStatus } from "@/modules/navigation/navigation-status";

export default function ImportRunDetails() {
	const { runId } = useLocalSearchParams<{ runId?: string | string[] }>();
	const normalizedRunId = (Array.isArray(runId) ? runId[0] : runId)?.trim();

	if (!normalizedRunId) {
		return <NavigationStatus title="Import unavailable" detail="The import URL is invalid." />;
	}
	return <ImportRunScreen runId={normalizedRunId} />;
}
