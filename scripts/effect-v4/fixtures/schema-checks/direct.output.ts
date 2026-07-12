import { Schema } from "effect";

const number = Schema.Number.pipe(
	Schema.check(Schema.isGreaterThan(0, { message: getPositiveMessage() })),
	Schema.check(Schema.isGreaterThanOrEqualTo(0)),
	Schema.check(Schema.isGreaterThan(0)),
	Schema.check(Schema.isGreaterThanOrEqualTo(1, {
		title: "lower bound",
		// Keep message position and comments.
		message: getMinimumMessage(),
		description: "inclusive",
	})),
	Schema.check(Schema.isLessThan(100)),
	Schema.check(Schema.isLessThanOrEqualTo(99)),
	Schema.check(Schema.isBetween({
        minimum: getMinimum(/* evaluate once */),
        maximum: getMaximum()
    }, { message: "range" })),
	Schema.check(Schema.isInt()),
	Schema.check(Schema.isMultipleOf(2)),
	Schema.check(Schema.isFinite()),
);

const string = Schema.String.pipe(
	Schema.check(Schema.isMinLength(
		1,
		// Keep annotation attached to check arguments.
		{ message: "required" },
	)),
	Schema.check(Schema.isMaxLength(100)),
	Schema.check(Schema.isLengthBetween(1, 100)),
	Schema.check(Schema.isPattern(/^[a-z]+$/i)),
	Schema.check(Schema.isNonEmpty()),
);

const nested = Schema.String.pipe(Schema.check(Schema.isMinLength(1))).pipe(Schema.check(Schema.isMaxLength(20)));
const exact = Schema.String.pipe(Schema.check(Schema.isLengthBetween(2, 2, { message: "two" })));
const minItemsMessage = "at least one";
const array = Schema.Array(Schema.String).pipe(
	Schema.check(Schema.isMinLength(1, { message: minItemsMessage })),
	Schema.check(Schema.isMaxLength(2)),
);
