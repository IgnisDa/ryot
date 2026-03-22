import {
	queryEngineArithmeticOperators,
	queryEngineComparisonOperators,
} from "@ryot/query-engine/primitives";
import { Schema } from "effect";

export const ArithmeticOperator = Schema.Literal(...queryEngineArithmeticOperators);
export type ArithmeticOperator = typeof ArithmeticOperator.Type;

export const ComparisonOperator = Schema.Literal(...queryEngineComparisonOperators);
export type ComparisonOperator = typeof ComparisonOperator.Type;
