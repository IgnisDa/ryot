import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Notice } from "@ryot-app/plugin-ui-sdk";
import { Link } from "@tanstack/react-router";

import { reminderReadinessQuery, reminderSubscriptionMutation } from "./service";

export function ReminderReadiness(props: { readonly disabled?: boolean | undefined }) {
	const query = useRyotQuery(reminderReadinessQuery, undefined);
	const subscription = useRyotMutation(reminderSubscriptionMutation);
	const result = query.data;
	return (
		<div className="grid gap-2 text-sm">
			{query.isPending ? <p role="status">Checking notification readiness...</p> : null}
			{query.isError ? (
				<Notice tone="info">
					Notification readiness could not be checked. Scheduling does not guarantee delivery.{" "}
					<Button onClick={query.refetch}>Retry readiness</Button>
				</Notice>
			) : null}
			{result ? (
				<>
					<p>
						Server scan schedule: {result.configuration.scanSchedule}. This is not a precise alarm.
					</p>
					{!result.configuration.dispatchersEnabled ? (
						<Notice tone="info">
							Scheduled processing is disabled on this server. Reminders wait until processing
							resumes.
						</Notice>
					) : null}
					{!result.configuration.deliveryEnabled ? (
						<Notice tone="info">
							Notification delivery is disabled on this server. Due reminders will be Not sent.
						</Notice>
					) : null}
					{!result.channels.subscriptionEnabled ? (
						<Notice tone="info">
							Your reminder subscription is disabled or missing. Due reminders will be Not sent.
						</Notice>
					) : null}
					{result.channels.enabledChannels === 0 ? (
						<Notice tone="info">
							No notification channels are enabled. Due reminders will be Not sent.
						</Notice>
					) : (
						<p>
							{result.channels.enabledChannels} enabled notification channel(s). Provider acceptance
							is not guaranteed.
						</p>
					)}
					<Button
						variant="secondary"
						disabled={props.disabled === true || subscription.isPending}
						onClick={() =>
							subscription.mutate({
								id: result.channels.subscriptionId,
								enable: !result.channels.subscriptionEnabled,
							})
						}
					>
						{result.channels.subscriptionEnabled
							? "Disable reminder subscription"
							: "Enable reminder subscription"}
					</Button>
				</>
			) : null}
			{subscription.error ? (
				<Notice tone="danger">
					The subscription could not be changed. Reload readiness before trying again.
				</Notice>
			) : null}
			<p>
				<Link
					className="underline"
					search={{ create: undefined }}
					to="/settings/notification-channels"
				>
					Manage notification channels
				</Link>
			</p>
			<p>
				Scheduling never enables channels or subscriptions. Enabling delivery later does not replay
				a Not sent occurrence.
			</p>
		</div>
	);
}
