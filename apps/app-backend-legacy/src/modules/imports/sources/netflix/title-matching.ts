type NetflixEpisodeInfo = {
	episode: number;
	season: number;
};

export type NetflixTitleMatchCandidate = {
	title: string;
	externalId: string;
	publishYear: number | null;
	scriptSlug: "movie.tmdb" | "show.tmdb";
	entitySchemaSlug: "movie" | "show";
};

const CLEANING_PATTERNS = [
	/\([12]\d{3}\)/g,
	/\[[12]\d{3}\]/g,
	/S\d+E\d+/gi,
	/Season\s+\d+/gi,
	/Episode\s+\d+/gi,
	/\b(720p|1080p|4K|HDTV|HD|SD|CAM|TS|TC|DVDRip|BRRip|BluRay|WEBRip|WEB-DL)\b/gi,
	/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/gi,
	/(PROPER|REPACK|EXTENDED|UNRATED|DIRECTOR.?S.?CUT)/gi,
	/\[.*?\]/g,
	/\{.*?\}/g,
];
const YEAR_PATTERNS = [/\(([12]\d{3})\)/, /\[([12]\d{3})\]/];
const EXACT_MATCH_BONUS = 1;
const SUBSTRING_PENALTY = 0.5;
const EXTRA_TOKEN_PENALTY = 0.1;
const MIN_TITLE_MATCH_SCORE = 0.5;
const EXACT_YEAR_MATCH_BONUS = 0.2;
const CLOSE_YEAR_MATCH_BONUS = 0.1;
const SHOW_WITH_EPISODE_BONUS = 0.5;
const RESULT_POSITION_BONUS_BASE = 0.05;
const NORMALIZED_EXACT_MATCH_BONUS = 0.6;

const SHOW_INDICATOR_PATTERNS = [
	/\bS\d{1,3}\s*E\d{1,3}\b/i,
	/\bSeason\s+[A-Za-z0-9]+\b/i,
	/\bSeries\s+[A-Za-z0-9]+\b/i,
	/\bEpisode\s+[A-Za-z0-9]+\b/i,
	/\bChapter\s+[A-Za-z0-9]+\b/i,
	/\bLimited\s+Series\b/i,
];

type EpisodeSource = "chapter" | "episode" | "parentheses";
type GeneralSource = "season_episode" | "sxxexx";

const wordToNumberMap: Record<string, number> = {
	zero: 0,
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
	eleven: 11,
	twelve: 12,
	thirteen: 13,
	fourteen: 14,
	fifteen: 15,
	sixteen: 16,
	seventeen: 17,
	eighteen: 18,
	nineteen: 19,
	twenty: 20,
	thirty: 30,
	forty: 40,
	fifty: 50,
	sixty: 60,
	seventy: 70,
	eighty: 80,
	ninety: 90,
};

const collapseSpaces = (value: string): string =>
	value.split(/\s+/).filter(Boolean).join(" ").trim();

const splitSegments = (title: string): string[] =>
	title
		.split(":")
		.map((segment) => collapseSpaces(segment.trim().replace(/^["']|["']$/g, "")))
		.filter(Boolean);

const wordToNumber = (word: string): number | undefined => {
	const normalized = word.trim().toLowerCase().replace(/-/g, " ");
	const tokens = normalized.split(/\s+/).filter((token) => token && token !== "and");
	if (tokens.length === 0) {
		return undefined;
	}
	if (tokens.length === 1) {
		return wordToNumberMap[tokens[0] ?? ""];
	}

	let total = 0;
	for (const token of tokens) {
		const value = wordToNumberMap[token];
		if (value === undefined) {
			return undefined;
		}
		total += value;
	}

	return total;
};

const romanToNumber = (value: string): number | undefined => {
	const digits: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
	let result = 0;
	let previous = 0;
	for (const char of value.toUpperCase().split("").toReversed()) {
		const digit = digits[char];
		if (!digit) {
			return undefined;
		}
		result += digit < previous ? -digit : digit;
		previous = digit;
	}
	return result;
};

const alphaToNumber = (token: string): number | undefined => {
	if (token.length !== 1) {
		return undefined;
	}
	const value = token.toUpperCase().charCodeAt(0);
	return value >= 65 && value <= 90 ? value - 64 : undefined;
};

const interpretNumeric = (token: string): number | undefined => {
	const parsed = Number.parseInt(token, 10);
	return Number.isFinite(parsed)
		? parsed
		: (wordToNumber(token) ?? romanToNumber(token) ?? alphaToNumber(token));
};

const parseNumberToken = (token: string): number | undefined => {
	const trimmed = token.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").trim();
	if (!trimmed) {
		return undefined;
	}

	const interpreted = interpretNumeric(trimmed);
	if (interpreted !== undefined) {
		return interpreted;
	}

	const prefix = trimmed.match(/^[a-zA-Z0-9]+/)?.[0] ?? "";
	return prefix && prefix.toLowerCase() !== trimmed.toLowerCase()
		? interpretNumeric(prefix)
		: undefined;
};

const findAfterKeyword = (segment: string, keyword: string): string | undefined => {
	const position = segment.toLowerCase().indexOf(keyword.toLowerCase());
	if (position === -1) {
		return undefined;
	}
	return segment
		.slice(position + keyword.length)
		.replace(/^[:\-\s]+/, "")
		.trim();
};

const parseLabelledEpisode = (segment: string): number | undefined => {
	const chapter = findAfterKeyword(segment, "chapter");
	const token = chapter?.split(/\s+/)[0];
	return token ? parseNumberToken(token) : undefined;
};

const extractEpisode = (
	segment: string,
): { episode: number; source: EpisodeSource } | undefined => {
	const parenthesesMatch = segment.match(/\(Episode\s+([A-Za-z0-9]+)\)/i)?.[1];
	const parenthesesEpisode = parenthesesMatch ? parseNumberToken(parenthesesMatch) : undefined;
	if (parenthesesEpisode !== undefined) {
		return { episode: parenthesesEpisode, source: "parentheses" };
	}

	const plainEpisodeMatch = segment.match(/\bEpisode\s+([A-Za-z0-9]+)\b/i)?.[1];
	const plainEpisode = plainEpisodeMatch ? parseNumberToken(plainEpisodeMatch) : undefined;
	if (plainEpisode !== undefined) {
		return { episode: plainEpisode, source: "episode" };
	}

	const chapterEpisode = parseLabelledEpisode(segment);
	return chapterEpisode !== undefined ? { episode: chapterEpisode, source: "chapter" } : undefined;
};

const parseLabelledSeason = (segment: string): number | undefined => {
	if (segment.toLowerCase().includes("limited series")) {
		return 1;
	}

	for (const label of ["season", "series", "volume", "book", "part"]) {
		const after = findAfterKeyword(segment, label);
		const token = after?.split(/\s+/)[0];
		const value = token ? parseNumberToken(token) : undefined;
		if (value !== undefined) {
			return value;
		}
	}

	return undefined;
};

const parseRepeatedBaseSeason = (segment: string, firstSegment: string): number | undefined => {
	if (!firstSegment.trim()) {
		return undefined;
	}

	const trimmedSegment = segment.trim();
	const trimmedFirstSegment = firstSegment.trim();
	const lowerSegment = trimmedSegment.toLowerCase();
	const lowerFirstSegment = trimmedFirstSegment.toLowerCase();
	const dotPosition = trimmedSegment.indexOf(". ");
	if (dotPosition !== -1) {
		const beforeDot = trimmedSegment.slice(0, dotPosition);
		const afterDot = trimmedSegment.slice(dotPosition + 2).trim();
		const seasonNumber = parseNumberToken(beforeDot);
		if (seasonNumber !== undefined && afterDot.toLowerCase() === lowerFirstSegment) {
			return seasonNumber;
		}
	}

	if (lowerSegment.startsWith(lowerFirstSegment)) {
		const remainder = trimmedSegment.slice(trimmedFirstSegment.length).trim();
		if (remainder.split(/\s+/).length === 1) {
			const value = parseNumberToken(remainder);
			if (value !== undefined) {
				return value;
			}
		}
	}

	const firstWord = trimmedFirstSegment.split(/\s+/)[0];
	if (firstWord && lowerSegment.startsWith(firstWord.toLowerCase())) {
		const remainder = trimmedSegment.slice(firstWord.length).trim();
		if (remainder.split(/\s+/).length === 1) {
			return parseNumberToken(remainder);
		}
	}

	return undefined;
};

const parseNumericSegment = (segment: string): number | undefined =>
	/^[a-zA-Z0-9-]+$/.test(segment) ? parseNumberToken(segment) : undefined;

const extractGeneralSeasonEpisode = (
	title: string,
): { episode: number; season: number; source: GeneralSource } | undefined => {
	const sxxExxMatch = title.match(/\bS(\d{1,3})\s*E(\d{1,3})\b/i);
	if (sxxExxMatch) {
		const season = parseNumberToken(sxxExxMatch[1] ?? "");
		const episode = parseNumberToken(sxxExxMatch[2] ?? "");
		if (season !== undefined && episode !== undefined) {
			return { episode, season, source: "sxxexx" };
		}
	}

	const seasonEpisodeMatch = title.match(
		/season\s+([A-Za-z0-9]+)[^A-Za-z0-9]+episode\s+([A-Za-z0-9]+)/i,
	);
	if (seasonEpisodeMatch) {
		const season = parseNumberToken(seasonEpisodeMatch[1] ?? "");
		const episode = parseNumberToken(seasonEpisodeMatch[2] ?? "");
		if (season !== undefined && episode !== undefined) {
			return { episode, season, source: "season_episode" };
		}
	}

	return undefined;
};

const cleanTitle = (title: string): string => {
	let cleaned = title;
	for (const pattern of CLEANING_PATTERNS) {
		cleaned = cleaned.replace(pattern, "");
	}

	for (;;) {
		const next = cleaned
			.replace(/: :/g, ":")
			.replace(/  +/g, " ")
			.replace(/:+$/g, "")
			.replace(/\(+$/g, "")
			.replace(/\)+$/g, "")
			.trimEnd();
		if (next === cleaned) {
			return collapseSpaces(next);
		}
		cleaned = next;
	}
};

const constructBaseTitle = (title: string, baseSegments: string[]): string => {
	if (!title.includes(":")) {
		const parenthesesIndex = title.indexOf("(");
		return parenthesesIndex === -1
			? cleanTitle(title)
			: cleanTitle(title.slice(0, parenthesesIndex));
	}

	const baseTitle = cleanTitle(baseSegments.length > 0 ? baseSegments.join(": ") : title);
	return baseTitle || cleanTitle(title);
};

const resolveSeasonEpisode = (input: {
	season?: number;
	episode?: number;
	episodeSource?: EpisodeSource;
	generalPair?: { episode: number; season: number; source: GeneralSource };
}): NetflixEpisodeInfo | undefined => {
	let resolvedSeason = input.season;
	let resolvedEpisode = input.episode;
	if (input.generalPair) {
		const shouldOverrideEpisode =
			input.episodeSource === "episode" && input.generalPair.source === "sxxexx";
		if (resolvedEpisode === undefined || shouldOverrideEpisode) {
			resolvedEpisode = input.generalPair.episode;
		}
		if (resolvedSeason === undefined || shouldOverrideEpisode) {
			resolvedSeason = input.generalPair.season;
		}
	}

	if (resolvedSeason === undefined && input.episodeSource) {
		if (input.episodeSource === "chapter" || input.episodeSource === "parentheses") {
			resolvedSeason = 1;
		}
	}

	return resolvedSeason !== undefined && resolvedEpisode !== undefined
		? { episode: resolvedEpisode, season: resolvedSeason }
		: undefined;
};

const parseNetflixTitle = (
	title: string,
): { baseTitle: string; episodeInfo?: NetflixEpisodeInfo } => {
	const trimmed = title.trim();
	const segments = splitSegments(trimmed);
	if (segments.length === 0) {
		return { baseTitle: cleanTitle(title) };
	}

	const firstSegment = segments[0] ?? "";
	const generalPair = extractGeneralSeasonEpisode(trimmed);
	const baseSegments: string[] = [];
	let season: number | undefined;
	let episode: number | undefined;
	let episodeSource: EpisodeSource | undefined;
	let encounteredStructure = false;

	for (const segment of segments) {
		const extractedEpisode = extractEpisode(segment);
		if (extractedEpisode) {
			episode = extractedEpisode.episode;
			episodeSource = extractedEpisode.source;
			encounteredStructure = true;
			continue;
		}

		const labelledSeason = parseLabelledSeason(segment);
		if (labelledSeason !== undefined) {
			season = labelledSeason;
			encounteredStructure = true;
			continue;
		}

		if (season === undefined) {
			const repeatedSeason = parseRepeatedBaseSeason(segment, firstSegment);
			if (repeatedSeason !== undefined) {
				season = repeatedSeason;
				encounteredStructure = true;
				continue;
			}

			const numericSeason = parseNumericSegment(segment);
			if (numericSeason !== undefined) {
				season = numericSeason;
				encounteredStructure = true;
				continue;
			}
		}

		if (!encounteredStructure) {
			baseSegments.push(segment);
		}
	}

	if (baseSegments.length === 0) {
		baseSegments.push(firstSegment);
	}

	return {
		baseTitle: constructBaseTitle(trimmed, baseSegments),
		episodeInfo: resolveSeasonEpisode({ episode, season, episodeSource, generalPair }),
	};
};

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
	publishYear?: number;
	originalTitle: string;
	resultPosition: number;
	hasShowIndicators: boolean;
	result: NetflixTitleMatchCandidate;
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

export const extractNetflixBaseTitle = (title: string): string =>
	parseNetflixTitle(title).baseTitle;

export const extractNetflixSeasonEpisode = (title: string): NetflixEpisodeInfo | undefined =>
	parseNetflixTitle(title).episodeInfo;

export const hasNetflixShowIndicators = (title: string): boolean =>
	SHOW_INDICATOR_PATTERNS.some((pattern) => pattern.test(title));

export const extractNetflixYearFromTitle = (title: string): number | undefined => {
	for (const pattern of YEAR_PATTERNS) {
		const matched = title.match(pattern)?.[1];
		const parsed = matched ? Number.parseInt(matched, 10) : Number.NaN;
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return undefined;
};

export const chooseBestNetflixTitleMatch = (input: {
	title: string;
	results: NetflixTitleMatchCandidate[];
	preferredEntitySchemaSlug?: "movie" | "show";
}): NetflixTitleMatchCandidate | undefined => {
	const filteredResults = input.preferredEntitySchemaSlug
		? input.results.filter((result) => result.entitySchemaSlug === input.preferredEntitySchemaSlug)
		: input.results;
	if (filteredResults.length === 0) {
		return undefined;
	}

	const cleanedOriginal = extractNetflixBaseTitle(input.title);
	const publishYear = extractNetflixYearFromTitle(input.title);
	const hasShowIndicators = hasNetflixShowIndicators(input.title);
	let bestMatch: { result: NetflixTitleMatchCandidate; score: number } | undefined;
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
