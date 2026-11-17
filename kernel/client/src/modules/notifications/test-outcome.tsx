import type { Message } from "@ryot-app/i18n/message";
import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { RUN_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";

import { notificationOutcomeQuery } from "./service";

const outcomeLabels = {
	failed: kernelMessage("client.notifications.outcome.failed"),
	partial: kernelMessage("client.notifications.outcome.partial"),
	unknown: kernelMessage("client.notifications.outcome.unknown"),
	accepted: kernelMessage("client.notifications.outcome.accepted"),
	"not-sent": kernelMessage("client.notifications.outcome.not-sent"),
};

export function NotificationTestOutcome(props: { readonly id: string }) {
	const t = useT();
	const outcome = useRyotQuery(notificationOutcomeQuery, props.id);
	useRunPolling({
		intervalMs: RUN_POLL_MS,
		refresh: outcome.refetch,
		enabled: outcome.data?.state === "admitted",
	});
	const result = outcome.data;
	let detail: Message = kernelMessage("client.notifications.outcome.queued");
	if (outcome.isError) {
		detail = kernelMessage("client.notifications.outcome.load-failed");
	} else if (result?.outcome) {
		detail =
			result.reason === "no-enabled-channels"
				? kernelMessage("client.notifications.outcome.no-channels")
				: outcomeLabels[result.outcome];
	}
	return (
		<p role="status" className="mt-3 text-sm text-muted-foreground">
			{t(detail)}
		</p>
	);
}
