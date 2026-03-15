import {
	queryEngineArithmeticOperators,
	queryEngineComparisonOperators,
} from "@ryot/query-engine/primitives";
import { Schema } from "effect";

export const ArithmeticOperator = Schema.Literals([...queryEngineArithmeticOperators]);
export type ArithmeticOperator = typeof ArithmeticOperator.Type;

export const ComparisonOperator = Schema.Literals([...queryEngineComparisonOperators]);
export type ComparisonOperator = typeof ComparisonOperator.Type;
