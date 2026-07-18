import { Schema } from "effect";

export class Direct extends Schema.TaggedErrorClass<Direct>()("Direct", {}) {}

export class Multiline extends Schema.TaggedErrorClass<Multiline>()(
	"Multiline",
	{
		message: Schema.String,
	},
) {}

export class Annotated extends Schema.TaggedErrorClass<Annotated>()(
	"Annotated",
	{ reason: Schema.String },
	{ description: "annotated failure" },
) {}
