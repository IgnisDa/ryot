import { Schema } from "effect";

export class Direct extends Schema.TaggedError<Direct>()("Direct", {}) {}

export class Multiline extends Schema.TaggedError<Multiline>()(
	"Multiline",
	{
		message: Schema.String,
	},
) {}

export class Annotated extends Schema.TaggedError<Annotated>()(
	"Annotated",
	{ reason: Schema.String },
	{ description: "annotated failure" },
) {}
