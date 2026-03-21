import type { ViewExpression } from "~/lib/views/expression";
import type { ViewExpressionTypeInfo } from "~/lib/views/expression-analysis";
import { getPropertyDisplayKind } from "~/lib/views/policy";

import type { ResolvedDisplayValue } from "./schemas";

export const getLiteralDisplayKind = (
	input: Extract<ViewExpression, { type: "literal" }>,
): ResolvedDisplayValue["kind"] => {
	const { value } = input;
	if (value === null) {
		return "null";
	}

	if (input.literalType === "date") {
		return "date";
	}

	if (typeof value === "string") {
		return "text";
	}

	if (typeof value === "number") {
		return "number";
	}

	if (typeof value === "boolean") {
		return "boolean";
	}

	return "json";
};

export const getExpressionDisplayKind = (
	typeInfo: ViewExpressionTypeInfo,
): ResolvedDisplayValue["kind"] => {
	if (typeInfo.kind === "null") {
		return "null";
	}

	if (typeInfo.kind === "image") {
		return "image";
	}

	return getPropertyDisplayKind(typeInfo.propertyType);
};
