import { sql } from "drizzle-orm";

import { QueryEngineValidationError } from "~/lib/views/errors";
import { normalizeExpressionPropertyType } from "~/lib/views/expression-analysis";
import type { PropertyType } from "~/lib/views/reference";

import { castExpressionToType, sanitizeIdentifier } from "./sql-expression-helpers";

export const buildSchemaReferenceExpression = (input: {
	alias: string;
	path: string[];
	dataColumn: string;
	referenceLabel: string;
	targetType?: PropertyType;
	resolvePropertyType: (column: string) => PropertyType | null;
}) => {
	const [column] = input.path;
	if (!column) {
		throw new QueryEngineValidationError(
			`${input.referenceLabel} reference path must not be empty`,
		);
	}

	if (input.path.length > 1) {
		throw new QueryEngineValidationError(
			`${input.referenceLabel} references do not support nested paths`,
		);
	}

	const propertyType = input.resolvePropertyType(column);
	if (!propertyType) {
		throw new QueryEngineValidationError(
			`Unsupported ${input.referenceLabel.toLowerCase()} column '${column}'`,
		);
	}

	const safeAlias = sanitizeIdentifier(input.alias, "table alias");
	const dataColumn = sanitizeIdentifier(input.dataColumn, "column name");
	const expression = sql`${sql.raw(`${safeAlias}.${dataColumn}`)} ->> ${column}`;

	return input.targetType
		? castExpressionToType(expression, input.targetType)
		: castExpressionToType(expression, normalizeExpressionPropertyType(propertyType));
};
