import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/language";
import { castJson, column, jsonPath, literal, table, titleCase } from "@ryot-app/ryotql";
import type { SavedViewLayoutProjectionsInput } from "@ryot-app/ryotql-recipes/saved-views";

type ViewExpressions = {
	readonly grid: SavedViewLayoutProjectionsInput["grid"]["card"];
	readonly list: SavedViewLayoutProjectionsInput["list"]["card"];
	readonly table: Omit<SavedViewLayoutProjectionsInput["table"], "entity">;
};

const entity = table("entity", "entity");
const entityColumn = (name: string) => column(entity, name);
const entityProperty = (property: string) => jsonPath(column(entity, "properties"), property);
const entityImage = () => castJson(jsonPath(column(entity, "properties"), "images", 0));
const text = (expression: ScalarExpression) => ({ expression, displayKind: "text" as const });
const date = (expression: ScalarExpression) => ({ expression, displayKind: "date" as const });

const cardExpressions = (slug: string, schemaName: string): ViewExpressions["grid"] => {
	const overline = text(literal(schemaName));
	if (slug === "exercise") {
		return {
			overline,
			image: entityImage(),
			title: entityColumn("name"),
			callout: text(titleCase(entityProperty("level"))),
			primaryMetadata: text(titleCase(entityProperty("kind"))),
			secondaryMetadata: text(titleCase(entityProperty("equipment"))),
		};
	}
	let primaryMetadata: ScalarExpression = entityProperty("recordedAt");
	if (slug === "workout") {
		primaryMetadata = entityProperty("startedAt");
	} else if (slug === "workout-template") {
		primaryMetadata = entityColumn("createdAt");
	}
	return {
		overline,
		image: null,
		callout: null,
		primaryMetadata: date(primaryMetadata),
		title: entityColumn("name"),
		secondaryMetadata:
			slug === "workout" ? date(entityProperty("endedAt")) : text(entityProperty("comment")),
	};
};

const tableColumns = (slug: string): ViewExpressions["table"]["columns"] => {
	const name = { label: "Name", ...text(entityColumn("name")) };
	if (slug === "exercise") {
		return [
			name,
			{ label: "Level", ...text(titleCase(entityProperty("level"))) },
			{ label: "Equipment", ...text(titleCase(entityProperty("equipment"))) },
		];
	}
	if (slug === "workout") {
		return [
			name,
			{ label: "Started At", ...date(entityProperty("startedAt")) },
			{ label: "Ended At", ...date(entityProperty("endedAt")) },
		];
	}
	if (slug === "workout-template") {
		return [
			name,
			{ label: "Created At", ...date(entityColumn("createdAt")) },
			{ label: "Comment", ...text(entityProperty("comment")) },
		];
	}
	return [
		name,
		{ label: "Comment", ...text(entityProperty("comment")) },
		{ label: "Recorded At", ...date(entityProperty("recordedAt")) },
	];
};

export const buildViewExpressions = (slug: string, schemaName: string): ViewExpressions => {
	const card = cardExpressions(slug, schemaName);
	return {
		grid: card,
		list: card,
		table: { image: slug === "exercise" ? entityImage() : null, columns: tableColumns(slug) },
	};
};
