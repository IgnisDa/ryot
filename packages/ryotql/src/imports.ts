import type { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Result } from "effect";

const fail = (message: string) => Result.fail(new Error(message));

export const importQueryDocuments = (
	document: RyotQLDocument,
	imports: Readonly<Record<string, RyotQLDocument>>,
): Result.Result<RyotQLDocument, Error> => {
	if (Object.keys(imports).length === 0) {
		return Result.succeed(document);
	}
	const queries = { ...document.queries };
	const fields = { ...document.parameters?.fields };
	const rules = [...(document.parameters?.rules ?? [])];
	let unknownKeys = document.parameters?.unknownKeys;
	for (const [local, imported] of Object.entries(imports)) {
		if (imported.controls !== undefined) {
			return fail(`Imported query '${local}' declares controls, which pages cannot import`);
		}
		for (const [name, query] of Object.entries(imported.queries)) {
			const key = `${local}.${name}`;
			if (Object.hasOwn(queries, key)) {
				return fail(`Query '${key}' is declared twice`);
			}
			queries[key] = query;
		}
		for (const [key, field] of Object.entries(imported.parameters?.fields ?? {})) {
			if (Object.hasOwn(fields, key) && stableStringify(fields[key]) !== stableStringify(field)) {
				return fail(
					`Parameter '${key}' of imported query '${local}' differs from another parameter named '${key}'`,
				);
			}
			fields[key] = field;
		}
		for (const rule of imported.parameters?.rules ?? []) {
			if (!rules.some((existing) => stableStringify(existing) === stableStringify(rule))) {
				rules.push(rule);
			}
		}
		const importedKeys = imported.parameters?.unknownKeys;
		if (importedKeys !== undefined && unknownKeys !== undefined && importedKeys !== unknownKeys) {
			return fail(`Imported query '${local}' uses a different unknown parameter policy`);
		}
		unknownKeys ??= importedKeys;
	}
	return Result.succeed({
		queries,
		...(document.controls === undefined ? {} : { controls: document.controls }),
		parameters: {
			fields,
			...(rules.length === 0 ? {} : { rules }),
			...(unknownKeys === undefined ? {} : { unknownKeys }),
		},
	});
};
