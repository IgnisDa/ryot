import type { ScalarExpression } from "@ryot-app/contract/modules/ryotql/language";
import {
	and,
	average,
	castJson,
	column,
	concat,
	conditional,
	eq,
	castNumber,
	jsonPath,
	isNotNull,
	literal,
	table,
} from "@ryot-app/ryotql";
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
const number = (expression: ScalarExpression) => ({ expression, displayKind: "number" as const });

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
	const overline = text(literal(schemaName));
	if (slug === "person") {
		return {
			overline,
			callout: null,
			image: entityImage(),
			title: entityColumn("name"),
			primaryMetadata: text(entityProperty("birthPlace")),
			secondaryMetadata: date(entityProperty("birthDate")),
		};
	}
	if (slug === "company") {
		return {
			overline,
			image: entityImage(),
			secondaryMetadata: null,
			callout: number(reviewRatingAverage()),
			title: entityColumn("name"),
			primaryMetadata: number(entityProperty("foundedYear")),
		};
	}
	if (slug.endsWith("-group")) {
		return {
			overline,
			image: entityImage(),
			secondaryMetadata: null,
			callout: number(reviewRatingAverage()),
			title: entityColumn("name"),
			primaryMetadata: number(entityProperty("parts")),
		};
	}
	const secondary = secondaryMetadata(slug);
	return {
		overline,
		image: entityImage(),
		callout: number(reviewRatingAverage()),
		title: entityColumn("name"),
		secondaryMetadata: secondary === null ? null : text(secondary),
		primaryMetadata: number(entityProperty("publishYear")),
	};
};

const tableColumns = (slug: string): ViewExpressions["table"]["columns"] => {
	const name = { label: "Name", ...text(entityColumn("name")) };
	const year = { label: "Year", ...number(entityProperty("publishYear")) };
	if (slug === "person") {
		return [name, { label: "Birth Place", ...text(entityProperty("birthPlace")) }];
	}
	if (slug === "company") {
		return [name, { label: "Founded Year", ...number(entityProperty("foundedYear")) }];
	}
	if (slug.endsWith("-group")) {
		return [name, { label: "Parts", ...number(entityProperty("parts")) }];
	}
	if (slug === "book" || slug === "comic-book") {
		return [name, year, { label: "Pages", ...number(entityProperty("pages")) }];
	}
	if (slug === "show") {
		return [name, year, { label: "Status", ...text(entityProperty("productionStatus")) }];
	}
	if (slug === "movie" || slug === "audiobook") {
		return [name, year, { label: "Runtime", ...number(entityProperty("runtime")) }];
	}
	if (slug === "anime") {
		return [name, year, { label: "Episodes", ...number(entityProperty("episodes")) }];
	}
	if (slug === "manga") {
		return [name, year, { label: "Chapters", ...number(entityProperty("chapters")) }];
	}
	if (slug === "podcast") {
		return [name, year, { label: "Episodes", ...number(entityProperty("totalEpisodes")) }];
	}
	if (slug === "visual-novel") {
		return [name, year, { label: "Length", ...number(entityProperty("lengthMinutes")) }];
	}
	return [name, year];
};

export const buildViewExpressions = (slug: string, schemaName: string): ViewExpressions => {
	const card = cardExpressions(slug, schemaName);
	return { grid: card, list: card, table: { image: entityImage(), columns: tableColumns(slug) } };
};
