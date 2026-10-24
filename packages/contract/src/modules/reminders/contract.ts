import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { SubmissionExpired } from "../../errors";
import { ReminderId } from "../../schema/brands";
import {
	ChangeReminderBody,
	CreateReminderBody,
	EditReminderBody,
	ReminderCommandResult,
	ReminderConflict,
	ReminderDeliveryConfiguration,
	ReminderInvalid,
	ReminderNotFound,
} from "./schemas";

const reminderErrors = [
	SubmissionExpired.pipe(HttpApiSchema.status(410)),
	ReminderInvalid.pipe(HttpApiSchema.status(400)),
	ReminderConflict.pipe(HttpApiSchema.status(409)),
	ReminderNotFound.pipe(HttpApiSchema.status(404)),
];

export const RemindersGroup = HttpApiGroup.make("reminders")
	.annotate(OpenApi.Description, "Create and manage reminders.")
	.add(
		HttpApiEndpoint.get("deliveryConfiguration", "/reminders/delivery-configuration", {
			success: ReminderDeliveryConfiguration,
		}).annotate(OpenApi.Description, "Read server notification delivery and scan configuration."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("create", "/reminders", {
			error: reminderErrors,
			payload: CreateReminderBody,
			success: ReminderCommandResult.pipe(HttpApiSchema.status(201)),
		}).annotate(OpenApi.Description, "Create a reminder."),
	)
	.add(
		AuthenticatedMutationEndpoint.patch("protected")("edit", "/reminders/:reminderId", {
			error: reminderErrors,
			payload: EditReminderBody,
			success: ReminderCommandResult,
			params: { reminderId: ReminderId },
		}).annotate(OpenApi.Description, "Edit a reminder by ID."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("cancel", "/reminders/:reminderId/cancel", {
			error: reminderErrors,
			payload: ChangeReminderBody,
			success: ReminderCommandResult,
			params: { reminderId: ReminderId },
		}).annotate(OpenApi.Description, "Cancel a reminder by ID."),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("protected")("remove", "/reminders/:reminderId", {
			error: reminderErrors,
			payload: ChangeReminderBody,
			success: ReminderCommandResult,
			params: { reminderId: ReminderId },
		}).annotate(OpenApi.Description, "Remove a reminder by ID."),
	)
	.middleware(AuthMiddleware);
