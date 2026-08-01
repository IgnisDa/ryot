import type {
	FieldSelection,
	OrderBy,
	Predicate,
	ScalarExpression,
} from "@ryot/contract/modules/ryotql/language";
import type { SavedViewDisplayConfiguration } from "@ryot/contract/modules/saved-views/schemas";
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
	[Key in keyof SavedViewDisplayConfiguration["grid"] as Key extends `${infer Name}Field`
		? Name
		: never]: Key extends "titleField" ? ScalarExpression : ScalarExpression | null;
};

type TableColumnExpression = Omit<
	SavedViewDisplayConfiguration["table"]["columns"][number],
	"field"
> & {
	readonly expression: ScalarExpression;
};

export type SavedViewProjectionInput = {
	readonly grid: CardExpressions;
	readonly list: CardExpressions;
	readonly entityId: ScalarExpression;
	readonly table: {
		readonly image: ScalarExpression | null;
		readonly columns: readonly [TableColumnExpression, ...TableColumnExpression[]];
	};
};

const cardFields = (layout: "grid" | "list", card: CardExpressions) => {
	const title = `${layout}Title`;
	const image = `${layout}Image`;
	const callout = `${layout}Callout`;
	const overline = `${layout}Overline`;
	const primaryMetadata = `${layout}PrimaryMetadata`;
	const secondaryMetadata = `${layout}SecondaryMetadata`;
	return {
		fields: [
			field(title, card.title),
			...(card.image === null ? [] : [field(image, card.image)]),
			...(card.overline === null ? [] : [field(overline, card.overline)]),
			...(card.callout === null ? [] : [field(callout, card.callout)]),
			...(card.primaryMetadata === null ? [] : [field(primaryMetadata, card.primaryMetadata)]),
			...(card.secondaryMetadata === null
				? []
				: [field(secondaryMetadata, card.secondaryMetadata)]),
		] satisfies readonly FieldSelection[],
		displayConfiguration: {
			titleField: title,
			imageField: card.image === null ? null : image,
			calloutField: card.callout === null ? null : callout,
			overlineField: card.overline === null ? null : overline,
			primaryMetadataField: card.primaryMetadata === null ? null : primaryMetadata,
			secondaryMetadataField: card.secondaryMetadata === null ? null : secondaryMetadata,
		},
	};
};

export const buildSavedViewProjection = (input: SavedViewProjectionInput) => {
	const tableImage = "tableImage";
	const grid = cardFields("grid", input.grid);
	const list = cardFields("list", input.list);
	const [firstTableColumn, ...remainingTableColumns] = input.table.columns;
	const tableDisplayColumns = [
		{ field: "tableColumn0", label: firstTableColumn.label },
		...remainingTableColumns.map((tableColumn, index) => ({
			field: `tableColumn${index + 1}`,
			label: tableColumn.label,
		})),
	] as const;

	return {
		fields: [
			field("entityId", input.entityId),
			...grid.fields,
			...list.fields,
			...(input.table.image === null ? [] : [field(tableImage, input.table.image)]),
			...input.table.columns.map((tableColumn, index) =>
				field(`tableColumn${index}`, tableColumn.expression),
			),
		] satisfies readonly FieldSelection[],
		displayConfiguration: {
			entityIdField: "entityId",
			grid: grid.displayConfiguration,
			list: list.displayConfiguration,
			table: {
				columns: tableDisplayColumns,
				imageField: input.table.image === null ? null : tableImage,
			},
		} satisfies SavedViewDisplayConfiguration,
	};
};

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
