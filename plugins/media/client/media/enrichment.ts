import { useRequestEntityEnrichment } from "@ryot-app/plugin-client-sdk/react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export const useMediaEnrichment = (
	entityId: string,
	operation: "population" | "translation",
	action: "retry" | "refresh",
) => {
	const mutation = useRequestEntityEnrichment();
	return {
		...mutation,
		submit: () => {
			mutation.mutate({ action, entityId, operation, packageId: PLUGIN_PACKAGE_ID });
		},
	};
};
