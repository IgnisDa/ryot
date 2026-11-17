import { useT } from "@ryot-app/i18n/react";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { useRyotMutation, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { Button, Notice, Row, RowGroup, Skeleton, Switch } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { Link } from "@tanstack/react-router";

import { reminderReadinessQuery, reminderSubscriptionMutation } from "./service";

const warningIcon = <AppIcon size={16} name="circle-alert" />;

export function ReminderReadiness(props: { readonly disabled?: boolean | undefined }) {
	const t = useT();
	const query = useRyotQuery(reminderReadinessQuery, undefined);
	const subscription = useRyotMutation(reminderSubscriptionMutation);
	const result = query.data;
	return (
		<section
			className="grid gap-2"
			aria-label={t(kernelMessage("client.reminders.readiness.delivery"))}
		>
			{query.isPending ? <Skeleton className="h-28 rounded-lg" /> : null}
			{query.isError ? (
				<Notice
					tone="warning"
					icon={warningIcon}
					action={
						<Button size="sm" variant="secondary" onClick={query.refetch}>
							{t(kernelMessage("common.action.retry"))}
						</Button>
					}
				>
					{t(kernelMessage("client.reminders.readiness.check-failed"))}
				</Notice>
			) : null}
			{result ? (
				<>
					{!result.configuration.dispatchersEnabled ? (
						<Notice tone="warning" icon={warningIcon}>
							{t(kernelMessage("client.reminders.readiness.processing-disabled"))}
						</Notice>
					) : null}
					{!result.configuration.deliveryEnabled ? (
						<Notice tone="warning" icon={warningIcon}>
							{t(kernelMessage("client.reminders.readiness.delivery-disabled"))}
						</Notice>
					) : null}
					<RowGroup>
						<Row
							leading={<RowIcon name="send" />}
							title={t(kernelMessage("client.settings.section.notification-channels"))}
							description={t(
								result.channels.enabledChannels === 0
									? kernelMessage("client.reminders.readiness.no-channels")
									: kernelMessage("client.reminders.readiness.enabled-channels", {
											count: result.channels.enabledChannels,
										}),
							)}
							trailing={
								<Link
									search={{ create: undefined }}
									to="/settings/notification-channels"
									className="shrink-0 text-label font-medium text-accent-text hover:underline"
								>
									{t(kernelMessage("client.reminders.readiness.manage"))}
								</Link>
							}
						/>
						<Row
							leading={<RowIcon name="clock" />}
							title={t(kernelMessage("client.reminders.readiness.subscription"))}
							description={t(
								result.channels.subscriptionEnabled
									? kernelMessage("client.reminders.readiness.subscription-on")
									: kernelMessage("client.reminders.readiness.subscription-off"),
							)}
							trailing={
								<Switch
									checked={result.channels.subscriptionEnabled}
									disabled={props.disabled === true || subscription.isPending}
									onChange={(enable) =>
										subscription.mutate({ enable, id: result.channels.subscriptionId })
									}
									label={t(
										result.channels.subscriptionEnabled
											? kernelMessage("client.reminders.readiness.disable-subscription")
											: kernelMessage("client.reminders.readiness.enable-subscription"),
									)}
								/>
							}
						/>
					</RowGroup>
					<p className="text-xs text-text-subtle">
						{t(
							kernelMessage("client.reminders.readiness.schedule-note", {
								schedule: result.configuration.scanSchedule,
							}),
						)}
					</p>
				</>
			) : null}
			{subscription.error ? (
				<Notice tone="danger">
					{t(kernelMessage("client.reminders.readiness.subscription-failed"))}
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
