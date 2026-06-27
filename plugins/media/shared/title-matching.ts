import {
	extractMetadataLookupBaseTitle,
	extractMetadataLookupYearFromTitle,
	hasMetadataLookupShowIndicators,
} from "./title-parsing";

export type MetadataLookupTitleMatchCandidate = {
	title: string;
	externalId: string;
	publishYear: number | null;
	entitySchemaSlug: "movie" | "show";
	providerSlug: "movie.tmdb" | "show.tmdb";
};

const EXACT_MATCH_BONUS = 1;
const SUBSTRING_PENALTY = 0.5;
const EXTRA_TOKEN_PENALTY = 0.1;
const MIN_TITLE_MATCH_SCORE = 0.5;
const EXACT_YEAR_MATCH_BONUS = 0.2;
const CLOSE_YEAR_MATCH_BONUS = 0.1;
const SHOW_WITH_EPISODE_BONUS = 0.5;
const RESULT_POSITION_BONUS_BASE = 0.05;
const NORMALIZED_EXACT_MATCH_BONUS = 0.6;
const normalizeForExact = (value: string): string =>
	value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const tokenize = (value: string): Set<string> =>
	new Set(
		value
			.toLowerCase()
			.split(/[^a-zA-Z0-9]+/)
			.filter(Boolean),
	);

const calculateSimilarity = (left: string, right: string): number => {
	const leftLower = left.toLowerCase();
	const rightLower = right.toLowerCase();
	if (leftLower === rightLower) {
		return 1;
	}
	if (leftLower.includes(rightLower) || rightLower.includes(leftLower)) {
		return (
			(Math.min(leftLower.length, rightLower.length) /
				Math.max(leftLower.length, rightLower.length)) *
			SUBSTRING_PENALTY
		);
	}

	const leftWords = leftLower.split(/\s+/).filter(Boolean);
	const rightWords = new Set(rightLower.split(/\s+/).filter(Boolean));
	const commonWords = leftWords.filter((word) => rightWords.has(word)).length;
	const totalWords = Math.max(leftWords.length, rightWords.size);
	return totalWords > 0 ? commonWords / totalWords : 0;
};

const calculateMatchScore = (input: {
	originalTitle: string;
	resultPosition: number;
	hasShowIndicators: boolean;
	publishYear?: number | undefined;
	result: MetadataLookupTitleMatchCandidate;
}): number => {
	let score = calculateSimilarity(input.originalTitle, input.result.title);
	if (input.originalTitle.toLowerCase() === input.result.title.toLowerCase()) {
		score += EXACT_MATCH_BONUS;
	}
	if (normalizeForExact(input.originalTitle) === normalizeForExact(input.result.title)) {
		score += NORMALIZED_EXACT_MATCH_BONUS;
	}
	if (input.resultPosition < 5) {
		score += RESULT_POSITION_BONUS_BASE * (5 - input.resultPosition);
	}
	if (input.publishYear !== undefined && input.result.publishYear !== null) {
		const yearDifference = Math.abs(input.publishYear - input.result.publishYear);
		if (yearDifference === 0) {
			score += EXACT_YEAR_MATCH_BONUS;
		} else if (yearDifference <= 1) {
			score += CLOSE_YEAR_MATCH_BONUS;
		}
	}
	if (input.hasShowIndicators && input.result.entitySchemaSlug === "show") {
		score += SHOW_WITH_EPISODE_BONUS;
	}

	const originalTokens = tokenize(input.originalTitle);
	const resultTokens = tokenize(input.result.title);
	if (originalTokens.size > 0 && resultTokens.size > 0) {
		let extraTokens = 0;
		for (const token of resultTokens) {
			if (!originalTokens.has(token)) {
				extraTokens += 1;
			}
		}
		if (extraTokens > 0) {
			score = Math.max(0, score - extraTokens * EXTRA_TOKEN_PENALTY);
		}
	}

	return score;
};

export const chooseBestMetadataLookupTitleMatch = (input: {
	title: string;
	results: MetadataLookupTitleMatchCandidate[];
	preferredEntitySchemaSlug?: "movie" | "show" | undefined;
}): MetadataLookupTitleMatchCandidate | undefined => {
	const filteredResults = input.preferredEntitySchemaSlug
		? input.results.filter((result) => result.entitySchemaSlug === input.preferredEntitySchemaSlug)
		: input.results;
	if (filteredResults.length === 0) {
		return undefined;
	}

	const cleanedOriginal = extractMetadataLookupBaseTitle(input.title);
	const publishYear = extractMetadataLookupYearFromTitle(input.title);
	const hasShowIndicators = hasMetadataLookupShowIndicators(input.title);
	let bestMatch: { result: MetadataLookupTitleMatchCandidate; score: number } | undefined;
	filteredResults.forEach((result, index) => {
		const score = calculateMatchScore({
			result,
			publishYear,
			hasShowIndicators,
			resultPosition: index,
			originalTitle: cleanedOriginal,
		});
		if (!bestMatch || score > bestMatch.score) {
			bestMatch = { result, score };
		}
	});

	return bestMatch && bestMatch.score >= MIN_TITLE_MATCH_SCORE ? bestMatch.result : undefined;
};
