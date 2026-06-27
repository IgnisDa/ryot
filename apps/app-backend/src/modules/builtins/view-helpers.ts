import {
	createConcatExpression,
	createConditionalExpression,
	createEntityColumnExpression,
	createEntityPropertyExpression,
	createEntityPropertyPathExpression,
	createEntitySchemaExpression,
	createEventAggregateExpression,
	createIsNotNullExpression,
	createLiteralExpression,
	createTransformExpression,
	type QueryExpression,
} from "@ryot/contract/display-configuration";

const entityColumn = (slug: string, column: string) => createEntityColumnExpression(slug, column);

// Entity schemas whose properties have no `images` array; their cards render without an image.
const imagelessEntitySlugs = new Set(["collection", "workout", "workout-template", "measurement"]);

// Cards show the first image from the schema-defined `images` property.
const entityImageProperty = (slug: string): QueryExpression | null =>
	imagelessEntitySlugs.has(slug) ? null : createEntityPropertyPathExpression(slug, ["images", "0"]);

const entityProperty = (slug: string, property: string) =>
	createEntityPropertyExpression(slug, property);

const entitySchemaColumn = (column: string) => createEntitySchemaExpression(column);

const eventAggregateAvg = (eventSchemaSlug: string, propertyPath: string[]) =>
	createEventAggregateExpression(eventSchemaSlug, "avg", propertyPath);

const titleCase = (expression: QueryExpression) =>
	createTransformExpression("titleCase", expression);

const conditionalConcat = (slug: string, property: string, unit: string) =>
	createConditionalExpression({
		whenFalse: createLiteralExpression(null),
		condition: createIsNotNullExpression(entityProperty(slug, property)),
		whenTrue: createConcatExpression([
			entityProperty(slug, property),
			createLiteralExpression(unit),
		]),
	});

const avgRatingCallout = eventAggregateAvg("review", ["properties", "rating"]);

const eyebrowSchemaName = entitySchemaColumn("name");

const buildSecondarySubtitle = (slug: string) => {
	switch (slug) {
		case "book":
		case "show":
			return entityProperty(slug, "productionStatus");
		case "comic-book":
			return conditionalConcat(slug, "pages", " pages");
		case "movie":
		case "audiobook":
			return conditionalConcat(slug, "runtime", " min");
		case "manga":
			return conditionalConcat(slug, "chapters", " ch");
		case "anime":
			return conditionalConcat(slug, "episodes", " eps");
		case "podcast":
			return conditionalConcat(slug, "totalEpisodes", " eps");
		case "visual-novel":
			return conditionalConcat(slug, "lengthMinutes", " min");
		case "exercise":
			return titleCase(entityProperty(slug, "equipment"));
		default:
			return null;
	}
};

const buildCardConfig = (slug: string) => {
	switch (slug) {
		case "exercise":
			return {
				eyebrowProperty: eyebrowSchemaName,
				calloutProperty: titleCase(entityProperty(slug, "level")),
				primarySubtitleProperty: titleCase(entityProperty(slug, "kind")),
				secondarySubtitleProperty: titleCase(entityProperty(slug, "equipment")),
			};
		case "workout":
			return {
				calloutProperty: null,
				eyebrowProperty: eyebrowSchemaName,
				primarySubtitleProperty: entityProperty(slug, "startedAt"),
				secondarySubtitleProperty: entityProperty(slug, "endedAt"),
			};
		case "workout-template":
			return {
				calloutProperty: null,
				eyebrowProperty: eyebrowSchemaName,
				primarySubtitleProperty: entityColumn(slug, "createdAt"),
				secondarySubtitleProperty: entityProperty(slug, "comment"),
			};
		case "measurement":
			return {
				calloutProperty: null,
				eyebrowProperty: eyebrowSchemaName,
				secondarySubtitleProperty: entityProperty(slug, "comment"),
				primarySubtitleProperty: entityProperty(slug, "recordedAt"),
			};
		case "person":
			return {
				calloutProperty: null,
				eyebrowProperty: eyebrowSchemaName,
				primarySubtitleProperty: entityProperty(slug, "birthPlace"),
				secondarySubtitleProperty: entityProperty(slug, "birthDate"),
			};
		case "collection":
			return {
				calloutProperty: null,
				primarySubtitleProperty: null,
				secondarySubtitleProperty: null,
				eyebrowProperty: eyebrowSchemaName,
			};
		default:
			return {
				calloutProperty: avgRatingCallout,
				eyebrowProperty: eyebrowSchemaName,
				secondarySubtitleProperty: buildSecondarySubtitle(slug),
				primarySubtitleProperty: entityProperty(slug, "publishYear"),
			};
	}
};

type TableColumn = { expression: QueryExpression; label: string };

const buildTableColumns = (slug: string) => {
	const nameCol: TableColumn = { expression: entityColumn(slug, "name"), label: "Name" };
	const yearCol: TableColumn = { expression: entityProperty(slug, "publishYear"), label: "Year" };
	switch (slug) {
		case "person":
			return [nameCol, { expression: entityProperty(slug, "birthPlace"), label: "Birth Place" }];
		case "exercise":
			return [
				nameCol,
				{ expression: titleCase(entityProperty(slug, "level")), label: "Level" },
				{ expression: titleCase(entityProperty(slug, "equipment")), label: "Equipment" },
			];
		case "workout":
			return [
				nameCol,
				{ expression: entityProperty(slug, "startedAt"), label: "Started At" },
				{ expression: entityProperty(slug, "endedAt"), label: "Ended At" },
			];
		case "workout-template":
			return [
				nameCol,
				{ expression: entityColumn(slug, "createdAt"), label: "Created At" },
				{ expression: entityProperty(slug, "comment"), label: "Comment" },
			];
		case "measurement":
			return [
				nameCol,
				{ expression: entityProperty(slug, "comment"), label: "Comment" },
				{ expression: entityProperty(slug, "recordedAt"), label: "Recorded At" },
			];
		case "collection":
			return [nameCol];
		case "book":
		case "comic-book":
			return [nameCol, yearCol, { expression: entityProperty(slug, "pages"), label: "Pages" }];
		case "show":
			return [
				nameCol,
				yearCol,
				{ expression: entityProperty(slug, "productionStatus"), label: "Status" },
			];
		case "movie":
		case "audiobook":
			return [nameCol, yearCol, { expression: entityProperty(slug, "runtime"), label: "Runtime" }];
		case "anime":
			return [
				nameCol,
				yearCol,
				{ expression: entityProperty(slug, "episodes"), label: "Episodes" },
			];
		case "manga":
			return [
				nameCol,
				yearCol,
				{ expression: entityProperty(slug, "chapters"), label: "Chapters" },
			];
		case "podcast":
			return [
				nameCol,
				yearCol,
				{ expression: entityProperty(slug, "totalEpisodes"), label: "Episodes" },
			];
		case "visual-novel":
			return [
				nameCol,
				yearCol,
				{ expression: entityProperty(slug, "lengthMinutes"), label: "Length" },
			];
		default:
			return [nameCol, yearCol];
	}
};

export const buildDisplayConfig = (slug: string) => {
	const cardConfig = buildCardConfig(slug);
	const card = {
		titleProperty: entityColumn(slug, "name"),
		imageProperty: entityImageProperty(slug),
		...cardConfig,
	};
	return {
		grid: { ...card },
		list: { ...card },
		table: { columns: buildTableColumns(slug) },
		entityIdProperty: entityColumn(slug, "id"),
	};
};

export const buildDefaultDisplayConfig = (slug: string) => {
	const titleProperty = entityColumn(slug, "name");
	const card = {
		calloutProperty: null,
		eyebrowProperty: null,
		imageProperty: null,
		primarySubtitleProperty: null,
		secondarySubtitleProperty: null,
		titleProperty,
	};

	return {
		grid: { ...card },
		list: { ...card },
		table: { columns: [{ label: "Name", expression: titleProperty }] },
		entityIdProperty: entityColumn(slug, "id"),
	};
};
