import type {
	DateArgument,
	LocalMessageBuilder,
	MessageBuilder,
	MessageParams,
	NoArguments,
	NumberArgument,
	SelectArgument,
	TextArgument,
} from "./builder";
import type { LocalMessage, Message } from "./message";

export type BuilderChecks = [
	Assert<Equal<MessageParams<Catalog["item.plain"], Message>, []>>,
	Assert<
		Equal<
			MessageParams<Catalog["item.summary"], Message>,
			[
				params: {
					readonly at: Date;
					readonly count: number;
					readonly name: string | Message;
					readonly status: "done" | "pending";
				},
			]
		>
	>,
	Assert<
		Equal<MessageParams<Catalog["item.summary"], LocalMessage>[0]["name"], string | LocalMessage>
	>,
	Assert<Equal<Parameters<MessageBuilder<Catalog>>[0], "item.plain" | "item.summary">>,
	Assert<Equal<ReturnType<LocalMessageBuilder<Catalog>>, LocalMessage>>,
];
type Assert<Condition extends true> = Condition;

type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false;

type Catalog = {
	readonly "item.plain": NoArguments;
	readonly "item.summary": {
		readonly at: DateArgument;
		readonly name: TextArgument;
		readonly count: NumberArgument;
		readonly status: SelectArgument<"done" | "pending">;
	};
};
