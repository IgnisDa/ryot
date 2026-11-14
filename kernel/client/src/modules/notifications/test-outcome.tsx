import { useRyotQuery } from "@ryot-app/plugin-client-sdk/react";

import { RUN_POLL_MS, useRunPolling } from "#/modules/ui/run/use-run-polling";

import { notificationOutcomeQuery } from "./service";

const outcomeLabels = {
	"not-sent": "Not sent. Server delivery or selected channels are unavailable.",
	failed: "Failed. The selected providers did not accept the test notification.",
	partial: "Partially accepted. At least one channel did not accept the test notification.",
	unknown:
		"Delivery unknown. A request may have reached a provider. It will not be resent automatically.",
	accepted:
		"Accepted by all selected notification providers. This does not confirm that the recipient read the message.",
};

export function NotificationTestOutcome(props: { readonly id: string }) {
	const outcome = useRyotQuery(notificationOutcomeQuery, props.id);
	useRunPolling({
		intervalMs: RUN_POLL_MS,
		refresh: outcome.refetch,
		enabled: outcome.data?.state === "admitted",
	});
	const result = outcome.data;
	let detail = "Test notification queued. Waiting for provider outcomes.";
	if (outcome.isError) {
		detail = "The test was queued, but its delivery outcome could not be loaded.";
	} else if (result?.outcome) {
		detail =
			result.reason === "no-enabled-channels"
				? "Not sent. No notification channels were enabled at admission."
				: outcomeLabels[result.outcome];
	}
	return (
		<p role="status" className="mt-3 text-sm text-muted-foreground">
			{detail}
		</p>
	);
}
