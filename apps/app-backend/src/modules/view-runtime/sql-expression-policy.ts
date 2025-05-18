import { sql } from "drizzle-orm";
import { match } from "ts-pattern";
import type { PropertyType } from "~/lib/views/reference";

export type SqlExpression = ReturnType<typeof sql>;

export const buildCastedValueExpression = (
	propertyType: PropertyType,
	input: { propertyText: SqlExpression; propertyJson: SqlExpression },
) =>
	match(propertyType)
		.with("integer", () => sql`(${input.propertyText})::integer`)
		.with("number", () => sql`(${input.propertyText})::numeric`)
		.with("boolean", () => sql`(${input.propertyText})::boolean`)
		.with("date", () => sql`(${input.propertyText})::timestamp`)
		.with("array", "object", () => input.propertyJson)
		.otherwise(() => input.propertyText);

export const buildCoalescedExpression = (expressions: SqlExpression[]) => {
	if (expressions.length === 1) {
		return expressions[0] ?? sql`null`;
	}

	return sql`coalesce(${sql.join(expressions, sql`, `)})`;
};
