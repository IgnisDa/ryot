import { Schema } from "effect";

const number = Schema.Number.pipe(
	Schema.positive({ message: () => getPositiveMessage() }),
	Schema.nonNegative(),
	Schema.greaterThan(0),
	Schema.greaterThanOrEqualTo(1, {
		title: "lower bound",
		// Keep message position and comments.
		message: () => getMinimumMessage(),
		description: "inclusive",
	}),
	Schema.lessThan(100),
	Schema.lessThanOrEqualTo(99),
	Schema.between(
		getMinimum(/* evaluate once */),
		getMaximum(),
		{ message: () => "range" },
	),
	Schema.int(),
	Schema.multipleOf(2),
	Schema.finite(),
);

const string = Schema.String.pipe(
	Schema.minLength(
		1,
		// Keep annotation attached to check arguments.
		{ message: () => "required" },
	),
	Schema.maxLength(100),
	Schema.length({ min: 1, max: 100 }),
	Schema.pattern(/^[a-z]+$/i),
	Schema.nonEmptyString(),
);

const nested = Schema.String.pipe(Schema.minLength(1)).pipe(Schema.maxLength(20));
const exact = Schema.String.pipe(Schema.length(2, { message: () => "two" }));
const minItemsMessage = "at least one";
const array = Schema.Array(Schema.String).pipe(
	Schema.minItems(1, { message: () => minItemsMessage }),
	Schema.maxItems(2),
);
