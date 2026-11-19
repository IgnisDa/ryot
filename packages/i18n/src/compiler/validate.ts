import { Effect, Result, Schema } from "effect";

import {
	CATALOG_LIMITS,
	type CatalogDiagnostic,
	type CompiledCatalog,
	compiledCatalogIssues,
	type CompiledMessage,
	formatCatalogDiagnostic,
} from "../catalog";
import { canonicalLocale, PSEUDO_LOCALE, SOURCE_LOCALE } from "../locale";
import { MESSAGE_KEY_PATTERN, MessageKey } from "../message";
import { argumentMismatch, type MessageArgumentKinds, messageArgumentKinds } from "./arguments";
import { compileMessage } from "./parse";

export type CatalogSourceFile = {
	readonly path: string;
	readonly locale: string;
	readonly content: string;
};

export type ValidatedCatalogSet = {
	readonly locales: ReadonlyArray<string>;
	readonly descriptions: ReadonlyMap<string, string>;
	readonly diagnostics: ReadonlyArray<CatalogDiagnostic>;
	readonly catalogs: ReadonlyMap<string, CompiledCatalog>;
	readonly arguments: ReadonlyMap<string, MessageArgumentKinds>;
};

const SourceEntry = Schema.Union([
	Schema.String,
	Schema.Struct({ message: Schema.String, description: Schema.optionalKey(Schema.String) }),
]);
const decodeEntry = Schema.decodeUnknownResult(SourceEntry);
const decodeSource = Schema.decodeUnknownResult(
	Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const isMessageKey = Schema.is(MessageKey);
const encoder = new TextEncoder();

type LocaleCatalog = {
	readonly path: string;
	readonly catalog: CompiledCatalog;
	readonly descriptions: Map<string, string>;
	readonly arguments: Map<string, MessageArgumentKinds>;
};

const compileSource = (
	file: CatalogSourceFile,
	report: (diagnostic: Omit<CatalogDiagnostic, "file" | "severity">) => void,
): undefined | LocaleCatalog => {
	if (encoder.encode(file.content).byteLength > CATALOG_LIMITS.maxFileBytes) {
		report({
			code: "file-too-large",
			detail: `Catalog exceeds ${CATALOG_LIMITS.maxFileBytes} bytes`,
		});
		return undefined;
	}
	const source = decodeSource(file.content, { onExcessProperty: "error" });
	if (Result.isFailure(source)) {
		report({ code: "invalid-json", detail: "Catalog must be a JSON object" });
		return undefined;
	}
	const entries = Object.entries(source.success);
	if (entries.length > CATALOG_LIMITS.maxKeys) {
		report({
			code: "too-many-keys",
			detail: `Catalog has more than ${CATALOG_LIMITS.maxKeys} keys`,
		});
		return undefined;
	}
	const catalog: Record<string, CompiledMessage> = {};
	const descriptions = new Map<string, string>();
	const kinds = new Map<string, MessageArgumentKinds>();
	for (const [key, value] of entries) {
		if (!isMessageKey(key)) {
			report({ key, code: "invalid-key", detail: `Keys must match ${MESSAGE_KEY_PATTERN.source}` });
			continue;
		}
		const entry = decodeEntry(value, { onExcessProperty: "error" });
		if (Result.isFailure(entry)) {
			report({
				key,
				code: "invalid-entry",
				detail: 'Entries are ICU strings or { "message", "description"? } objects',
			});
			continue;
		}
		const message = typeof entry.success === "string" ? entry.success : entry.success.message;
		if (typeof entry.success === "object" && entry.success.description !== undefined) {
			if (entry.success.description.length > CATALOG_LIMITS.maxDescriptionLength) {
				report({
					key,
					code: "description-too-long",
					detail: `Descriptions are limited to ${CATALOG_LIMITS.maxDescriptionLength} characters`,
				});
			}
			descriptions.set(key, entry.success.description);
		}
		if (message.length > CATALOG_LIMITS.maxMessageLength) {
			report({
				key,
				code: "message-too-long",
				detail: `Messages are limited to ${CATALOG_LIMITS.maxMessageLength} characters`,
			});
			continue;
		}
		const compiled = compileMessage(message);
		if (Result.isFailure(compiled)) {
			for (const issue of compiled.failure) {
				report({ key, ...issue });
			}
			continue;
		}
		const argumentKinds = messageArgumentKinds(compiled.success);
		if (Result.isFailure(argumentKinds)) {
			for (const detail of argumentKinds.failure) {
				report({ key, detail, code: "argument-conflict" });
			}
			continue;
		}
		catalog[key] = compiled.success;
		kinds.set(key, argumentKinds.success);
	}
	return { catalog, descriptions, path: file.path, arguments: kinds };
};

/**
 * The one validator shared by kernel catalogs and `ryot plugin build`. English (`en`) is the
 * source locale; other locales must match its keys and argument types.
 */
export const validateCatalogSources = (
	files: ReadonlyArray<CatalogSourceFile>,
): ValidatedCatalogSet => {
	const diagnostics: CatalogDiagnostic[] = [];
	const compiled = new Map<string, LocaleCatalog>();
	for (const file of files) {
		const report = (diagnostic: Omit<CatalogDiagnostic, "file" | "severity">) =>
			diagnostics.push({ ...diagnostic, file: file.path, severity: "error" });
		if (canonicalLocale(file.locale) !== file.locale || file.locale === PSEUDO_LOCALE) {
			report({
				code: "invalid-locale",
				detail: `"${file.locale}" is not a canonical, non-pseudo BCP 47 locale`,
			});
			continue;
		}
		if (compiled.has(file.locale)) {
			report({ code: "invalid-locale", detail: `Locale "${file.locale}" is declared twice` });
			continue;
		}
		const result = compileSource(file, report);
		if (result !== undefined) {
			diagnostics.push(...compiledCatalogIssues(result.catalog, file.path));
			compiled.set(file.locale, result);
		}
	}
	const source = compiled.get(SOURCE_LOCALE);
	if (source === undefined) {
		diagnostics.push({
			severity: "error",
			code: "missing-source-locale",
			detail: `The source locale "${SOURCE_LOCALE}" catalog is required`,
		});
	}
	const sourceArguments = source?.arguments ?? new Map<string, MessageArgumentKinds>();
	for (const [locale, translation] of compiled) {
		if (locale === SOURCE_LOCALE || source === undefined) {
			continue;
		}
		for (const [key, kinds] of translation.arguments) {
			const expected = sourceArguments.get(key);
			if (expected === undefined) {
				if (!Object.hasOwn(source.catalog, key)) {
					diagnostics.push({
						key,
						severity: "error",
						file: translation.path,
						code: "key-not-in-source",
						detail: `Key is absent from the "${SOURCE_LOCALE}" catalog`,
					});
				}
				continue;
			}
			for (const detail of argumentMismatch(expected, kinds)) {
				diagnostics.push({
					key,
					detail,
					severity: "error",
					file: translation.path,
					code: "argument-mismatch",
				});
			}
		}
		for (const key of Object.keys(source.catalog)) {
			if (!Object.hasOwn(translation.catalog, key)) {
				diagnostics.push({
					key,
					severity: "warning",
					file: translation.path,
					code: "missing-translation",
					detail: `Missing "${locale}" translation; English is used`,
				});
			}
		}
	}
	const locales = [...compiled.keys()].sort((left, right) => {
		if (left === SOURCE_LOCALE || right === SOURCE_LOCALE) {
			return left === SOURCE_LOCALE ? -1 : 1;
		}
		return left < right ? -1 : 1;
	});
	return {
		locales,
		diagnostics,
		arguments: sourceArguments,
		descriptions: source?.descriptions ?? new Map(),
		catalogs: new Map(
			locales.flatMap((locale) => {
				const entry = compiled.get(locale);
				return entry === undefined ? [] : [[locale, entry.catalog] as const];
			}),
		),
	};
};

export const hasCatalogErrors = (diagnostics: ReadonlyArray<CatalogDiagnostic>) =>
	diagnostics.some((diagnostic) => diagnostic.severity === "error");

export const catalogErrorCount = (diagnostics: ReadonlyArray<CatalogDiagnostic>) =>
	diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;

export const logCatalogDiagnostics = Effect.fnUntraced(function* (
	diagnostics: ReadonlyArray<CatalogDiagnostic>,
) {
	for (const diagnostic of diagnostics) {
		yield* (diagnostic.severity === "error" ? Effect.logError : Effect.logWarning)(
			formatCatalogDiagnostic(diagnostic),
		);
	}
});
