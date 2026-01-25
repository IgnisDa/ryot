import { Schema } from "effect";
import { Schema as OtherSchema } from "other";

const literal = Schema.Literal("one");
const literals = Schema.Literals(["a", "b"]);
const union = Schema.Union([Schema.String, Schema.Number]);
const unionWithOptions = Schema.Union([Schema.String, Schema.Number], { mode: "oneOf" });
const record = Schema.Record(Schema.String, Schema.Number);
const tuple = Schema.Tuple([Schema.String, Schema.Number]);
const unrelated = OtherSchema.Union(OtherSchema.String, OtherSchema.Number);
const unrelatedTuple = OtherSchema.Tuple(OtherSchema.String, OtherSchema.Number);
const raw = String.raw`Schema.Literal("a", "b"); Schema.Union(Schema.String); Schema.Record({ key, value });`;

const shadowed = (Schema: { Union: (...schemas: unknown[]) => unknown }) =>
	Schema.Union("shadowed");
