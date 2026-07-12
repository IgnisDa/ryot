import { Schema } from "effect";

const supported = Schema.Struct({ value: Schema.String }).annotations({ identifier: "Supported" });
const unsupported = Schema.Struct({ value: Schema.String }).annotations<{ identifier: string }>({
	identifier: "Typed",
});
