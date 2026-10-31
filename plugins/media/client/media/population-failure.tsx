import { Button, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ReactNode } from "react";

import { useMediaEnrichment } from "./enrichment";

export function MediaTranslationFailure(props: { readonly entityId: string }) {
	return (
		<EnrichmentFailure kind="translation" entityId={props.entityId} label="Retry translation">
			Translation failed. Showing available text.
		</EnrichmentFailure>
	);
}

export function MediaPopulationFailure(props: {
	readonly entityId: string;
	readonly providerName: null | string;
}) {
	return (
		<EnrichmentFailure kind="population" label="Try again" entityId={props.entityId}>
			{`Couldn't load details from ${props.providerName ?? "the provider"}.`}
		</EnrichmentFailure>
	);
}

function EnrichmentFailure(props: {
	readonly label: string;
	readonly entityId: string;
	readonly children: ReactNode;
	readonly kind: "population" | "translation";
}) {
	const retry = useMediaEnrichment(props.entityId, props.kind, "retry");
	return (
		<Notice
			tone="warning"
			className="items-center"
			icon={<AppIcon size={16} name="circle-alert" />}
			action={
				<Button
					size="sm"
					variant="secondary"
					className="shrink-0"
					onClick={retry.submit}
					disabled={retry.isPending}
				>
					<AppIcon size={14} name="refresh-cw" />
					{props.label}
				</Button>
			}
		>
			{props.children}
		</Notice>
	);
}
