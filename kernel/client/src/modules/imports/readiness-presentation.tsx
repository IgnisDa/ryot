import type { IngestionReadiness } from "@ryot-app/contract/modules/plugins/ingestion-readiness";
import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

import { ingestionBlockReasonMessage, ingestionBlockReasonsMessage } from "./run-presentation";

export const ingestionReadinessRequirement = (
	t: (message: Message) => Text,
	readiness: IngestionReadiness,
	scope: null | "user" | "system",
) =>
	readiness.ready
		? undefined
		: t(
				ingestionBlockReasonsMessage(
					readiness.blockReasons,
					kernelMessage("client.ui.wizard.service.installation-unavailable"),
					scope,
				),
			);

export function IngestionReadinessNotice(props: {
	readonly readiness: IngestionReadiness;
	readonly scope: null | "user" | "system";
}) {
	const t = useT();
	return props.readiness.ready ? null : (
		<div role="status" className="text-sm text-text-muted">
			<p className="font-medium">{t(kernelMessage("client.imports.setup-required"))}</p>
			{props.readiness.blockReasons.length === 0 ? (
				<p>{t(kernelMessage("client.ui.wizard.service.installation-unavailable"))}</p>
			) : null}
			<ul>
				{props.readiness.blockReasons.map((reason) => (
					<li key={`${reason.code}:${reason.key}`}>
						{t(ingestionBlockReasonMessage(reason, props.scope))}
					</li>
				))}
			</ul>
		</div>
	);
}
