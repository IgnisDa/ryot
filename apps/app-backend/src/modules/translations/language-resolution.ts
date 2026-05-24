export type LanguagePreference = {
	readonly source: string;
	readonly preferredLanguage: string;
};

export type LanguageResolution =
	| { readonly kind: "canonical" }
	| { readonly kind: "translate"; readonly language: string };

/**
 * Decides whether a user's per-provider language preference requires a
 * translation overlay for an entity, or whether the canonical (shared) entity
 * should be rendered as-is.
 *
 * - No preference for the provider `source` → render canonical.
 * - Preference equal to the provider's canonical language → render canonical.
 * - A differing preference → translate, carrying the provider-native language.
 */
export const resolveLanguage = (input: {
	readonly source: string;
	readonly canonicalLanguage: string;
	readonly preferences: ReadonlyArray<LanguagePreference>;
}): LanguageResolution => {
	const preference = input.preferences.find((entry) => entry.source === input.source);
	if (!preference || preference.preferredLanguage === input.canonicalLanguage) {
		return { kind: "canonical" };
	}

	return { kind: "translate", language: preference.preferredLanguage };
};
