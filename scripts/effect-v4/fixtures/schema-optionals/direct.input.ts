import { Schema } from "effect";

declare const fallback: () => string;

const empty = Schema.optionalWith(Schema.Array(Schema.String), { default: () => [] });
const dynamic = Schema.optionalWith(Schema.String, { default: () => fallback() });
const expression = Schema.optionalWith(condition ? Schema.String : Schema.Number, {
	default: function () {
		return nextValue();
	},
});

void [empty, dynamic, expression];
