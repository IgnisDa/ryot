import { type DisplayText, type Text, useDisplayText } from "@ryot-app/plugin-client-sdk/react";
import { Button, Notice } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import type { ReactNode } from "react";

import { useMediaMessages } from "../messages";
import { useMediaEnrichment } from "./enrichment";

export function MediaTranslationFailure(props: { readonly entityId: string }) {
	const text = useMediaMessages();
	return (
		<EnrichmentFailure
			kind="translation"
			entityId={props.entityId}
			label={text("enrichment.retry-translation")}
		>
			{text("enrichment.translation-failed")}
		</EnrichmentFailure>
	);
}

export function MediaPopulationFailure(props: {
	readonly entityId: string;
	readonly providerName: null | DisplayText;
}) {
	const text = useMediaMessages();
	const display = useDisplayText();
	return (
		<EnrichmentFailure
			kind="population"
			entityId={props.entityId}
			label={text("common.action.try-again")}
		>
			{props.providerName === null
				? text("enrichment.population-failed")
				: text("enrichment.population-failed-from", { provider: display(props.providerName) })}
		</EnrichmentFailure>
	);
}

function EnrichmentFailure(props: {
	readonly label: Text;
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
