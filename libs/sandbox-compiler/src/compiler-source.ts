import { SANDBOX_SDK_IMPORTS, SANDBOX_SDK_ROOT_IMPORT } from "@ryot/sandbox-sdk/imports";
import * as ts from "typescript/unstable/ast";

import {
	type SandboxCompilerDiagnostic,
	sandboxDiagnosticAt as diagnosticAt,
	sandboxPropertyName as propertyName,
} from "./compiler-diagnostics";

const allowedImports = new Set<string>(SANDBOX_SDK_IMPORTS);

const getModuleSpecifier = (node: ts.ImportDeclaration | ts.ExportDeclaration) =>
	node.moduleSpecifier && ts.isStringLiteralLikeNode(node.moduleSpecifier)
		? node.moduleSpecifier.text
		: null;

const generatedModulePattern = /\b(?:import|require)\s*\(/;
const codeGeneratorNames = new Set([
	"eval",
	"Function",
	"constructor",
	"AsyncFunction",
	"GeneratorFunction",
	"AsyncGeneratorFunction",
]);

const codeGeneratorName = (expression: ts.Expression) => {
	if (ts.isIdentifier(expression)) {
		return expression.text;
	}
	if (ts.isPropertyAccessExpression(expression)) {
		return expression.name.text;
	}
	if (
		ts.isElementAccessExpression(expression) &&
		ts.isStringLiteralLikeNode(expression.argumentExpression)
	) {
		return expression.argumentExpression.text;
	}
	return null;
};

const inspectsGeneratedModule = (node: ts.CallExpression | ts.NewExpression) => {
	const name = codeGeneratorName(node.expression);
	if (name === "Worker" || name === "SharedWorker") {
		return true;
	}
	return (
		name !== null &&
		codeGeneratorNames.has(name) &&
		node.arguments?.some((argument) => generatedModulePattern.test(argument.getText())) === true
	);
};

const inspectImports = (file: ts.SourceFile) => {
	const driverHelpers = new Set<string>();
	const scriptHelpers = new Set<string>();
	const manifestHelpers = new Set<string>();
	const diagnostics: SandboxCompilerDiagnostic[] = [];

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
			if (specifier !== null && !allowedImports.has(specifier)) {
				diagnostics.push(
					diagnosticAt(
						statement.moduleSpecifier ?? statement,
						"RYOT_IMPORT",
						`Import "${specifier}" is not allowed; use an approved ${SANDBOX_SDK_ROOT_IMPORT} entry point`,
					),
				);
			}

			if (ts.isImportDeclaration(statement) && specifier === SANDBOX_SDK_ROOT_IMPORT) {
				const bindings = statement.importClause?.namedBindings;
				if (bindings && ts.isNamedImports(bindings)) {
					for (const element of bindings.elements) {
						const importedName = (element.propertyName ?? element.name).text;
						if (importedName === "defineDriver") {
							driverHelpers.add(element.name.text);
						}
						if (importedName === "defineManifest") {
							manifestHelpers.add(element.name.text);
						}
						if (importedName === "defineScript") {
							scriptHelpers.add(element.name.text);
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
		if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && inspectsGeneratedModule(node)) {
			diagnostics.push(
				diagnosticAt(node, "RYOT_IMPORT", "Generated module loading and workers are not allowed"),
			);
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
		node.forEachChild(visit);
	};
	visit(file);

	return { diagnostics, driverHelpers, manifestHelpers, scriptHelpers };
};

const topLevelDriverName = (call: ts.CallExpression, file: ts.SourceFile) => {
	const declaration = call.parent;
	if (
		!ts.isVariableDeclaration(declaration) ||
		declaration.initializer !== call ||
		!ts.isIdentifier(declaration.name)
	) {
		return null;
	}
	const declarationList = declaration.parent;
	const statement = declarationList.parent;
	if (
		!(declarationList.flags & ts.NodeFlags.Const) ||
		!ts.isVariableStatement(statement) ||
		statement.parent !== file
	) {
		return null;
	}

	return declaration.name.text;
};

const inspectDriverDefinitions = (file: ts.SourceFile, driverHelpers: ReadonlySet<string>) => {
	const diagnostics: SandboxCompilerDiagnostic[] = [];
	const driverNames = new Set<string>();
	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node) && driverHelpers.has(node.text)) {
			const parent = node.parent;
			const isImport = ts.isImportSpecifier(parent) && parent.name === node;
			const isDirectCall = ts.isCallExpression(parent) && parent.expression === node;
			if (!isImport && !isDirectCall) {
				diagnostics.push(
					diagnosticAt(
						node,
						"RYOT_DEFINITION",
						"defineDriver may only be used as a direct function call",
					),
				);
			}
		}
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			driverHelpers.has(node.expression.text)
		) {
			const manifest = node.arguments[0];
			if (
				node.typeArguments?.length ||
				!manifest ||
				!ts.isIdentifier(manifest) ||
				manifest.text !== "manifest"
			) {
				diagnostics.push(
					diagnosticAt(
						manifest ?? node,
						"RYOT_DEFINITION",
						'defineDriver must receive the exported "manifest" identifier directly',
					),
				);
			} else {
				const driverName = topLevelDriverName(node, file);
				if (driverName === null) {
					diagnostics.push(
						diagnosticAt(node, "RYOT_DEFINITION", "defineDriver must initialize a top-level const"),
					);
				} else {
					driverNames.add(driverName);
				}
			}
		}
		node.forEachChild(visit);
	};
	visit(file);

	return { diagnostics, driverNames };
};

const getTopLevelDriverRecord = (file: ts.SourceFile, name: string) => {
	for (const statement of file.statements) {
		if (
			!ts.isVariableStatement(statement) ||
			!(statement.declarationList.flags & ts.NodeFlags.Const)
		) {
			continue;
		}
		for (const declaration of statement.declarationList.declarations) {
			if (
				ts.isIdentifier(declaration.name) &&
				declaration.name.text === name &&
				declaration.initializer &&
				ts.isObjectLiteralExpression(declaration.initializer)
			) {
				return declaration.initializer;
			}
		}
	}

	return null;
};

const inspectScriptDefinition = (
	file: ts.SourceFile,
	scriptHelpers: ReadonlySet<string>,
	driverNames: ReadonlySet<string>,
) => {
	const defaults = file.statements.filter(
		(statement): statement is ts.ExportAssignment =>
			ts.isExportAssignment(statement) && !statement.isExportEquals,
	);
	if (defaults.length !== 1) {
		return [
			diagnosticAt(
				file,
				"RYOT_DEFINITION",
				"Source must have exactly one default defineScript export",
			),
		];
	}

	const assignment = defaults[0];
	const call = assignment?.expression;
	if (
		!call ||
		!ts.isCallExpression(call) ||
		!ts.isIdentifier(call.expression) ||
		!scriptHelpers.has(call.expression.text) ||
		call.typeArguments?.length ||
		call.arguments.length !== 1
	) {
		return [
			diagnosticAt(
				assignment ?? file,
				"RYOT_DEFINITION",
				`The default export must be a direct ${SANDBOX_SDK_ROOT_IMPORT} defineScript call`,
			),
		];
	}

	const definition = call.arguments[0];
	if (!definition || !ts.isObjectLiteralExpression(definition)) {
		return [
			diagnosticAt(
				definition ?? call,
				"RYOT_DEFINITION",
				"defineScript must receive a direct object literal",
			),
		];
	}

	let hasManifest = false;
	let drivers: ts.ObjectLiteralExpression | null = null;
	for (const property of definition.properties) {
		if (
			ts.isShorthandPropertyAssignment(property) &&
			ts.isIdentifier(property.name) &&
			property.name.text === "manifest"
		) {
			hasManifest = true;
		} else if (
			ts.isShorthandPropertyAssignment(property) &&
			ts.isIdentifier(property.name) &&
			property.name.text === "drivers"
		) {
			drivers = getTopLevelDriverRecord(file, property.name.text);
		} else if (ts.isPropertyAssignment(property) && propertyName(property.name) === "manifest") {
			hasManifest =
				ts.isIdentifier(property.initializer) && property.initializer.text === "manifest";
		} else if (ts.isPropertyAssignment(property) && propertyName(property.name) === "drivers") {
			if (ts.isObjectLiteralExpression(property.initializer)) {
				drivers = property.initializer;
			} else if (ts.isIdentifier(property.initializer)) {
				drivers = getTopLevelDriverRecord(file, property.initializer.text);
			}
		}
	}
	if (!hasManifest || drivers === null) {
		return [
			diagnosticAt(
				definition,
				"RYOT_DEFINITION",
				'defineScript must contain the exported "manifest" and a static drivers object',
			),
		];
	}

	const diagnostics: SandboxCompilerDiagnostic[] = [];
	for (const property of drivers.properties) {
		let driver: ts.Identifier | null = null;
		if (ts.isShorthandPropertyAssignment(property) && ts.isIdentifier(property.name)) {
			driver = property.name;
		} else if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)) {
			driver = property.initializer;
		}
		if (!driver || !driverNames.has(driver.text)) {
			diagnostics.push(
				diagnosticAt(
					property,
					"RYOT_DEFINITION",
					"Every script driver must be a top-level defineDriver(manifest, ...) const",
				),
			);
		}
	}

	return diagnostics;
};

export const inspectSandboxSource = (file: ts.SourceFile) => {
	const imports = inspectImports(file);
	if (imports.diagnostics.length > 0) {
		return { diagnostics: imports.diagnostics, manifestHelpers: imports.manifestHelpers };
	}

	const drivers = inspectDriverDefinitions(file, imports.driverHelpers);
	if (drivers.diagnostics.length > 0) {
		return { diagnostics: drivers.diagnostics, manifestHelpers: imports.manifestHelpers };
	}

	return {
		manifestHelpers: imports.manifestHelpers,
		diagnostics: inspectScriptDefinition(file, imports.scriptHelpers, drivers.driverNames),
	};
};
