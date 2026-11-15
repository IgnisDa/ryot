import { iso6393 } from "iso-639-3";

const byCode = new Map(
	iso6393.flatMap((language) =>
		[language.iso6391, language.iso6392B, language.iso6392T, language.iso6393]
			.filter((code) => code !== undefined)
			.map((code) => [code, language] as const),
	),
);
const byName = new Map<string, Set<string>>();
for (const language of iso6393) {
	const key = language.name.toLowerCase();
	const candidates = byName.get(key) ?? new Set<string>();
	candidates.add(language.iso6391 ?? language.iso6393);
	byName.set(key, candidates);
}

export const canonicalLanguageCode = (value: string): string | undefined => {
	const language = byCode.get(value.trim().toLowerCase());
	return language === undefined ? undefined : (language.iso6391 ?? language.iso6393);
};

export const languageName = (code: string): string | undefined => byCode.get(code)?.name;

export const languageCodeFromName = (value: string): string | undefined => {
	const candidates = byName.get(value.trim().toLowerCase());
	return candidates?.size === 1 ? [...candidates][0] : undefined;
};

export const languageCodeForIso6393 = (value: string): string | undefined =>
	byCode.get(value.trim().toLowerCase())?.iso6393;

export const canonicalLanguagePattern = `^(?:${[...new Set(iso6393.map((language) => language.iso6391 ?? language.iso6393))].sort().join("|")})$`;
