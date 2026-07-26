import { NotificationChannelKind } from "@ryot/contract/modules/notifications/types";
import {
	BooleanFieldValue,
	DateFieldValue,
	RowsPageInfo,
	TextFieldValue,
	rowsResultSchema,
} from "@ryot/contract/modules/ryotql/language";
import { NotificationChannelId } from "@ryot/contract/schema/brands";
import { strictStruct } from "@ryot/contract/schema/utils";
import { column, descending, document, field, rows, table } from "@ryot/ryotql";
import { DateTime, Option, Result, Schema } from "effect";

const notificationChannelWire = strictStruct({
	id: TextFieldValue,
	channel: TextFieldValue,
	createdAt: DateFieldValue,
	updatedAt: DateFieldValue,
	description: TextFieldValue,
	isDisabled: BooleanFieldValue,
});

const notificationChannelsResponse = strictStruct({
	data: strictStruct({ notificationChannels: rowsResultSchema(notificationChannelWire) }),
});

export const NotificationChannelSummary = strictStruct({
	createdAt: Schema.String,
	updatedAt: Schema.String,
	id: NotificationChannelId,
	description: Schema.String,
	isDisabled: Schema.Boolean,
	channel: NotificationChannelKind,
});
export type NotificationChannelSummary = typeof NotificationChannelSummary.Type;

export const NotificationChannelList = strictStruct({
	items: Schema.Array(NotificationChannelSummary),
	pageInfo: RowsPageInfo,
});
export type NotificationChannelList = typeof NotificationChannelList.Type;

const normalizeDate = (fieldName: string, value: typeof DateFieldValue.Type) => {
	const parsed = DateTime.make(value.value);
	return Option.isSome(parsed)
		? Result.succeed(DateTime.formatIso(parsed.value))
		: Result.fail(new Error(`Expected RyotQL ${fieldName} to be a valid date`));
};

const decodeNotificationChannel = (row: typeof notificationChannelWire.Type) =>
	Result.all([
		normalizeDate("createdAt", row.createdAt),
		normalizeDate("updatedAt", row.updatedAt),
		Schema.decodeUnknownResult(NotificationChannelKind)(row.channel.value),
	] as const).pipe(
		Result.map(
			([createdAt, updatedAt, channel]) =>
				({
					channel,
					createdAt,
					updatedAt,
					isDisabled: row.isDisabled.value,
					description: row.description.value,
					id: NotificationChannelId.make(row.id.value),
				}) satisfies NotificationChannelSummary,
		),
	);

export const buildNotificationChannelsDocument = (input: {
	readonly after?: string | undefined;
	readonly limit: number;
}) => {
	const notificationChannel = table("notificationChannel", "notificationChannel");
	return document({
		notificationChannels: rows(notificationChannel, {
			after: input.after,
			limit: input.limit,
			orderBy: [
				descending(column(notificationChannel, "createdAt")),
				descending(column(notificationChannel, "id")),
			],
			fields: [
				field("id", column(notificationChannel, "id")),
				field("channel", column(notificationChannel, "channel")),
				field("description", column(notificationChannel, "description")),
				field("isDisabled", column(notificationChannel, "isDisabled")),
				field("createdAt", column(notificationChannel, "createdAt")),
				field("updatedAt", column(notificationChannel, "updatedAt")),
			],
		}),
	});
};

const decodeNotificationChannelsResult = Schema.decodeUnknownResult(notificationChannelsResponse);

export const decodeNotificationChannelsResponse = (response: unknown) =>
	Result.flatMap(decodeNotificationChannelsResult(response), ({ data }) =>
		Result.map(
			Result.all(data.notificationChannels.items.map(decodeNotificationChannel)),
			(items) =>
				({ items, pageInfo: data.notificationChannels.pageInfo }) satisfies NotificationChannelList,
		),
	);
