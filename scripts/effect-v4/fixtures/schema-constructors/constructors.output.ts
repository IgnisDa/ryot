import { Schema } from "effect";

declare const values: readonly ["a", "b"];
declare const schemas: readonly [typeof Schema.String, typeof Schema.Number];

const literalOne = Schema.Literal("a");
const literalTwo = Schema.Literals<["a", "b"]>(["a", "b"]);
const literalMany = Schema.Literals(["a", "b", "c"]);
const literalSpread = Schema.Literals([...values]);

const unionZero = Schema.Union([]);
const unionOne = Schema.Union([Schema.String]);
const unionTwo = Schema.Union<typeof schemas>([Schema.String, Schema.Number]);
const unionMany = Schema.Union([Schema.String, Schema.Number, Schema.Boolean]);
const unionSpread = Schema.Union([...schemas]);
const unionMixedSpread = Schema.Union([Schema.Boolean, ...schemas]);

const tupleZero = Schema.Tuple([/* empty */]);
const tupleOne = Schema.Tuple([Schema.String]);
const tupleMany = Schema.Tuple([
	Schema.String, // string element
	Schema.Number,
]);
const tupleArray = Schema.Tuple([Schema.String, Schema.Number]);
