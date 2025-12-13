// TODO: Pure view-language expression helpers.
// These are local equivalents of @ryot/ts-utils/view-language, kept here to avoid
// a backend dependency on the legacy utility package.

type ViewExpr = Record<string, unknown>;

const ref = (reference: Record<string, unknown>): ViewExpr => ({ type: "reference", reference });

export const entityColumn = (slug: string, column: string): ViewExpr =>
	ref({ path: [column], slug, type: "entity" });

export const entityProperty = (slug: string, property: string): ViewExpr =>
	ref({ path: ["properties", property], slug, type: "entity" });

export const entitySchemaColumn = (column: string): ViewExpr =>
	ref({ path: [column], type: "entity-schema" });

export const eventAggregateAvg = (eventSchemaSlug: string, propertyPath: string[]): ViewExpr =>
	ref({ aggregation: "avg", eventSchemaSlug, path: propertyPath, type: "event-aggregate" });

export const titleCase = (expression: ViewExpr): ViewExpr => ({
	expression,
	name: "titleCase",
	type: "transform",
});

export const conditionalConcat = (slug: string, property: string, unit: string): ViewExpr => ({
	type: "conditional",
	whenFalse: { type: "literal", value: null },
	condition: { expression: entityProperty(slug, property), type: "isNotNull" },
	whenTrue: {
		type: "concat",
		values: [entityProperty(slug, property), { type: "literal", value: unit }],
	},
});

const avgRatingCallout = ref({
	aggregation: "avg",
	type: "event-aggregate",
	eventSchemaSlug: "review",
	path: ["properties", "rating"],
});

const eyebrowSchemaName = entitySchemaColumn("name");

type CardConfig = {
	calloutProperty: ViewExpr | null;
	eyebrowProperty: ViewExpr | null;
	primarySubtitleProperty: ViewExpr | null;
	secondarySubtitleProperty: ViewExpr | null;
};

const buildSecondarySubtitle = (slug: string): ViewExpr | null => {
	switch (slug) {
		case "book":
		case "comic-book":
			return conditionalConcat(slug, "pages", " pages");
		case "movie":
		case "audiobook":
			return conditionalConcat(slug, "runtime", " min");
		case "anime":
			return conditionalConcat(slug, "episodes", " eps");
		case "manga":
			return conditionalConcat(slug, "chapters", " ch");
		case "podcast":
			return conditionalConcat(slug, "totalEpisodes", " eps");
		case "visual-novel":
			return conditionalConcat(slug, "lengthMinutes", " min");
		case "show":
			return entityProperty(slug, "productionStatus");
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
				calloutProperty: titleCase(entityProperty(slug, "level")),
				eyebrowProperty: eyebrowSchemaName,
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
				primarySubtitleProperty: entityProperty(slug, "recordedAt"),
				secondarySubtitleProperty: entityProperty(slug, "comment"),
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
				eyebrowProperty: eyebrowSchemaName,
				primarySubtitleProperty: null,
				secondarySubtitleProperty: null,
			};
		default:
			return {
				calloutProperty: avgRatingCallout,
				eyebrowProperty: eyebrowSchemaName,
				primarySubtitleProperty: entityProperty(slug, "publishYear"),
				secondarySubtitleProperty: buildSecondarySubtitle(slug),
			};
	}
};

type TableColumn = { expression: ViewExpr; label: string };

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

export type DisplayConfig = {
	entityIdProperty: ViewExpr;
	grid: ViewExpr & Record<string, unknown>;
	list: ViewExpr & Record<string, unknown>;
	table: { columns: TableColumn[] };
};

export const buildDisplayConfig = (slug: string): DisplayConfig => {
	const cardConfig = buildCardConfig(slug);
	const card = {
		imageProperty: entityColumn(slug, "image"),
		titleProperty: entityColumn(slug, "name"),
		...cardConfig,
	};
	return {
		entityIdProperty: entityColumn(slug, "id"),
		grid: card,
		list: card,
		table: { columns: buildTableColumns(slug) },
	};
};

export type QueryDefinition = {
	computedFields: unknown[];
	eventJoins: unknown[];
	filter: null;
	mode: "entities";
	relationshipJoins: unknown[];
	scope: string[];
	sort: { direction: string; expression: ViewExpr };
};

export const buildDefaultQueryDefinition = (
	scope: string[],
	options?: { relationshipJoins?: unknown[] },
): QueryDefinition => ({
	computedFields: [],
	eventJoins: [],
	filter: null,
	mode: "entities",
	relationshipJoins: options?.relationshipJoins ?? [],
	scope,
	sort: {
		direction: "asc",
		expression: scope[0] ? entityColumn(scope[0], "name") : { type: "literal", value: "" },
	},
});

export const inLibraryRelationshipJoin = {
	direction: "outgoing",
	key: "inLibrary",
	kind: "latestRelationship",
	relationshipSchemaSlug: "in-library",
	required: true,
};

export const toSlug = (name: string): string =>
	name
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
