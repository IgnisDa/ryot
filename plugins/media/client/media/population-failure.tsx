import { useRetryEntityPopulation } from "@ryot-app/plugin-client-sdk/react";
import { StatusMessage } from "@ryot-app/plugin-ui-sdk";

import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";

export function MediaPopulationFailure(props: {
	readonly entityId: string;
	readonly providerName: string | null;
}) {
	const retry = useRetryEntityPopulation();
	return (
		<StatusMessage
			tone="error"
			action={{
				label: "Try again",
				disabled: retry.isPending,
				onClick: () => retry.mutate({ entityId: props.entityId, packageId: PLUGIN_PACKAGE_ID }),
			}}
		>
			{`Couldn't load details from ${props.providerName ?? "the provider"}.`}
		</StatusMessage>
	);
}
