import {
	and,
	average,
	castText,
	column,
	concat,
	conditional,
	eq,
	castNumber,
	jsonPath,
	isNotNull,
	literal,
	table,
} from "@ryot/ryotql";
import type { SavedViewProjectionInput } from "@ryot/ryotql-recipes/saved-views";

type ViewExpressions = Omit<SavedViewProjectionInput, "entityId">;

const entity = table("entity", "entity");
const entityColumn = (name: string) => column(entity, name);
const entityProperty = (property: string) => jsonPath(column(entity, "properties"), property);
const entityImage = () => castText(jsonPath(column(entity, "properties"), "images", 0, "url"));

const reviewRatingAverage = () => {
	const review = table("event", "review");
	return average(review, castNumber(jsonPath(column(review, "properties"), "rating")), {
		where: and(
			eq(column(review, "entityId"), column(entity, "id")),
			eq(column(review, "eventSchemaSlug"), literal("review")),
		),
	});
};

const conditionalUnit = (property: string, unit: string) => {
	const value = entityProperty(property);
	return conditional(isNotNull(value), concat(value, literal(unit)), literal(null));
};

const secondaryMetadata = (slug: string) => {
	switch (slug) {
		case "book":
		case "show":
			return entityProperty("productionStatus");
		case "comic-book":
			return conditionalUnit("pages", " pages");
		case "movie":
		case "audiobook":
			return conditionalUnit("runtime", " min");
		case "manga":
			return conditionalUnit("chapters", " ch");
		case "anime":
			return conditionalUnit("episodes", " eps");
		case "podcast":
			return conditionalUnit("totalEpisodes", " eps");
		case "visual-novel":
			return conditionalUnit("lengthMinutes", " min");
		default:
			return null;
	}
};

const cardExpressions = (slug: string, schemaName: string): ViewExpressions["grid"] => {
	const overline = literal(schemaName);
	if (slug === "person") {
		return {
			overline,
			callout: null,
			image: entityImage(),
			title: entityColumn("name"),
			primaryMetadata: entityProperty("birthPlace"),
			secondaryMetadata: entityProperty("birthDate"),
		};
	}
	if (slug === "company") {
		return {
			overline,
			image: entityImage(),
			secondaryMetadata: null,
			callout: reviewRatingAverage(),
			title: entityColumn("name"),
			primaryMetadata: entityProperty("foundedYear"),
		};
	}
	if (slug.endsWith("-group")) {
		return {
			overline,
			image: entityImage(),
			secondaryMetadata: null,
			callout: reviewRatingAverage(),
			title: entityColumn("name"),
			primaryMetadata: entityProperty("parts"),
		};
	}
	return {
		overline,
		image: entityImage(),
		callout: reviewRatingAverage(),
		title: entityColumn("name"),
		secondaryMetadata: secondaryMetadata(slug),
		primaryMetadata: entityProperty("publishYear"),
	};
};

const tableColumns = (slug: string): ViewExpressions["table"]["columns"] => {
	const name = { label: "Name", expression: entityColumn("name") };
	const year = { label: "Year", expression: entityProperty("publishYear") };
	if (slug === "person") {
		return [name, { label: "Birth Place", expression: entityProperty("birthPlace") }];
	}
	if (slug === "company") {
		return [name, { label: "Founded Year", expression: entityProperty("foundedYear") }];
	}
	if (slug.endsWith("-group")) {
		return [name, { label: "Parts", expression: entityProperty("parts") }];
	}
	if (slug === "book" || slug === "comic-book") {
		return [name, year, { label: "Pages", expression: entityProperty("pages") }];
	}
	if (slug === "show") {
		return [name, year, { label: "Status", expression: entityProperty("productionStatus") }];
	}
	if (slug === "movie" || slug === "audiobook") {
		return [name, year, { label: "Runtime", expression: entityProperty("runtime") }];
	}
	if (slug === "anime") {
		return [name, year, { label: "Episodes", expression: entityProperty("episodes") }];
	}
	if (slug === "manga") {
		return [name, year, { label: "Chapters", expression: entityProperty("chapters") }];
	}
	if (slug === "podcast") {
		return [name, year, { label: "Episodes", expression: entityProperty("totalEpisodes") }];
	}
	if (slug === "visual-novel") {
		return [name, year, { label: "Length", expression: entityProperty("lengthMinutes") }];
	}
	return [name, year];
};

export const buildViewExpressions = (slug: string, schemaName: string): ViewExpressions => {
	const card = cardExpressions(slug, schemaName);
	return { grid: card, list: card, table: { image: entityImage(), columns: tableColumns(slug) } };
};
