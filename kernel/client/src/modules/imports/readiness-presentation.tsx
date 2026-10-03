import type { IngestionReadiness } from "@ryot-app/contract/modules/plugins/ingestion-readiness";

import { ingestionBlockReasonLabel } from "./run-presentation";

export const ingestionReadinessRequirement = (
	readiness: IngestionReadiness,
	scope: "system" | "user" | null,
) =>
	readiness.ready
		? undefined
		: readiness.blockReasons.map((reason) => ingestionBlockReasonLabel(reason, scope)).join(" ") ||
			"This service is unavailable in this plugin installation.";

export function IngestionReadinessNotice(props: {
	readonly readiness: IngestionReadiness;
	readonly scope: "system" | "user" | null;
}) {
	return props.readiness.ready ? null : (
		<div role="status" className="text-sm text-text-muted">
			<p className="font-medium">Setup required</p>
			{props.readiness.blockReasons.length === 0 ? (
				<p>This service is unavailable in this plugin installation.</p>
			) : null}
			<ul>
				{props.readiness.blockReasons.map((reason) => (
					<li key={`${reason.code}:${reason.key}`}>
						{ingestionBlockReasonLabel(reason, props.scope)}
					</li>
				))}
			</ul>
		</div>
	);
}
