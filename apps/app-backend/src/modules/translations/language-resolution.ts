export type LanguagePreference = {
	readonly source: string;
	readonly preferredLanguage: string;
};

type LanguageResolution =
	| { readonly kind: "canonical" }
	| { readonly kind: "translate"; readonly language: string };

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
