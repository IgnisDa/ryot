import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";

export const BrowseSort = strictStruct({
	label: Schema.NonEmptyString,
	ascending: Schema.NonEmptyString,
	descending: Schema.NonEmptyString,
	defaultDirection: Schema.Literals(["asc", "desc"]),
});
export type BrowseSort = typeof BrowseSort.Type;
