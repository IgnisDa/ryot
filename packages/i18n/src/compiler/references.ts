import type { CatalogDiagnostic } from "../catalog";
import { MESSAGE_KEY_PATTERN } from "../message";

export type ReferenceSourceFile = { readonly path: string; readonly content: string };

export type UnknownMessageReference = {
	readonly key: string;
	readonly file: string;
	readonly line: number;
};

export type MessageReferenceScan = {
	readonly referenced: ReadonlySet<string>;
	readonly unknown: ReadonlyArray<UnknownMessageReference>;
};

/** TypeScript sources that can reference catalog keys: not tests, test support or generated files. */
export const isReferenceSource = (path: string) =>
	/\.tsx?$/.test(path) &&
	!path.includes(".test.") &&
	!path.includes(".test-support.") &&
	!path.endsWith(".generated.ts") &&
	!path.split("/").includes("node_modules");

const KEY_LITERAL = /(["'`])([a-z][a-z0-9.-]*)\1/g;

const lineAt = (content: string, index: number) => content.slice(0, index).split("\n").length;

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * Keys are referenced only as string literals: any literal equal to a catalog key counts as a use,
 * and a literal passed first to one of `builders` must name a catalog key.
 */
export const scanMessageReferences = (input: {
	readonly keys: ReadonlySet<string>;
	readonly builders: ReadonlyArray<string>;
	readonly files: ReadonlyArray<ReferenceSourceFile>;
}): MessageReferenceScan => {
	const referenced = new Set<string>();
	const unknown: UnknownMessageReference[] = [];
	const builderCall =
		input.builders.length === 0
			? undefined
			: new RegExp(
					String.raw`\b(?:${input.builders.map(escapeRegExp).join("|")})\(\s*(["'\x60])([^"'\x60\n]*)\1`,
					"g",
				);
	for (const file of input.files) {
		for (const match of file.content.matchAll(KEY_LITERAL)) {
			const key = match[2];
			if (key !== undefined && input.keys.has(key)) {
				referenced.add(key);
			}
		}
		if (builderCall === undefined) {
			continue;
		}
		for (const match of file.content.matchAll(builderCall)) {
			const key = match[2];
			if (key !== undefined && !input.keys.has(key)) {
				unknown.push({ key, file: file.path, line: lineAt(file.content, match.index) });
			}
		}
	}
	return { unknown, referenced };
};

export const referenceDiagnostics = (input: {
	readonly catalogPath: string;
	readonly scan: MessageReferenceScan;
	readonly keys: ReadonlyArray<string>;
}): ReadonlyArray<CatalogDiagnostic> => [
	...input.scan.unknown.map((reference): CatalogDiagnostic => ({
		severity: "error",
		key: reference.key,
		code: "unknown-key",
		file: `${reference.file}:${reference.line}`,
		detail: MESSAGE_KEY_PATTERN.test(reference.key)
			? "Referenced key has no source-locale message"
			: "Message keys must be literal catalog keys",
	})),
	...input.keys
		.filter((key) => !input.scan.referenced.has(key))
		.map((key): CatalogDiagnostic => ({
			key,
			severity: "error",
			code: "unused-key",
			file: input.catalogPath,
			detail: "Key is not referenced by any scanned source",
		})),
];
