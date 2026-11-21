import {
	type CreateNotificationChannelBody,
	NotificationChannelSpecifics,
} from "@ryot-app/contract/modules/notifications/schemas";
import type { NotificationChannelKind } from "@ryot-app/contract/modules/notifications/types";
import {
	initialSchemaFormValues,
	type SchemaFormValues,
	toSchemaFormPayload,
} from "@ryot-app/plugin-ui-sdk/schema-form";
import { Result, Schema } from "effect";

import { notificationChannelDefinition } from "#/modules/notifications/channel-catalog";

const decodeSpecifics = Schema.decodeUnknownResult(NotificationChannelSpecifics);

export const initialNotificationChannelFormValues = (
	kind: NotificationChannelKind,
): SchemaFormValues => initialSchemaFormValues(notificationChannelDefinition(kind).schema);

export const createNotificationChannelBody = (input: {
	readonly values: SchemaFormValues;
	readonly kind: NotificationChannelKind;
}) => {
	const definition = notificationChannelDefinition(input.kind);
	const payload = toSchemaFormPayload(definition.schema, input.values);
	if (input.kind === "telegram" && payload.messageThreadId === null) {
		delete payload.messageThreadId;
	}
	const specifics = decodeSpecifics({ kind: input.kind, ...payload });
	return Result.isFailure(specifics)
		? Result.fail(specifics.failure)
		: Result.succeed({
				channelSpecifics: specifics.success,
			} satisfies CreateNotificationChannelBody);
};
