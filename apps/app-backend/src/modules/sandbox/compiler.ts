import {
	SandboxCompilationFailure,
	type SandboxCompilationDiagnostic,
} from "@ryot/contract/modules/sandbox/schemas";
import { sandboxManifestSchema, type SandboxManifest } from "@ryot/sandbox-sdk";
import { Effect } from "effect";
import ts from "typescript-compiler";

import { isSandboxHostCapability } from "./capabilities";
import { bundleUserScript } from "./compiler-bundle";

export const SANDBOX_COMPILED_FORMAT = 1 as const;

export type CompiledSandboxModule = {
	readonly javascript: string;
	readonly manifest: SandboxManifest;
	readonly format: typeof SANDBOX_COMPILED_FORMAT;
};

const sourceFile = "script.ts";
const sdkImport = "@ryot/sandbox-sdk";
const virtualSourceFile = "/__ryot_sandbox__/script.ts";
const compilationFailedMessage = "Sandbox TypeScript compilation failed";

const diagnosticAt = (
	node: ts.Node,
	code: string,
	message: string,
): SandboxCompilationDiagnostic => {
	const file = node.getSourceFile();
	const start = node.getStart(file);
	const location = file.getLineAndCharacterOfPosition(start);

	return {
		code,
		message,
		file: sourceFile,
		severity: "error",
		line: location.line + 1,
		column: location.character + 1,
		length: node.getWidth(file),
	};
};

const compilationFailure = (diagnostics: readonly SandboxCompilationDiagnostic[]) =>
	new SandboxCompilationFailure({
		message: compilationFailedMessage,
		diagnostics: [...diagnostics],
	});

const diagnosticSeverity = (category: ts.DiagnosticCategory) => {
	if (category === ts.DiagnosticCategory.Warning) {
		return "warning" as const;
	}
	if (category === ts.DiagnosticCategory.Message || category === ts.DiagnosticCategory.Suggestion) {
		return "info" as const;
	}
	return "error" as const;
};

const toTypeScriptDiagnostic = (diagnostic: ts.Diagnostic): SandboxCompilationDiagnostic => {
	const start = diagnostic.start ?? 0;
	const location = diagnostic.file?.getLineAndCharacterOfPosition(start);

	return {
		file: sourceFile,
		code: `TS${diagnostic.code}`,
		line: (location?.line ?? 0) + 1,
		column: (location?.character ?? 0) + 1,
		severity: diagnosticSeverity(diagnostic.category),
		message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
		...(diagnostic.length === undefined ? {} : { length: diagnostic.length }),
	};
};

const getModuleSpecifier = (node: ts.ImportDeclaration | ts.ExportDeclaration) =>
	node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
		? node.moduleSpecifier.text
		: null;

const inspectImports = (file: ts.SourceFile) => {
	const diagnostics: SandboxCompilationDiagnostic[] = [];
	const manifestHelpers = new Set<string>();

	for (const reference of [
		...file.referencedFiles,
		...file.typeReferenceDirectives,
		...file.libReferenceDirectives,
	]) {
		diagnostics.push(
			diagnosticAt(
				file,
				"RYOT_IMPORT",
				`Reference directives are not allowed (${reference.fileName})`,
			),
		);
	}

	for (const statement of file.statements) {
		if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) {
			const specifier = getModuleSpecifier(statement);
			if (specifier !== null && specifier !== sdkImport) {
				diagnostics.push(
					diagnosticAt(
						statement.moduleSpecifier ?? statement,
						"RYOT_IMPORT",
						`Import "${specifier}" is not allowed; use only "${sdkImport}"`,
					),
				);
			}

			if (ts.isImportDeclaration(statement) && specifier === sdkImport) {
				const bindings = statement.importClause?.namedBindings;
				if (bindings && ts.isNamedImports(bindings)) {
					for (const element of bindings.elements) {
						if ((element.propertyName ?? element.name).text === "defineManifest") {
							manifestHelpers.add(element.name.text);
						}
					}
				}
			}
		}

		if (ts.isImportEqualsDeclaration(statement)) {
			diagnostics.push(
				diagnosticAt(statement, "RYOT_IMPORT", "Import assignments are not allowed"),
			);
		}
	}

	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			diagnostics.push(diagnosticAt(node, "RYOT_IMPORT", "Dynamic imports are not allowed"));
		}
		if (
			ts.isCallExpression(node) &&
			(ts.isIdentifier(node.expression)
				? node.expression.text === "require"
				: ts.isPropertyAccessExpression(node.expression) &&
					((ts.isIdentifier(node.expression.expression) &&
						node.expression.expression.text === "require") ||
						node.expression.name.text === "require"))
		) {
			diagnostics.push(diagnosticAt(node, "RYOT_IMPORT", "CommonJS require calls are not allowed"));
		}
		if (ts.isImportTypeNode(node)) {
			diagnostics.push(
				diagnosticAt(node, "RYOT_IMPORT", "Import type expressions are not allowed"),
			);
		}
		ts.forEachChild(node, visit);
	};
	visit(file);

	return { diagnostics, manifestHelpers };
};

type LiteralResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly diagnostic: SandboxCompilationDiagnostic };

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
	if (
		ts.isParenthesizedExpression(expression) ||
		ts.isAsExpression(expression) ||
		ts.isSatisfiesExpression(expression)
	) {
		return unwrapExpression(expression.expression);
	}
	return expression;
};

const propertyName = (name: ts.PropertyName) => {
	if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return null;
};

const readLiteral = (rawExpression: ts.Expression): LiteralResult => {
	const expression = unwrapExpression(rawExpression);
	if (ts.isStringLiteralLike(expression)) {
		return { ok: true, value: expression.text };
	}
	if (ts.isNumericLiteral(expression)) {
		return { ok: true, value: Number(expression.text) };
	}
	if (expression.kind === ts.SyntaxKind.TrueKeyword) {
		return { ok: true, value: true };
	}
	if (expression.kind === ts.SyntaxKind.FalseKeyword) {
		return { ok: true, value: false };
	}
	if (expression.kind === ts.SyntaxKind.NullKeyword) {
		return { ok: true, value: null };
	}
	if (
		ts.isPrefixUnaryExpression(expression) &&
		expression.operator === ts.SyntaxKind.MinusToken &&
		ts.isNumericLiteral(expression.operand)
	) {
		return { ok: true, value: -Number(expression.operand.text) };
	}
	if (ts.isArrayLiteralExpression(expression)) {
		const values: unknown[] = [];
		for (const element of expression.elements) {
			if (ts.isSpreadElement(element)) {
				return {
					ok: false,
					diagnostic: diagnosticAt(element, "RYOT_MANIFEST", "Manifest spreads are not allowed"),
				};
			}
			const result = readLiteral(element);
			if (!result.ok) {
				return result;
			}
			values.push(result.value);
		}
		return { ok: true, value: values };
	}
	if (ts.isObjectLiteralExpression(expression)) {
		const value: Record<string, unknown> = {};
		for (const property of expression.properties) {
			if (!ts.isPropertyAssignment(property)) {
				return {
					ok: false,
					diagnostic: diagnosticAt(
						property,
						"RYOT_MANIFEST",
						"Manifest properties must be direct literal assignments",
					),
				};
			}
			const key = propertyName(property.name);
			if (key === null || Object.hasOwn(value, key)) {
				return {
					ok: false,
					diagnostic: diagnosticAt(
						property.name,
						"RYOT_MANIFEST",
						key === null
							? "Computed manifest properties are not allowed"
							: `Duplicate manifest property "${key}"`,
					),
				};
			}
			const result = readLiteral(property.initializer);
			if (!result.ok) {
				return result;
			}
			value[key] = result.value;
		}
		return { ok: true, value };
	}

	return {
		ok: false,
		diagnostic: diagnosticAt(
			expression,
			"RYOT_MANIFEST",
			"Manifest values must be JSON-safe literals",
		),
	};
};

const extractManifest = (file: ts.SourceFile, manifestHelpers: ReadonlySet<string>) => {
	const declarations: ts.VariableDeclaration[] = [];
	for (const statement of file.statements) {
		if (
			!ts.isVariableStatement(statement) ||
			!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
		) {
			continue;
		}
		for (const declaration of statement.declarationList.declarations) {
			if (ts.isIdentifier(declaration.name) && declaration.name.text === "manifest") {
				declarations.push(declaration);
			}
		}
	}

	if (declarations.length !== 1) {
		return {
			diagnostic: diagnosticAt(
				file,
				"RYOT_MANIFEST",
				"Source must export exactly one const named manifest",
			),
		};
	}

	const declaration = declarations[0];
	if (!declaration || !(declaration.parent.flags & ts.NodeFlags.Const)) {
		return {
			diagnostic: diagnosticAt(
				declaration ?? file,
				"RYOT_MANIFEST",
				"The exported manifest must be declared with const",
			),
		};
	}
	const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
	if (
		!initializer ||
		!ts.isCallExpression(initializer) ||
		!ts.isIdentifier(initializer.expression) ||
		!manifestHelpers.has(initializer.expression.text) ||
		initializer.arguments.length !== 1
	) {
		return {
			diagnostic: diagnosticAt(
				declaration,
				"RYOT_MANIFEST",
				`The exported manifest must be a direct ${sdkImport} defineManifest call`,
			),
		};
	}

	const argument = initializer.arguments[0];
	if (!argument) {
		return { diagnostic: diagnosticAt(initializer, "RYOT_MANIFEST", "Manifest is required") };
	}
	const literal = readLiteral(argument);
	if (!literal.ok) {
		return { diagnostic: literal.diagnostic };
	}

	const parsed = sandboxManifestSchema.safeParse(literal.value);
	if (!parsed.success) {
		return {
			diagnostic: diagnosticAt(
				argument,
				"RYOT_MANIFEST",
				parsed.error.issues
					.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`)
					.join("; "),
			),
		};
	}
	const unknownCapability = parsed.data.capabilities.find(
		(capability) => !isSandboxHostCapability(capability),
	);
	if (unknownCapability) {
		return {
			diagnostic: diagnosticAt(
				argument,
				"RYOT_MANIFEST",
				`Unknown sandbox host capability: ${unknownCapability}`,
			),
		};
	}

	return { manifest: parsed.data };
};

const typeCheck = (source: string, sdkEntry: string, compilerEntry: string) => {
	const options: ts.CompilerOptions = {
		types: [],
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		isolatedModules: true,
		noImplicitReturns: true,
		module: ts.ModuleKind.ESNext,
		target: ts.ScriptTarget.ES2022,
		noUncheckedIndexedAccess: true,
		exactOptionalPropertyTypes: true,
		allowSyntheticDefaultImports: true,
		lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
		moduleDetection: ts.ModuleDetectionKind.Force,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
	};
	const defaultHost = ts.createCompilerHost(options, true);
	const compilerLibDirectory = compilerEntry.slice(0, compilerEntry.lastIndexOf("/"));
	const cache = ts.createModuleResolutionCache(
		defaultHost.getCurrentDirectory(),
		(fileName) => defaultHost.getCanonicalFileName(fileName),
		options,
	);
	const host: ts.CompilerHost = {
		...defaultHost,
		getDefaultLibLocation: () => compilerLibDirectory,
		getDefaultLibFileName: () => `${compilerLibDirectory}/lib.d.ts`,
		fileExists: (fileName) => fileName === virtualSourceFile || defaultHost.fileExists(fileName),
		readFile: (fileName) =>
			fileName === virtualSourceFile ? source : defaultHost.readFile(fileName),
		getSourceFile: (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) =>
			fileName === virtualSourceFile
				? ts.createSourceFile(fileName, source, languageVersionOrOptions, true, ts.ScriptKind.TS)
				: defaultHost.getSourceFile(
						fileName,
						languageVersionOrOptions,
						onError,
						shouldCreateNewSourceFile,
					),
		resolveModuleNameLiterals: (literals, containingFile, redirectedReference, compilerOptions) =>
			literals.map((literal) =>
				containingFile === virtualSourceFile && literal.text === sdkImport
					? {
							resolvedModule: {
								extension: ts.Extension.Ts,
								resolvedFileName: sdkEntry,
								isExternalLibraryImport: true,
							},
						}
					: ts.resolveModuleName(
							literal.text,
							containingFile,
							compilerOptions,
							defaultHost,
							cache,
							redirectedReference,
						),
			),
	};
	const program = ts.createProgram({ rootNames: [virtualSourceFile], options, host });
	return ts.getPreEmitDiagnostics(program).map(toTypeScriptDiagnostic);
};

export class SandboxCompiler extends Effect.Service<SandboxCompiler>()("SandboxCompiler", {
	sync: () => ({
		compile: (source: string) =>
			Effect.gen(function* () {
				const parsedSource = ts.createSourceFile(
					virtualSourceFile,
					source,
					ts.ScriptTarget.ES2022,
					true,
					ts.ScriptKind.TS,
				);
				const imports = inspectImports(parsedSource);
				if (imports.diagnostics.length > 0) {
					return yield* compilationFailure(imports.diagnostics);
				}

				const dependencies = yield* Effect.try({
					try: () => {
						const from = Bun.fileURLToPath(new URL(".", import.meta.url));
						return {
							sdkEntry: Bun.resolveSync(sdkImport, from),
							compilerEntry: Bun.resolveSync("typescript-compiler", from),
						};
					},
					catch: (error) =>
						compilationFailure([
							{
								line: 1,
								column: 1,
								file: sourceFile,
								severity: "error",
								code: "RYOT_COMPILER",
								message: `Sandbox compiler dependencies could not be resolved: ${String(error)}`,
							},
						]),
				});
				const typeDiagnostics = yield* Effect.try({
					try: () => typeCheck(source, dependencies.sdkEntry, dependencies.compilerEntry),
					catch: (error) =>
						compilationFailure([
							{
								line: 1,
								column: 1,
								file: sourceFile,
								severity: "error",
								code: "RYOT_COMPILER",
								message: `TypeScript compiler failed: ${String(error)}`,
							},
						]),
				});
				if (typeDiagnostics.some((diagnostic) => diagnostic.severity === "error")) {
					return yield* compilationFailure(typeDiagnostics);
				}

				const extracted = extractManifest(parsedSource, imports.manifestHelpers);
				if ("diagnostic" in extracted) {
					return yield* compilationFailure([extracted.diagnostic]);
				}

				const bundled = yield* bundleUserScript(source, dependencies.sdkEntry);
				if ("diagnostics" in bundled) {
					return yield* compilationFailure(bundled.diagnostics);
				}

				return {
					manifest: extracted.manifest,
					javascript: bundled.javascript,
					format: SANDBOX_COMPILED_FORMAT,
				} satisfies CompiledSandboxModule;
			}),
	}),
}) {}
