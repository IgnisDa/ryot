import type { ScalarExpression } from "@ryot/contract/modules/ryotql/language";
import { castJson, column, jsonPath, literal, table, titleCase } from "@ryot/ryotql";
import type { SavedViewLayoutProjectionsInput } from "@ryot/ryotql-recipes/saved-views";

type ViewExpressions = {
	readonly grid: SavedViewLayoutProjectionsInput["grid"]["card"];
	readonly list: SavedViewLayoutProjectionsInput["list"]["card"];
	readonly table: Omit<SavedViewLayoutProjectionsInput["table"], "itemId">;
};

const entity = table("entity", "entity");
const entityColumn = (name: string) => column(entity, name);
const entityProperty = (property: string) => jsonPath(column(entity, "properties"), property);
const entityImage = () => castJson(jsonPath(column(entity, "properties"), "images", 0));

const cardExpressions = (slug: string, schemaName: string): ViewExpressions["grid"] => {
	const overline = literal(schemaName);
	if (slug === "exercise") {
		return {
			overline,
			image: entityImage(),
			title: entityColumn("name"),
			callout: titleCase(entityProperty("level")),
			primaryMetadata: titleCase(entityProperty("kind")),
			secondaryMetadata: titleCase(entityProperty("equipment")),
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
		primaryMetadata,
		title: entityColumn("name"),
		secondaryMetadata: slug === "workout" ? entityProperty("endedAt") : entityProperty("comment"),
	};
};

const tableColumns = (slug: string): ViewExpressions["table"]["columns"] => {
	const name = { label: "Name", expression: entityColumn("name") };
	if (slug === "exercise") {
		return [
			name,
			{ label: "Level", expression: titleCase(entityProperty("level")) },
			{ label: "Equipment", expression: titleCase(entityProperty("equipment")) },
		];
	}
	if (slug === "workout") {
		return [
			name,
			{ label: "Started At", expression: entityProperty("startedAt") },
			{ label: "Ended At", expression: entityProperty("endedAt") },
		];
	}
	if (slug === "workout-template") {
		return [
			name,
			{ label: "Created At", expression: entityColumn("createdAt") },
			{ label: "Comment", expression: entityProperty("comment") },
		];
	}
	return [
		name,
		{ label: "Comment", expression: entityProperty("comment") },
		{ label: "Recorded At", expression: entityProperty("recordedAt") },
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
