import { useLocalSearchParams } from "expo-router";

import { IntegrationDetailScreen } from "@/modules/integrations/integration-detail-screen";
import { NavigationStatus } from "@/modules/navigation/navigation-status";

export default function IntegrationDetails() {
	const { integrationId } = useLocalSearchParams<{ integrationId?: string | string[] }>();
	const normalizedId = (Array.isArray(integrationId) ? integrationId[0] : integrationId)?.trim();

	if (!normalizedId) {
		return (
			<NavigationStatus title="Integration unavailable" detail="The integration URL is invalid." />
		);
	}
	return <IntegrationDetailScreen integrationId={normalizedId} />;
}
