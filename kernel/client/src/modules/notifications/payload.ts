import {
	initialSchemaFormValues,
	toSchemaFormPayload,
	type SchemaFormValues,
} from "@ryot-app/client-ui-sdk/schema-form";
import {
	NotificationChannelSpecifics,
	type CreateNotificationChannelBody,
} from "@ryot-app/contract/modules/notifications/schemas";
import type { NotificationChannelKind } from "@ryot-app/contract/modules/notifications/types";
import { Result, Schema } from "effect";

import { notificationChannelDefinition } from "#/modules/notifications/channel-catalog";

const decodeSpecifics = Schema.decodeUnknownResult(NotificationChannelSpecifics);

export const initialNotificationChannelFormValues = (
	kind: NotificationChannelKind,
): SchemaFormValues => initialSchemaFormValues(notificationChannelDefinition(kind).schema);

/**
 * Decoded through the contract union rather than trusted: a field the catalog spells differently
 * from the wire schema fails here instead of reaching the server. `toSchemaFormPayload` drops blank
 * values, which keeps untouched optional fields out of the payload.
 */
export const createNotificationChannelBody = (input: {
	readonly values: SchemaFormValues;
	readonly kind: NotificationChannelKind;
}) => {
	const definition = notificationChannelDefinition(input.kind);
	const specifics = decodeSpecifics({
		kind: input.kind,
		...toSchemaFormPayload(definition.schema, input.values),
	});
	return Result.isFailure(specifics)
		? Result.fail(specifics.failure)
		: Result.succeed({
				channel: input.kind,
				channelSpecifics: specifics.success,
			} satisfies CreateNotificationChannelBody);
};
