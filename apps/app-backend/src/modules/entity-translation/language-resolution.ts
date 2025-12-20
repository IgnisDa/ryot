type LanguageResolution =
	| { readonly kind: "canonical" }
	| { readonly kind: "translate"; readonly language: string };

export const resolveLanguage = (input: {
	readonly canonicalLanguage: string;
	readonly preferredLanguage: string | null;
}): LanguageResolution => {
	if (input.preferredLanguage === null || input.preferredLanguage === input.canonicalLanguage) {
		return { kind: "canonical" };
	}

	return { kind: "translate", language: input.preferredLanguage };
};
