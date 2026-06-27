import type { SandboxManifest } from "@ryot/sandbox-sdk/core";
import {
	SANDBOX_SDK_AUTOMATION_IMPORT,
	SANDBOX_SDK_IMPORTS,
	SANDBOX_SDK_PROVIDER_IMPORT,
	SANDBOX_SDK_ROOT_IMPORT,
} from "@ryot/sandbox-sdk/imports";
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

const inspectImports = (file: ts.SourceFile, allowRelativeImports: boolean) => {
	const scriptHelpers = new Set<string>();
	const providerHelpers = new Set<string>();
	const manifestHelpers = new Set<string>();
	const operationHelpers = new Set<string>();
	const automationHelpers = new Set<string>();
	const diagnostics: SandboxCompilerDiagnostic[] = [];
	const driverHelpers = new Map<string, "generic" | "provider">();

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
			const isAllowedRelativeImport = allowRelativeImports && specifier?.startsWith(".");
			if (specifier !== null && !allowedImports.has(specifier) && !isAllowedRelativeImport) {
				diagnostics.push(
					diagnosticAt(
						statement.moduleSpecifier ?? statement,
						"RYOT_IMPORT",
						`Import "${specifier}" is not allowed; use an approved ${SANDBOX_SDK_ROOT_IMPORT} entry point`,
					),
				);
			}

			if (
				ts.isImportDeclaration(statement) &&
				(specifier === SANDBOX_SDK_ROOT_IMPORT ||
					specifier === SANDBOX_SDK_AUTOMATION_IMPORT ||
					specifier === SANDBOX_SDK_PROVIDER_IMPORT)
			) {
				const bindings = statement.importClause?.namedBindings;
				if (bindings && ts.isNamedImports(bindings)) {
					for (const element of bindings.elements) {
						const importedName = (element.propertyName ?? element.name).text;
						if (importedName === "defineDriver") {
							driverHelpers.set(element.name.text, "generic");
						}
						if (importedName === "defineProviderDriver") {
							driverHelpers.set(element.name.text, "provider");
						}
						if (importedName === "defineManifest") {
							manifestHelpers.add(element.name.text);
						}
						if (importedName === "defineScript") {
							scriptHelpers.add(element.name.text);
						}
						if (importedName === "defineAutomation" || importedName === "defineAutomationPolicy") {
							automationHelpers.add(element.name.text);
						}
						if (importedName === "defineProvider") {
							providerHelpers.add(element.name.text);
						}
						if (importedName === "defineOperation") {
							operationHelpers.add(element.name.text);
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

	return {
		diagnostics,
		driverHelpers,
		scriptHelpers,
		manifestHelpers,
		providerHelpers,
		operationHelpers,
		automationHelpers,
	};
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

type DriverDefinition =
	| { readonly kind: "generic" }
	| { readonly kind: "provider"; readonly providerName: string };

const providerDriverNames = new Set(["search", "details", "resolve", "translate"]);

const inspectDriverDefinitions = (
	file: ts.SourceFile,
	driverHelpers: ReadonlyMap<string, "generic" | "provider">,
) => {
	const diagnostics: SandboxCompilerDiagnostic[] = [];
	const driverDefinitions = new Map<string, DriverDefinition>();
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
			const helperKind = driverHelpers.get(node.expression.text);
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
				} else if (helperKind === "provider") {
					const providerName = node.arguments[1];
					if (
						node.arguments.length !== 3 ||
						!providerName ||
						!ts.isStringLiteralLikeNode(providerName) ||
						!providerDriverNames.has(providerName.text)
					) {
						diagnostics.push(
							diagnosticAt(
								providerName ?? node,
								"RYOT_DEFINITION",
								"defineProviderDriver must receive a static standard provider driver name",
							),
						);
					} else {
						driverDefinitions.set(driverName, {
							kind: "provider",
							providerName: providerName.text,
						});
					}
				} else if (node.arguments.length !== 2) {
					diagnostics.push(
						diagnosticAt(
							node,
							"RYOT_DEFINITION",
							"defineDriver must receive a manifest and driver definition",
						),
					);
				} else {
					driverDefinitions.set(driverName, { kind: "generic" });
				}
			}
		}
		node.forEachChild(visit);
	};
	visit(file);

	return { diagnostics, driverDefinitions };
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
	automationHelpers: ReadonlySet<string>,
	providerHelpers: ReadonlySet<string>,
	operationHelpers: ReadonlySet<string>,
	driverDefinitions: ReadonlyMap<string, DriverDefinition>,
) => {
	const defaults = file.statements.filter(
		(statement): statement is ts.ExportAssignment =>
			ts.isExportAssignment(statement) && !statement.isExportEquals,
	);
	if (defaults.length !== 1) {
		return {
			driverNames: [],
			definitionKind: null,
			diagnostics: [
				diagnosticAt(
					file,
					"RYOT_DEFINITION",
					"Source must have exactly one default definition export",
				),
			],
		};
	}

	const assignment = defaults[0];
	const call = assignment?.expression;
	let definitionKind: "automation" | "operation" | "provider" | "script" | null = null;
	if (call && ts.isCallExpression(call) && ts.isIdentifier(call.expression)) {
		if (scriptHelpers.has(call.expression.text)) {
			definitionKind = "script";
		} else if (automationHelpers.has(call.expression.text)) {
			definitionKind = "automation";
		} else if (providerHelpers.has(call.expression.text)) {
			definitionKind = "provider";
		} else if (operationHelpers.has(call.expression.text)) {
			definitionKind = "operation";
		}
	}
	if (
		!call ||
		!ts.isCallExpression(call) ||
		!ts.isIdentifier(call.expression) ||
		definitionKind === null ||
		call.typeArguments?.length ||
		call.arguments.length !== 1
	) {
		return {
			driverNames: [],
			definitionKind: null,
			diagnostics: [
				diagnosticAt(
					assignment ?? file,
					"RYOT_DEFINITION",
					"The default export must be a direct automation, operation, script, or provider definition call",
				),
			],
		};
	}

	const definition = call.arguments[0];
	if (!definition || !ts.isObjectLiteralExpression(definition)) {
		return {
			definitionKind,
			driverNames: [],
			diagnostics: [
				diagnosticAt(
					definition ?? call,
					"RYOT_DEFINITION",
					"The definition helper must receive a direct object literal",
				),
			],
		};
	}
	if (definitionKind === "automation") {
		let hasManifest = false;
		let hasRun = false;
		for (const property of definition.properties) {
			if (
				ts.isShorthandPropertyAssignment(property) &&
				ts.isIdentifier(property.name) &&
				property.name.text === "manifest"
			) {
				hasManifest = true;
			} else if (ts.isPropertyAssignment(property) && propertyName(property.name) === "manifest") {
				hasManifest =
					ts.isIdentifier(property.initializer) && property.initializer.text === "manifest";
			} else if (
				(ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property)) &&
				propertyName(property.name) === "run"
			) {
				hasRun = true;
			}
		}
		return {
			definitionKind,
			driverNames: ["automation"],
			diagnostics:
				hasManifest && hasRun
					? []
					: [
							diagnosticAt(
								definition,
								"RYOT_DEFINITION",
								`The ${definitionKind} definition must contain the exported "manifest" and a run function`,
							),
						],
		};
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
		return {
			definitionKind,
			driverNames: [],
			diagnostics: [
				diagnosticAt(
					definition,
					"RYOT_DEFINITION",
					'The definition must contain the exported "manifest" and a static drivers object',
				),
			],
		};
	}

	const diagnostics: SandboxCompilerDiagnostic[] = [];
	const driverNames: string[] = [];
	for (const property of drivers.properties) {
		let driver: ts.Identifier | null = null;
		let exposedName: string | null = null;
		if (ts.isShorthandPropertyAssignment(property) && ts.isIdentifier(property.name)) {
			driver = property.name;
			exposedName = property.name.text;
		} else if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)) {
			driver = property.initializer;
			exposedName = propertyName(property.name);
		}
		const driverDefinition = driver ? driverDefinitions.get(driver.text) : undefined;
		if (!driver || !exposedName || !driverDefinition) {
			diagnostics.push(
				diagnosticAt(
					property,
					"RYOT_DEFINITION",
					"Every script driver must be a top-level defineDriver(manifest, ...) const",
				),
			);
			continue;
		}
		driverNames.push(exposedName);
		if (
			(definitionKind === "script" || definitionKind === "operation") &&
			driverDefinition.kind !== "generic"
		) {
			diagnostics.push(
				diagnosticAt(
					property,
					"RYOT_DEFINITION",
					"Generic scripts and operations must use defineDriver",
				),
			);
			continue;
		}
		if (
			definitionKind === "provider" &&
			providerDriverNames.has(exposedName) &&
			(driverDefinition.kind !== "provider" || driverDefinition.providerName !== exposedName)
		) {
			diagnostics.push(
				diagnosticAt(
					property,
					"RYOT_DEFINITION",
					`Provider driver "${exposedName}" must use defineProviderDriver(manifest, "${exposedName}", ...)`,
				),
			);
			continue;
		}
		if (driverDefinition.kind === "provider" && driverDefinition.providerName !== exposedName) {
			diagnostics.push(
				diagnosticAt(
					property,
					"RYOT_DEFINITION",
					`Provider driver "${driverDefinition.providerName}" must use the same drivers object key`,
				),
			);
		}
	}

	return { definitionKind, diagnostics, driverNames };
};

export const inspectSandboxModuleImports = (file: ts.SourceFile) =>
	inspectImports(file, true).diagnostics;

export const sandboxDefinitionMismatch = (
	inspection: {
		readonly definitionKind: "automation" | "operation" | "provider" | "script" | null;
	},
	manifest: SandboxManifest,
) => {
	let helper = "defineScript";
	if (manifest.kind === "provider") {
		helper = "defineProvider";
	} else if (manifest.kind === "automation") {
		helper = "defineAutomation";
	} else if (manifest.kind === "operation") {
		helper = "defineOperation";
	}
	if (inspection.definitionKind !== manifest.kind) {
		return `Manifest kind "${manifest.kind}" must use ${helper}`;
	}
	return null;
};

export const inspectSandboxSource = (
	file: ts.SourceFile,
	options: { readonly allowRelativeImports?: boolean } = {},
) => {
	const imports = inspectImports(file, options.allowRelativeImports ?? false);
	if (imports.diagnostics.length > 0) {
		return {
			driverNames: [],
			definitionKind: null,
			diagnostics: imports.diagnostics,
			manifestHelpers: imports.manifestHelpers,
		};
	}

	const drivers = inspectDriverDefinitions(file, imports.driverHelpers);
	if (drivers.diagnostics.length > 0) {
		return {
			driverNames: [],
			definitionKind: null,
			diagnostics: drivers.diagnostics,
			manifestHelpers: imports.manifestHelpers,
		};
	}

	const definition = inspectScriptDefinition(
		file,
		imports.scriptHelpers,
		imports.automationHelpers,
		imports.providerHelpers,
		imports.operationHelpers,
		drivers.driverDefinitions,
	);
	return { ...definition, manifestHelpers: imports.manifestHelpers };
};
