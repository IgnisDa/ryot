import type { ReminderReason } from "@ryot-app/contract/modules/reminders/schemas";
import { kernelMessage } from "@ryot-app/kernel-messages/message";

export const reminderReasonMessages = {
	cancelled: kernelMessage("client.reminders.state.cancelled"),
	"delivery-unknown": kernelMessage("client.reminders.delivery.unknown"),
	"server-disabled": kernelMessage("client.reminders.reason.server-disabled"),
	"channel-deleted": kernelMessage("client.reminders.reason.channel-deleted"),
	"formatter-failed": kernelMessage("client.reminders.reason.formatter-failed"),
	"channel-disabled": kernelMessage("client.reminders.reason.channel-disabled"),
	"source-cancelled": kernelMessage("client.reminders.reason.source-cancelled"),
	"formatter-expired": kernelMessage("client.reminders.reason.formatter-expired"),
	"admission-missing": kernelMessage("client.reminders.reason.admission-missing"),
	"provider-rejected": kernelMessage("client.reminders.reason.provider-rejected"),
	"preparation-failed": kernelMessage("client.reminders.reason.preparation-failed"),
	"no-enabled-channels": kernelMessage("client.reminders.reason.no-enabled-channels"),
	"subscription-disabled": kernelMessage("client.reminders.reason.subscription-disabled"),
} as const satisfies Record<ReminderReason, ReturnType<typeof kernelMessage>>;
