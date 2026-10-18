import { useRequestEntityEnrichment } from "@ryot-app/plugin-client-sdk/react";
import { useRef } from "react";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export const useMediaEnrichment = (
	entityId: string,
	operation: "population" | "translation",
	action: "refresh" | "retry",
) => {
	const mutation = useRequestEntityEnrichment();
	const key = useRef<string | null>(null);
	return {
		...mutation,
		submit: () => {
			if (mutation.status !== "error" || key.current === null) {
				key.current = crypto.randomUUID();
			}
			mutation.mutate({
				action,
				entityId,
				operation,
				idempotencyKey: key.current,
				packageId: PLUGIN_PACKAGE_ID,
			});
		},
	};
};
