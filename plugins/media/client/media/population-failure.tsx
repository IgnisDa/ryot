import { StatusMessage } from "@ryot-app/plugin-ui-sdk";

import { useMediaEnrichment } from "./enrichment";

export function MediaTranslationFailure(props: { readonly entityId: string }) {
	const retry = useMediaEnrichment(props.entityId, "translation", "retry");
	return (
		<StatusMessage
			tone="error"
			action={{ onClick: retry.submit, disabled: retry.isPending, label: "Retry translation" }}
		>
			Translation failed. Showing available text.
		</StatusMessage>
	);
}

export function MediaPopulationFailure(props: {
	readonly entityId: string;
	readonly providerName: null | string;
}) {
	const retry = useMediaEnrichment(props.entityId, "population", "retry");
	return (
		<StatusMessage
			tone="error"
			action={{ label: "Try again", onClick: retry.submit, disabled: retry.isPending }}
		>
			{`Couldn't load details from ${props.providerName ?? "the provider"}.`}
		</StatusMessage>
	);
}
