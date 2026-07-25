import {
	BooleanFieldValue,
	DateFieldValue,
	TextFieldValue,
	rowsResultSchema,
} from "@ryot/contract/modules/ryotql/language";
import { AutomationRuleId, SignalSchemaSlug } from "@ryot/contract/schema/brands";
import { strictStruct } from "@ryot/contract/schema/utils";
import { ascending, column, document, eq, field, literal, rows, table } from "@ryot/ryotql";
import { DateTime, Option, Result, Schema } from "effect";

const notificationSubscriptionStateWire = strictStruct({
	id: TextFieldValue,
	createdAt: DateFieldValue,
	updatedAt: DateFieldValue,
	isActive: BooleanFieldValue,
	signalSchemaSlug: TextFieldValue,
});

const notificationSubscriptionStatesResponse = strictStruct({
	data: strictStruct({
		notificationSubscriptionStates: rowsResultSchema(notificationSubscriptionStateWire),
	}),
});

const notificationSubscriptionStateResponse = strictStruct({
	data: strictStruct({
		notificationSubscriptionState: rowsResultSchema(notificationSubscriptionStateWire),
	}),
});

export const NotificationSubscriptionState = strictStruct({
	id: AutomationRuleId,
	isActive: Schema.Boolean,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	signalSchemaSlug: SignalSchemaSlug,
});
export type NotificationSubscriptionState = typeof NotificationSubscriptionState.Type;

const NotificationSubscriptionStatePageInfo = strictStruct({
	page: Schema.Int,
	limit: Schema.Int,
	total: Schema.Int,
	hasMore: Schema.Boolean,
});

export const NotificationSubscriptionStateList = strictStruct({
	pageInfo: NotificationSubscriptionStatePageInfo,
	items: Schema.Array(NotificationSubscriptionState),
});
export type NotificationSubscriptionStateList = typeof NotificationSubscriptionStateList.Type;

const normalizeDate = (fieldName: string, value: typeof DateFieldValue.Type) => {
	const parsed = DateTime.make(value.value);
	return Option.isSome(parsed)
		? Result.succeed(DateTime.formatIso(parsed.value))
		: Result.fail(new Error(`Expected RyotQL ${fieldName} to be a valid date`));
};

const decodeNotificationSubscriptionState = (row: typeof notificationSubscriptionStateWire.Type) =>
	Result.all([
		normalizeDate("createdAt", row.createdAt),
		normalizeDate("updatedAt", row.updatedAt),
	] as const).pipe(
		Result.map(
			([createdAt, updatedAt]) =>
				({
					createdAt,
					updatedAt,
					isActive: row.isActive.value,
					id: AutomationRuleId.make(row.id.value),
					signalSchemaSlug: SignalSchemaSlug.make(row.signalSchemaSlug.value),
				}) satisfies NotificationSubscriptionState,
		),
	);

const notificationSubscriptionStateFields = (
	notificationSubscriptionState: ReturnType<typeof table>,
) => [
	field("id", column(notificationSubscriptionState, "id")),
	field("signalSchemaSlug", column(notificationSubscriptionState, "signalSchemaSlug")),
	field("isActive", column(notificationSubscriptionState, "isActive")),
	field("createdAt", column(notificationSubscriptionState, "createdAt")),
	field("updatedAt", column(notificationSubscriptionState, "updatedAt")),
];

export const buildNotificationSubscriptionStatesDocument = (input: {
	readonly page: number;
	readonly limit: number;
}) => {
	const notificationSubscriptionState = table(
		"notificationSubscriptionState",
		"notificationSubscriptionState",
	);
	return document({
		notificationSubscriptionStates: rows(notificationSubscriptionState, {
			page: input.page,
			limit: input.limit,
			fields: notificationSubscriptionStateFields(notificationSubscriptionState),
			orderBy: [
				ascending(column(notificationSubscriptionState, "signalSchemaSlug")),
				ascending(column(notificationSubscriptionState, "id")),
			],
		}),
	});
};

export const buildNotificationSubscriptionStateDocument = (input: { readonly id: string }) => {
	const notificationSubscriptionState = table(
		"notificationSubscriptionState",
		"notificationSubscriptionState",
	);
	return document({
		notificationSubscriptionState: rows(notificationSubscriptionState, {
			limit: 1,
			fields: notificationSubscriptionStateFields(notificationSubscriptionState),
			orderBy: [ascending(column(notificationSubscriptionState, "id"))],
			where: eq(column(notificationSubscriptionState, "id"), literal(input.id)),
		}),
	});
};

const decodeNotificationSubscriptionStatesResult = Schema.decodeUnknownResult(
	notificationSubscriptionStatesResponse,
);
const decodeNotificationSubscriptionStateResult = Schema.decodeUnknownResult(
	notificationSubscriptionStateResponse,
);

export const decodeNotificationSubscriptionStatesResponse = (response: unknown) =>
	Result.flatMap(decodeNotificationSubscriptionStatesResult(response), ({ data }) =>
		Result.map(
			Result.all(
				data.notificationSubscriptionStates.items.map(decodeNotificationSubscriptionState),
			),
			(items) =>
				({
					items,
					pageInfo: data.notificationSubscriptionStates.pageInfo,
				}) satisfies NotificationSubscriptionStateList,
		),
	);

export const decodeNotificationSubscriptionStateResponse = (response: unknown) =>
	Result.flatMap(decodeNotificationSubscriptionStateResult(response), ({ data }) => {
		const [state] = data.notificationSubscriptionState.items;
		return state ? decodeNotificationSubscriptionState(state) : Result.succeed(null);
	});
