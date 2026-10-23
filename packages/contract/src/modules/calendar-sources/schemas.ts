import { Schema } from "effect";

import { CalendarSourceSlug, PluginId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";
import type { PluginIdentityReference } from "../plugins/references";
import {
	Include,
	Join,
	mapPluginIdentityReferences,
	type NamedQuery,
	Predicate,
	RowSelection,
	type RowsOutput,
	type RyotQLDocument,
	TableReference,
} from "../ryotql/language";

export const CalendarSourcePrecision = Schema.Literals(["date", "instant"]);
export type CalendarSourcePrecision = typeof CalendarSourcePrecision.Type;

export const CalendarSourceQuery = strictStruct({
	from: TableReference,
	where: Schema.optional(Predicate),
	joins: Schema.optional(Schema.NonEmptyArray(Join)),
	output: strictStruct({
		type: Schema.Literal("rows"),
		fields: Schema.Array(RowSelection),
		include: Schema.optional(Schema.NonEmptyArray(Include)),
	}),
});
export type CalendarSourceQuery = typeof CalendarSourceQuery.Type;

const CALENDAR_SOURCE_QUERY_NAME = "source";

export const calendarSourceNamedQuery = (
	query: CalendarSourceQuery,
	output: Pick<RowsOutput, "orderBy" | "pagination">,
): NamedQuery => ({ ...query, output: { ...query.output, ...output } });

export const calendarSourceDocument = (query: CalendarSourceQuery): RyotQLDocument => ({
	queries: {
		[CALENDAR_SOURCE_QUERY_NAME]: calendarSourceNamedQuery(query, {
			orderBy: [],
			pagination: { limit: 1 },
		}),
	},
});

export const mapCalendarSourceQueryReferences = (
	query: CalendarSourceQuery,
	transform: (reference: PluginIdentityReference) => PluginIdentityReference,
): CalendarSourceQuery => {
	const mapped = mapPluginIdentityReferences(calendarSourceDocument(query), transform).queries[
		CALENDAR_SOURCE_QUERY_NAME
	];
	if (mapped?.output.type !== "rows") {
		throw new Error("Calendar source query mapping must preserve its rows output");
	}
	const { orderBy: _orderBy, pagination: _pagination, ...output } = mapped.output;
	return { ...mapped, output };
};

export const SetCalendarSourceVisibilityBody = strictStruct({
	pluginId: PluginId,
	isHidden: Schema.Boolean,
	slug: CalendarSourceSlug,
});
export type SetCalendarSourceVisibilityBody = typeof SetCalendarSourceVisibilityBody.Type;

export class CalendarSourceNotFound extends Schema.TaggedError<
	CalendarSourceNotFound,
	{ readonly brand: unique symbol }
>()("CalendarSourceNotFound", {
	reason: Schema.Struct({ code: Schema.Literal("calendar-source-not-found") }),
}) {}
