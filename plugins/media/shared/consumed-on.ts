import { Schema } from "@ryot-app/plugin-kit/effect";

import { CONSUMED_ON_ITEM_LIMIT, CONSUMED_ON_SOURCES_LIMIT } from "./consumed-on-settings";

const ConsumedOnText = Schema.Trim.pipe(
	Schema.check(Schema.isMinLength(1)),
	Schema.check(Schema.isMaxLength(CONSUMED_ON_ITEM_LIMIT)),
);

export const ConsumedOn = Schema.Array(ConsumedOnText).pipe(
	Schema.check(Schema.isMinLength(1)),
	Schema.check(Schema.isMaxLength(CONSUMED_ON_SOURCES_LIMIT)),
	Schema.check(
		Schema.makeFilter(
			(values) =>
				new Set(values.map((value) => value.toLowerCase())).size === values.length ||
				"Expected sources that are unique ignoring case",
		),
	),
);

export type ConsumedOn = typeof ConsumedOn.Type;

export const mergeConsumedOn = (...lists: readonly (readonly string[])[]): string[] => {
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const value of lists.flat()) {
		const key = value.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			merged.push(value);
		}
	}
	return merged.slice(0, CONSUMED_ON_SOURCES_LIMIT);
};

export const ConsumedOnSelection = Schema.NullOr(Schema.Array(Schema.String));

export const consumedOnLabel = (values: null | readonly string[]): string | undefined =>
	values === null || values.length === 0 ? undefined : values.join(", ");
