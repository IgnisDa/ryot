import { Schema } from "effect";

import { CalendarSourceSlug, PluginId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";

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
