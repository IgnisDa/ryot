import { DisplayText } from "@ryot-app/i18n/message";
import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";

export const browseSort = <Text extends Schema.Top>(text: Text) =>
	strictStruct({
		label: text,
		ascending: text,
		descending: text,
		defaultDirection: Schema.Literals(["asc", "desc"]),
	});

export const BrowseSort = browseSort(DisplayText);
export type BrowseSort = typeof BrowseSort.Type;
