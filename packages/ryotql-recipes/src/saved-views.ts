import type {
	FieldSelection,
	OrderBy,
	Predicate,
	ScalarExpression,
} from "@ryot/contract/modules/ryotql/language";
import type {
	SavedViewCardMapping,
	SavedViewTableMapping,
} from "@ryot/contract/modules/saved-views/schemas";
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

type CardExpressions = {
	[Key in keyof SavedViewCardMapping as Key extends `${infer Name}Field`
		? Name
		: never]: Key extends "titleField" ? ScalarExpression : ScalarExpression | null;
};

type TableColumnExpression = Omit<SavedViewTableMapping["columns"][number], "field"> & {
	readonly expression: ScalarExpression;
};

type CardProjectionInput = {
	readonly card: CardExpressions;
	readonly itemId: ScalarExpression;
};

type TableProjectionInput = {
	readonly itemId: ScalarExpression;
	readonly image: ScalarExpression | null;
	readonly columns: readonly [TableColumnExpression, ...TableColumnExpression[]];
};

export type SavedViewLayoutProjectionsInput = {
	readonly grid: CardProjectionInput;
	readonly list: CardProjectionInput;
	readonly table: TableProjectionInput;
};

const cardProjection = (input: CardProjectionInput) => {
	const title = "title";
	const image = "image";
	const itemId = "itemId";
	const callout = "callout";
	const overline = "overline";
	const primaryMetadata = "primaryMetadata";
	const secondaryMetadata = "secondaryMetadata";
	return {
		fields: [
			field(itemId, input.itemId),
			field(title, input.card.title),
			...(input.card.image === null ? [] : [field(image, input.card.image)]),
			...(input.card.overline === null ? [] : [field(overline, input.card.overline)]),
			...(input.card.callout === null ? [] : [field(callout, input.card.callout)]),
			...(input.card.primaryMetadata === null
				? []
				: [field(primaryMetadata, input.card.primaryMetadata)]),
			...(input.card.secondaryMetadata === null
				? []
				: [field(secondaryMetadata, input.card.secondaryMetadata)]),
		] satisfies readonly FieldSelection[],
		mappings: {
			itemIdField: itemId,
			titleField: title,
			imageField: input.card.image === null ? null : image,
			calloutField: input.card.callout === null ? null : callout,
			overlineField: input.card.overline === null ? null : overline,
			primaryMetadataField: input.card.primaryMetadata === null ? null : primaryMetadata,
			secondaryMetadataField: input.card.secondaryMetadata === null ? null : secondaryMetadata,
		} satisfies SavedViewCardMapping & { readonly itemIdField: string },
	};
};

const tableProjection = (input: TableProjectionInput) => {
	const itemId = "itemId";
	const image = "image";
	const [firstTableColumn, ...remainingTableColumns] = input.columns;
	const columns = [
		{ field: "column0", label: firstTableColumn.label },
		...remainingTableColumns.map((tableColumn, index) => ({
			label: tableColumn.label,
			field: `column${index + 1}`,
		})),
	] as const;

	return {
		fields: [
			field(itemId, input.itemId),
			...(input.image === null ? [] : [field(image, input.image)]),
			...input.columns.map((tableColumn, index) => field(`column${index}`, tableColumn.expression)),
		] satisfies readonly FieldSelection[],
		mappings: {
			columns,
			itemIdField: itemId,
			imageField: input.image === null ? null : image,
		} satisfies SavedViewTableMapping & { readonly itemIdField: string },
	};
};

export const buildSavedViewLayoutProjections = (input: SavedViewLayoutProjectionsInput) => ({
	grid: cardProjection(input.grid),
	list: cardProjection(input.list),
	table: tableProjection(input.table),
});

export const buildSavedViewDocument = (input: {
	readonly page?: number | undefined;
	readonly limit?: number | undefined;
	readonly where?: Predicate | undefined;
	readonly fields: readonly FieldSelection[];
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
			fields: input.fields,
			where: input.where ? and(schemaFilter, input.where) : schemaFilter,
			orderBy: input.orderBy ?? [ascending(column(entity, "name"))],
		}),
	});
};
