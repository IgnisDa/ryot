import { canonicalLanguageCode } from "@ryot-app/plugin-kit/languages";

const tmdbLanguageAliases = new Map([
	["cn", "yue"],
	["xx", "zxx"],
]);
const tmdbLanguageCodes = new Map(
	[...tmdbLanguageAliases].map(([provider, canonical]) => [canonical, provider]),
);

export const canonicalTmdbLanguageCode = (value: string) => {
	const code = value.trim().toLowerCase();
	return canonicalLanguageCode(tmdbLanguageAliases.get(code) ?? code);
};

export const tmdbLanguageCode = (canonical: string) =>
	tmdbLanguageCodes.get(canonical) ?? canonical;
