type LanguageResolution =
	{ readonly kind: "canonical" } | { readonly language: string; readonly kind: "translate" };

export const resolveLanguage = (input: {
	readonly canonicalLanguage: string;
	readonly preferredLanguage: null | string;
}): LanguageResolution => {
	if (input.preferredLanguage === null || input.preferredLanguage === input.canonicalLanguage) {
		return { kind: "canonical" };
	}

	return { kind: "translate", language: input.preferredLanguage };
};
