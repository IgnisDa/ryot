import {
	createEntityColumnExpression,
	createEntityPropertyExpression,
	createEntityPropertyPathExpression,
	createEntitySchemaExpression,
	createTransformExpression,
	type QueryExpression,
} from "@ryot/contract/display-configuration";

const entityColumn = (slug: string, column: string) => createEntityColumnExpression(slug, column);
const entityProperty = (slug: string, property: string) =>
	createEntityPropertyExpression(slug, property);
const titleCase = (expression: QueryExpression) =>
	createTransformExpression("titleCase", expression);

const buildCardConfig = (slug: string) => {
	const eyebrowProperty = createEntitySchemaExpression("name");
	if (slug === "exercise") {
		return {
			eyebrowProperty,
			calloutProperty: titleCase(entityProperty(slug, "level")),
			primarySubtitleProperty: titleCase(entityProperty(slug, "kind")),
			secondarySubtitleProperty: titleCase(entityProperty(slug, "equipment")),
		};
	}
	let primarySubtitleProperty: QueryExpression = entityProperty(slug, "recordedAt");
	if (slug === "workout") {
		primarySubtitleProperty = entityProperty(slug, "startedAt");
	} else if (slug === "workout-template") {
		primarySubtitleProperty = entityColumn(slug, "createdAt");
	}
	return {
		calloutProperty: null,
		eyebrowProperty,
		primarySubtitleProperty,
		secondarySubtitleProperty:
			slug === "workout" ? entityProperty(slug, "endedAt") : entityProperty(slug, "comment"),
	};
};

const buildTableColumns = (slug: string) => {
	const name = { expression: entityColumn(slug, "name"), label: "Name" };
	if (slug === "exercise") {
		return [
			name,
			{ expression: titleCase(entityProperty(slug, "level")), label: "Level" },
			{ expression: titleCase(entityProperty(slug, "equipment")), label: "Equipment" },
		];
	}
	if (slug === "workout") {
		return [
			name,
			{ expression: entityProperty(slug, "startedAt"), label: "Started At" },
			{ expression: entityProperty(slug, "endedAt"), label: "Ended At" },
		];
	}
	if (slug === "workout-template") {
		return [
			name,
			{ expression: entityColumn(slug, "createdAt"), label: "Created At" },
			{ expression: entityProperty(slug, "comment"), label: "Comment" },
		];
	}
	return [
		name,
		{ expression: entityProperty(slug, "comment"), label: "Comment" },
		{ expression: entityProperty(slug, "recordedAt"), label: "Recorded At" },
	];
};

export const buildDisplayConfig = (slug: string) => {
	const card = {
		...buildCardConfig(slug),
		titleProperty: entityColumn(slug, "name"),
		imageProperty:
			slug === "exercise" ? createEntityPropertyPathExpression(slug, ["images", "0"]) : null,
	};
	return {
		grid: { ...card },
		list: { ...card },
		table: { columns: buildTableColumns(slug) },
		entityIdProperty: entityColumn(slug, "id"),
	};
};
