import { Schema } from "effect";

export const ArithmeticOperator = Schema.Literal("add", "subtract", "multiply", "divide");
export type ArithmeticOperator = typeof ArithmeticOperator.Type;

export const ComparisonOperator = Schema.Literal("eq", "neq", "gt", "gte", "lt", "lte");
export type ComparisonOperator = typeof ComparisonOperator.Type;
