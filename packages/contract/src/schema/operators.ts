import { Schema } from "effect";

export const ArithmeticOperator = Schema.Literals(["add", "subtract", "multiply", "divide"]);
export type ArithmeticOperator = typeof ArithmeticOperator.Type;

export const ComparisonOperator = Schema.Literals(["eq", "neq", "gt", "gte", "lt", "lte"]);
export type ComparisonOperator = typeof ComparisonOperator.Type;
