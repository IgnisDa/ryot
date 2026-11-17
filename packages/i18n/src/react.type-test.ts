import type { ReactElement } from "react";

import type { NumberArgument, SelectArgument, TextArgument } from "./builder";
import type { Message } from "./message";
import type { RichTextBuilder } from "./react";

declare const richText: RichTextBuilder<Catalog>;

export type RichTextChecks = [
	Assert<
		Equal<
			Parameters<typeof richText<"item.summary">>,
			[
				"item.summary",
				params: {
					readonly count: number;
					readonly status: "done" | "pending";
					readonly name: string | Message | ReactElement;
				},
			]
		>
	>,
];

type Assert<Condition extends true> = Condition;

type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;

type Catalog = {
	readonly "item.summary": {
		readonly name: TextArgument;
		readonly count: NumberArgument;
		readonly status: SelectArgument<"done" | "pending">;
	};
};
