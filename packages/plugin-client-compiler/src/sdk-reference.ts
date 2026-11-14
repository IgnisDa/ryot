import { sortBy } from "@ryot-app/ts-utils/lodash";
import {
	TypeScriptProjectError,
	typeScriptRequest,
	withTypeScriptProject,
} from "@ryot-app/typescript-compiler";
import { Effect, FileSystem } from "effect";
import {
	isExportDeclaration,
	isExportSpecifier,
	isImportDeclaration,
} from "typescript/unstable/ast";
import { NodeBuilderFlags, SignatureKind, SymbolFlags, type Type } from "typescript/unstable/async";

import {
	CLIENT_DEPENDENCY_SPECIFIERS,
	resolveClientPluginCompilerDependencies,
} from "./dependencies";
import { clientTypeScriptProject } from "./semantic-check";

const sdkPackage = (specifier: string) =>
	["@ryot-app/plugin-client-sdk", "@ryot-app/plugin-ui-sdk"].some(
		(name) => specifier === name || specifier.startsWith(`${name}/`),
	);

export type ClientSdkReferenceTopic = { readonly topic: string; readonly content: string };

export const generateClientSdkReference = Effect.fn("generateClientSdkReference")(function* () {
	const fs = yield* FileSystem.FileSystem;
	const dependencies = yield* resolveClientPluginCompilerDependencies;
	const specifiers = sortBy(
		CLIENT_DEPENDENCY_SPECIFIERS.filter(sdkPackage),
		(specifier) => specifier,
	);
	const entry = "reference.ts";
	const source = specifiers.map((specifier) => `import ${JSON.stringify(specifier)};`).join("\n");
	const api = yield* withTypeScriptProject(
		{
			entries: [entry],
			files: { [entry]: source },
			projectKind: "client SDK reference",
			virtualRoot: "/__ryot_sdk_reference__",
			tsserverPath: dependencies.tsserverPath,
			configuration: {
				compilerOptions: {
					...clientTypeScriptProject.compilerOptions,
					paths: Object.fromEntries(
						Object.entries(dependencies.typeScriptEntries).map(([name, path]) => [name, [path]]),
					),
				},
			},
		},
		({ checker, diagnostics, entrySourceFiles }) =>
			Effect.gen(function* () {
				const errors = [...diagnostics.project, ...diagnostics.environment].filter(
					({ severity }) => severity === "error",
				);
				if (errors.length > 0) {
					return yield* new TypeScriptProjectError({
						message: errors.map((error) => error.message).join("\n"),
					});
				}
				const sdkRoots = [dependencies.clientSdkRoot, dependencies.uiSdkRoot].map((root) =>
					root.toLowerCase(),
				);
				const file = entrySourceFiles[entry];
				if (!file) {
					return yield* Effect.die(new Error("SDK reference entry was not loaded"));
				}
				const format = (type: Type, expand = false) =>
					typeScriptRequest(() =>
						checker.typeToString(
							type,
							file,
							NodeBuilderFlags.NoTruncation | (expand ? NodeBuilderFlags.InTypeAlias : 0),
						),
					).pipe(Effect.map((text) => text.replaceAll(/import\("[^"]+"\)\./g, "")));
				const properties = Effect.fnUntraced(function* (type: Type) {
					const members = yield* typeScriptRequest(() => checker.getPropertiesOfType(type));
					return yield* Effect.forEach(
						sortBy(
							members.filter(
								(member) =>
									!member.name.startsWith("__@") &&
									member.declarations.some((declaration) =>
										sdkRoots.some((root) => declaration.path.toLowerCase().startsWith(`${root}/`)),
									),
							),
							(member) => member.name,
						),
						(member) =>
							Effect.gen(function* () {
								const value = yield* typeScriptRequest(() => checker.getTypeOfSymbol(member));
								if (!value) {
									return yield* new TypeScriptProjectError({
										message: `SDK member has no type: ${member.name}`,
									});
								}
								return `${member.name}${member.flags & SymbolFlags.Optional ? "?" : ""}: ${yield* format(value)};`;
							}),
						{ concurrency: 8 },
					);
				});
				return yield* Effect.forEach(
					file.statements.filter(isImportDeclaration),
					(statement, index) =>
						Effect.gen(function* () {
							const module = yield* typeScriptRequest(() =>
								checker.getSymbolAtLocation(statement.moduleSpecifier),
							);
							const specifier = specifiers[index];
							if (!module || specifier === undefined) {
								return yield* Effect.die(
									new Error(`SDK module could not be resolved: ${specifiers[index]}`),
								);
							}
							const exports = yield* typeScriptRequest(() => checker.getExportsOfModule(module));
							const declarations = yield* Effect.forEach(
								sortBy(exports, (symbol) => symbol.name),
								(exported) =>
									Effect.gen(function* () {
										const symbol =
											exported.flags & SymbolFlags.Alias
												? yield* typeScriptRequest(() => checker.getAliasedSymbol(exported))
												: exported;
										const exportDeclarations = yield* Effect.forEach(
											exported.declarations,
											(declaration) => typeScriptRequest(() => declaration.resolve()),
										);
										const typeOnly = exportDeclarations.some(
											(declaration) =>
												declaration !== undefined &&
												isExportSpecifier(declaration) &&
												(declaration.isTypeOnly ||
													(isExportDeclaration(declaration.parent.parent) &&
														declaration.parent.parent.isTypeOnly)),
										);
										const isType = typeOnly || !(symbol.flags & SymbolFlags.Value);
										const type = !isType
											? yield* typeScriptRequest(() => checker.getTypeOfSymbol(symbol))
											: yield* typeScriptRequest(() => checker.getDeclaredTypeOfSymbol(symbol));
										if (!type) {
											return yield* Effect.die(
												new Error(`SDK export has no type: ${exported.name}`),
											);
										}
										const lines = [`${exported.name}: ${yield* format(type, isType)}`];
										if (isType) {
											lines.push(...(yield* properties(type)));
										}
										if (/^[A-Z]/.test(exported.name)) {
											const signatures = yield* typeScriptRequest(() =>
												checker.getSignaturesOfType(type, SignatureKind.Call),
											);
											for (const signature of signatures) {
												const props = yield* typeScriptRequest(() =>
													checker.getParameterType(signature, 0),
												);
												if (props) {
													lines.push(...(yield* properties(props)));
												}
											}
										}
										return lines.join("\n");
									}),
								{ concurrency: 8 },
							);
							return {
								topic: specifier,
								content: `# ${specifier}\n\nSignatures omit module qualifications.\n\n\u0060\u0060\u0060ts\n${declarations.join("\n\n")}\n\u0060\u0060\u0060\n`,
							} satisfies ClientSdkReferenceTopic;
						}),
				);
			}),
	);
	const guidance = yield* Effect.forEach(
		[dependencies.clientSdkRoot, dependencies.uiSdkRoot],
		(root) => fs.readFileString(`${root}/../assistant-reference.md`),
	);
	const pages: ClientSdkReferenceTopic = {
		topic: "pages",
		content:
			[
				"# Page authoring",
				"Only the supported import list grants author import access; referenced implementation types do not grant additional imports. Inherited platform props use their standard React types. Read an import's topic for its signatures.",
				...guidance,
				"## Supported author imports",
				sortBy(CLIENT_DEPENDENCY_SPECIFIERS, (specifier) => specifier)
					.map((specifier) => `- ${specifier}`)
					.join("\n"),
			].join("\n\n") + "\n",
	};
	return [pages, ...api];
});
