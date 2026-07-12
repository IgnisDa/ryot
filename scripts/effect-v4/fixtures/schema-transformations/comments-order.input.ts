import { Schema } from "effect";

const transformed = Schema.transform(
	makeFrom(),
	makeTo(),
	/* options */ {
		encode: /* encode callback */ (value) => encodeValue(value),
		/* strict marker */ strict: true,
		decode: /* decode callback */ (value) => decodeValue(value),
	},
);
