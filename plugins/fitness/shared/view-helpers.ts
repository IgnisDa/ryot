import type { ScalarExpression } from "@ryot/contract/modules/ryotql/language";
import { column, jsonPath, literal, table, titleCase } from "@ryot/ryotql";
import type { SavedViewProjectionInput } from "@ryot/ryotql-recipes/saved-views";

type ViewExpressions = Omit<SavedViewProjectionInput, "entityId">;

const entity = table("entity", "entity");
const entityColumn = (name: string) => column(entity, name);
const entityProperty = (property: string) => jsonPath(column(entity, "properties"), property);

const cardExpressions = (slug: string, schemaName: string): ViewExpressions["grid"] => {
	const eyebrow = literal(schemaName);
	if (slug === "exercise") {
		return {
			eyebrow,
			title: entityColumn("name"),
			callout: titleCase(entityProperty("level")),
			primarySubtitle: titleCase(entityProperty("kind")),
			secondarySubtitle: titleCase(entityProperty("equipment")),
			image: jsonPath(column(entity, "properties"), "images", 0),
		};
	}
	let primarySubtitle: ScalarExpression = entityProperty("recordedAt");
	if (slug === "workout") {
		primarySubtitle = entityProperty("startedAt");
	} else if (slug === "workout-template") {
		primarySubtitle = entityColumn("createdAt");
	}
	return {
		eyebrow,
		image: null,
		callout: null,
		primarySubtitle,
		title: entityColumn("name"),
		secondarySubtitle: slug === "workout" ? entityProperty("endedAt") : entityProperty("comment"),
	};
};

const tableColumns = (slug: string): ViewExpressions["table"] => {
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
	return { grid: card, list: card, table: tableColumns(slug) };
};
