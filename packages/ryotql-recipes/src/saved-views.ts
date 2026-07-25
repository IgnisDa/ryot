import type { OrderBy, Predicate } from "@ryot/contract/modules/ryotql/language";
import {
	and,
	ascending,
	column,
	document,
	eq,
	field,
	inArray,
	literal,
	rows,
	table,
} from "@ryot/ryotql";

export const buildSavedViewDocument = (input: {
	readonly page?: number | undefined;
	readonly limit?: number | undefined;
	readonly where?: Predicate | undefined;
	readonly orderBy?: readonly OrderBy[] | undefined;
	readonly entitySchemaSlugs: readonly [string, ...string[]];
}) => {
	const entity = table("entity", "entity");
	const schema = column(entity, "entitySchemaSlug");
	const schemaFilter =
		input.entitySchemaSlugs.length === 1
			? eq(schema, literal(input.entitySchemaSlugs[0]))
			: inArray(
					schema,
					input.entitySchemaSlugs.map((slug) => literal(slug)),
				);

	return document({
		savedView: rows(entity, {
			page: input.page,
			limit: input.limit,
			where: input.where ? and(schemaFilter, input.where) : schemaFilter,
			orderBy: input.orderBy ?? [ascending(column(entity, "name"))],
			fields: [
				field("id", column(entity, "id")),
				field("name", column(entity, "name")),
				field("schemaSlug", schema),
			],
		}),
	});
};
