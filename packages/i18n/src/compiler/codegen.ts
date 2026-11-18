import { encodeJsonString, stableStringify } from "@ryot-app/ts-utils/json";

import type { CompiledCatalog } from "../catalog";
import type { ArgumentKind, MessageArgumentKinds } from "./arguments";

const argumentTypes = {
	date: "DateArgument",
	text: "TextArgument",
	number: "NumberArgument",
	"calendar-date": "CalendarDateArgument",
	"zoned-date-time": "ZonedDateTimeArgument",
};

const argumentType = (argument: ArgumentKind) =>
	argument.kind === "select"
		? `SelectArgument<${argument.codes.map((code) => encodeJsonString(code)).join(" | ")}>`
		: argumentTypes[argument.kind];

const byName = (left: string, right: string) => (left < right ? -1 : 1);

const docComment = (description: string | undefined) =>
	description === undefined ? "" : `\t/** ${description.replaceAll("*/", "* /")} */\n`;

/** Key → argument types, generated from the source locale for typed message builders. */
export const generateCatalogType = (input: {
	readonly name: string;
	readonly descriptions: ReadonlyMap<string, string>;
	readonly arguments: ReadonlyMap<string, MessageArgumentKinds>;
}) => {
	const members = [...input.arguments.keys()].sort(byName).map((key) => {
		const argumentKinds = Object.entries(input.arguments.get(key) ?? {}).sort(([left], [right]) =>
			byName(left, right),
		);
		const type =
			argumentKinds.length === 0
				? "NoArguments"
				: `{ ${argumentKinds.map(([name, kind]) => `readonly ${name}: ${argumentType(kind)};`).join(" ")} }`;
		return `${docComment(input.descriptions.get(key))}\treadonly ${encodeJsonString(key)}: ${type};`;
	});
	return `export type ${input.name} = {\n${members.join("\n")}\n};\n`;
};

const argumentTypeNames = (argumentKinds: ReadonlyMap<string, MessageArgumentKinds>) =>
	[
		...new Set(
			[...argumentKinds.values()].flatMap((kinds) => {
				const types = Object.values(kinds).map((kind) => argumentType(kind).replace(/<.*$/, ""));
				return types.length === 0 ? ["NoArguments"] : types;
			}),
		),
	].sort(byName);

/**
 * The catalog type and a typed local builder, for catalogs whose namespace the trusted side stamps.
 * `builderModule` must export `localMessageBuilder` and the argument types.
 */
export const generateLocalBuilderModule = (input: {
	readonly typeName: string;
	readonly builderName: string;
	readonly builderModule: string;
	readonly bindingBuilderName: string;
	readonly descriptions: ReadonlyMap<string, string>;
	readonly arguments: ReadonlyMap<string, MessageArgumentKinds>;
}) =>
	[
		`import { ${["localBindingBuilder", "localMessageBuilder", ...argumentTypeNames(input.arguments).map((name) => `type ${name}`)].join(", ")} } from ${encodeJsonString(input.builderModule)};`,
		"",
		generateCatalogType({
			name: input.typeName,
			arguments: input.arguments,
			descriptions: input.descriptions,
		}),
		`export const ${input.builderName} = localMessageBuilder<${input.typeName}>();`,
		"",
		`export const ${input.bindingBuilderName} = localBindingBuilder<${input.typeName}>();`,
		"",
	].join("\n");

export type GeneratedCatalogModules = {
	readonly index: string;
	readonly localeDeclaration: string;
	readonly locales: ReadonlyArray<{ readonly locale: string; readonly content: string }>;
};

/**
 * One index module with the catalog type, locale list and per-locale lazy loaders, plus one data
 * module per locale so bundles load a single locale at a time.
 */
export const generateCatalogModules = (input: {
	readonly typeName: string;
	readonly loaderName: string;
	readonly localesName: string;
	readonly localeTypeName: string;
	readonly localeModule: (locale: string) => string;
	readonly descriptions: ReadonlyMap<string, string>;
	readonly catalogs: ReadonlyMap<string, CompiledCatalog>;
	readonly arguments: ReadonlyMap<string, MessageArgumentKinds>;
}): GeneratedCatalogModules => {
	const locales = [...input.catalogs.keys()];
	const loaders = locales.map(
		(locale) =>
			`\t${encodeJsonString(locale)}: () => import(${encodeJsonString(input.localeModule(locale))}),`,
	);
	const argumentImports = argumentTypeNames(input.arguments);
	const index = [
		...(argumentImports.length === 0
			? []
			: [`import type { ${argumentImports.join(", ")} } from "@ryot-app/i18n/builder";`]),
		`import type { CompiledCatalog } from "@ryot-app/i18n/catalog";`,
		`import { Effect } from "effect";`,
		"",
		generateCatalogType({
			name: input.typeName,
			arguments: input.arguments,
			descriptions: input.descriptions,
		}),
		`export const ${input.localesName} = [${locales.map((locale) => encodeJsonString(locale)).join(", ")}] as const;`,
		"",
		`export type ${input.localeTypeName} = (typeof ${input.localesName})[number];`,
		"",
		`const loaders: { readonly [Locale in ${input.localeTypeName}]: () => Promise<{ readonly catalog: CompiledCatalog }> } = {`,
		...loaders,
		"};",
		"",
		`export const ${input.loaderName} = (locale: ${input.localeTypeName}): Effect.Effect<CompiledCatalog> =>`,
		"\tEffect.map(Effect.promise(loaders[locale]), (module) => module.catalog);",
		"",
	].join("\n");
	return {
		index,
		localeDeclaration:
			'import type { CompiledCatalog } from "@ryot-app/i18n/catalog";\n\nexport declare const catalog: CompiledCatalog;\n',
		locales: [...input.catalogs].map(([locale, catalog]) => ({
			locale,
			content: `export const catalog = ${stableStringify(catalog)};\n`,
		})),
	};
};
