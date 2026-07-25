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
	readonly table: readonly [TableColumnExpression, ...TableColumnExpression[]];
};

const cardFields = (layout: "grid" | "list", card: CardExpressions) => {
	const title = `${layout}Title`;
	const image = `${layout}Image`;
	const eyebrow = `${layout}Eyebrow`;
	const callout = `${layout}Callout`;
	const primarySubtitle = `${layout}PrimarySubtitle`;
	const secondarySubtitle = `${layout}SecondarySubtitle`;
	return {
		fields: [
			field(title, card.title),
			...(card.image === null ? [] : [field(image, card.image)]),
			...(card.eyebrow === null ? [] : [field(eyebrow, card.eyebrow)]),
			...(card.callout === null ? [] : [field(callout, card.callout)]),
			...(card.primarySubtitle === null ? [] : [field(primarySubtitle, card.primarySubtitle)]),
			...(card.secondarySubtitle === null
				? []
				: [field(secondarySubtitle, card.secondarySubtitle)]),
		] satisfies readonly FieldSelection[],
		displayConfiguration: {
			titleField: title,
			imageField: card.image === null ? null : image,
			eyebrowField: card.eyebrow === null ? null : eyebrow,
			calloutField: card.callout === null ? null : callout,
			primarySubtitleField: card.primarySubtitle === null ? null : primarySubtitle,
			secondarySubtitleField: card.secondarySubtitle === null ? null : secondarySubtitle,
		},
	};
};

export const buildSavedViewProjection = (input: SavedViewProjectionInput) => {
	const grid = cardFields("grid", input.grid);
	const list = cardFields("list", input.list);
	const [firstTableColumn, ...remainingTableColumns] = input.table;
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
			...input.table.map((tableColumn, index) =>
				field(`tableColumn${index}`, tableColumn.expression),
			),
		] satisfies readonly FieldSelection[],
		displayConfiguration: {
			entityIdField: "entityId",
			grid: grid.displayConfiguration,
			list: list.displayConfiguration,
			table: { columns: tableDisplayColumns },
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
