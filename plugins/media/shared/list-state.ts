import { Schema } from "@ryot-app/plugin-kit/effect";
import { IsoDateString } from "@ryot-app/plugin-kit/ryotql";

import { MediaPosition } from "./consumption";

const nonNegativeInteger = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
const positiveInteger = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));

const listStateDateSchema = Schema.Struct({
	year: Schema.optional(positiveInteger),
	day: Schema.optional(positiveInteger.pipe(Schema.check(Schema.isLessThanOrEqualTo(31)))),
	month: Schema.optional(positiveInteger.pipe(Schema.check(Schema.isLessThanOrEqualTo(12)))),
});

export const ListStatePropertiesSchema = Schema.Struct({
	sourceUpdatedAt: IsoDateString,
	repeatCount: nonNegativeInteger,
	source: Schema.Literal("anilist"),
	sourceEntryId: Schema.NonEmptyString,
	sourceAccountId: Schema.NonEmptyString,
	position: Schema.optional(MediaPosition),
	startedDate: Schema.optional(listStateDateSchema),
	completedDate: Schema.optional(listStateDateSchema),
	state: Schema.Literals(["backlog", "in_progress", "on_hold", "dropped", "complete"]),
});

export type ListStateProperties = Schema.Schema.Type<typeof ListStatePropertiesSchema>;
