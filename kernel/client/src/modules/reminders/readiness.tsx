import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Notice, Row, RowGroup, Skeleton, Switch } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Link } from "@tanstack/react-router";

import { reminderReadinessQuery, reminderSubscriptionMutation } from "./service";

const warningIcon = <AppIcon size={16} name="circle-alert" />;

export function ReminderReadiness(props: { readonly disabled?: boolean | undefined }) {
	const query = useRyotQuery(reminderReadinessQuery, undefined);
	const subscription = useRyotMutation(reminderSubscriptionMutation);
	const result = query.data;
	return (
		<section aria-label="Delivery" className="grid gap-2">
			{query.isPending ? <Skeleton className="h-28 rounded-lg" /> : null}
			{query.isError ? (
				<Notice
					tone="warning"
					icon={warningIcon}
					action={
						<Button size="sm" variant="secondary" onClick={query.refetch}>
							Retry readiness
						</Button>
					}
				>
					Notification readiness could not be checked. Scheduling does not guarantee delivery.
				</Notice>
			) : null}
			{result ? (
				<>
					{!result.configuration.dispatchersEnabled ? (
						<Notice tone="warning" icon={warningIcon}>
							Scheduled processing is disabled on this server. Reminders wait until processing
							resumes.
						</Notice>
					) : null}
					{!result.configuration.deliveryEnabled ? (
						<Notice tone="warning" icon={warningIcon}>
							Notification delivery is disabled on this server. Due reminders will be Not sent.
						</Notice>
					) : null}
					<RowGroup>
						<Row
							title="Notification channels"
							leading={<RowIcon name="send" />}
							trailing={
								<Link
									search={{ create: undefined }}
									to="/settings/notification-channels"
									className="shrink-0 text-label font-medium text-accent-text hover:underline"
								>
									Manage
								</Link>
							}
							description={
								result.channels.enabledChannels === 0
									? "No notification channels are enabled. Due reminders will be Not sent."
									: `${result.channels.enabledChannels} enabled ${result.channels.enabledChannels === 1 ? "channel" : "channels"}. Provider acceptance is not guaranteed.`
							}
						/>
						<Row
							title="Reminder subscription"
							leading={<RowIcon name="clock" />}
							description={
								result.channels.subscriptionEnabled
									? "Due reminders go to your enabled channels."
									: "Your reminder subscription is disabled or missing. Due reminders will be Not sent."
							}
							trailing={
								<Switch
									checked={result.channels.subscriptionEnabled}
									disabled={props.disabled === true || subscription.isPending}
									label={`${result.channels.subscriptionEnabled ? "Disable" : "Enable"} reminder subscription`}
									onChange={(enable) =>
										subscription.mutate({ enable, id: result.channels.subscriptionId })
									}
								/>
							}
						/>
					</RowGroup>
					<p className="text-xs text-text-subtle">
						Checked {result.configuration.scanSchedule}, not at an exact minute. Enabling delivery
						later does not replay a Not sent occurrence.
					</p>
				</>
			) : null}
			{subscription.error ? (
				<Notice tone="danger">
					The subscription could not be changed. Reload readiness before trying again.
				</Notice>
			) : null}
		</section>
	);
}

function RowIcon(props: { readonly name: string }) {
	return (
		<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-muted">
			<AppIcon size={16} name={props.name} />
		</span>
	);
}
