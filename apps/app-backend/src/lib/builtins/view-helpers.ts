import {
	createConcatExpression,
	createConditionalExpression,
	createEntityColumnExpression,
	createEntityPropertyExpression,
	createEntitySchemaExpression,
	createEventAggregateExpression,
	createIsNotNullExpression,
	createLiteralExpression,
	createTransformExpression,
	type DisplayConfiguration,
	type QueryExpression,
	type SavedViewQueryDefinition,
} from "~/lib/query-language";

const entityColumn = (slug: string, column: string): QueryExpression =>
	createEntityColumnExpression(slug, column);

const entityProperty = (slug: string, property: string): QueryExpression =>
	createEntityPropertyExpression(slug, property);

const entitySchemaColumn = (column: string): QueryExpression =>
	createEntitySchemaExpression(column);

const eventAggregateAvg = (eventSchemaSlug: string, propertyPath: string[]): QueryExpression =>
	createEventAggregateExpression(eventSchemaSlug, "avg", propertyPath);

const titleCase = (expression: QueryExpression): QueryExpression =>
	createTransformExpression("titleCase", expression);

const conditionalConcat = (slug: string, property: string, unit: string): QueryExpression =>
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

type CardConfig = {
	calloutProperty: QueryExpression | null;
	eyebrowProperty: QueryExpression | null;
	primarySubtitleProperty: QueryExpression | null;
	secondarySubtitleProperty: QueryExpression | null;
};

const buildSecondarySubtitle = (slug: string): QueryExpression | null => {
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

const buildCardConfig = (slug: string): CardConfig => {
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

const buildTableColumns = (slug: string): TableColumn[] => {
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

export const buildDisplayConfig = (slug: string): DisplayConfiguration => {
	const cardConfig = buildCardConfig(slug);
	const card = {
		titleProperty: entityColumn(slug, "name"),
		imageProperty: entityColumn(slug, "image"),
		...cardConfig,
	};
	return {
		grid: { ...card },
		list: { ...card },
		table: { columns: buildTableColumns(slug) },
		entityIdProperty: entityColumn(slug, "id"),
	};
};

export const buildDefaultQueryDefinition = (
	scope: string[],
	options?: { relationshipJoins?: unknown[] },
): SavedViewQueryDefinition => ({
	scope,
	filter: null,
	eventJoins: [],
	mode: "entities",
	computedFields: [],
	relationshipJoins: options?.relationshipJoins ?? [],
	sort: {
		direction: "asc",
		expression: scope[0] ? entityColumn(scope[0], "name") : createLiteralExpression(""),
	},
});

export const inLibraryRelationshipJoin = {
	required: true,
	key: "inLibrary",
	direction: "outgoing",
	kind: "latestRelationship",
	relationshipSchemaSlug: "in-library",
};

export const toSlug = (name: string): string =>
	name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
