const unsafeSourceCharacters: Record<string, string> = {
	"<": "\\u003C",
	">": "\\u003E",
	"\u2028": "\\u2028",
	"\u2029": "\\u2029",
};

export const sourceLiteral = (value: unknown) =>
	JSON.stringify(value).replace(
		/[<>\u2028\u2029]/g,
		(character) => unsafeSourceCharacters[character] ?? character,
	);
