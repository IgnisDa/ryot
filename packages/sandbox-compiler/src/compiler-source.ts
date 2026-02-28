import type { SandboxManifest } from "@ryot/sandbox-sdk/core";
import {
	SANDBOX_SDK_AUTOMATION_IMPORT,
	SANDBOX_SDK_IMPORTS,
	SANDBOX_SDK_PROVIDER_IMPORT,
	SANDBOX_SDK_ROOT_IMPORT,
	SANDBOX_SDK_WORKFLOW_IMPORT,
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

const expressionPath = (expression: ts.Expression): readonly string[] | null => {
	if (ts.isIdentifier(expression)) {
		return [expression.text];
	}
	if (ts.isPropertyAccessExpression(expression)) {
		const parent = expressionPath(expression.expression);
		return parent ? [...parent, expression.name.text] : null;
	}
	if (
		ts.isElementAccessExpression(expression) &&
		ts.isStringLiteralLikeNode(expression.argumentExpression)
	) {
		const parent = expressionPath(expression.expression);
		return parent ? [...parent, expression.argumentExpression.text] : null;
	}
	return null;
};

const ambientPath = (expression: ts.Expression) => {
	const path = expressionPath(expression);
	return path?.[0] === "globalThis" || path?.[0] === "self" || path?.[0] === "window"
		? path.slice(1)
		: path;
};

const nondeterministicGlobal = (expression: ts.Expression) => {
	const path = ambientPath(expression);
	if (!path) {
		return null;
	}
	const blockedPath = [
		["Date", "now"],
		["Math", "random"],
		["crypto", "getRandomValues"],
		["crypto", "randomUUID"],
		["performance", "now"],
		["Temporal", "Now"],
	].find((blocked) => blocked.every((segment, index) => path[index] === segment));
	if (blockedPath) {
		return blockedPath.join(".");
	}
	return null;
};

export const inspectWorkflowDeterminism = (file: ts.SourceFile) => {
	const diagnostics: SandboxCompilerDiagnostic[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node)) {
			const path = ambientPath(node.expression);
			const global = nondeterministicGlobal(node.expression);
			if (path?.join(".") === "Date") {
				diagnostics.push(
					diagnosticAt(
						node,
						"RYOT_WORKFLOW_DETERMINISM",
						"Workflow code cannot call ambient Date()",
					),
				);
				return;
			}
			if (global) {
				diagnostics.push(
					diagnosticAt(
						node,
						"RYOT_WORKFLOW_DETERMINISM",
						`Workflow code cannot use ambient nondeterminism: ${global}`,
					),
				);
				return;
			}
		}
		if (ts.isNewExpression(node)) {
			const path = ambientPath(node.expression);
			if (path?.join(".") === "Date" && (node.arguments?.length ?? 0) === 0) {
				diagnostics.push(
					diagnosticAt(
						node,
						"RYOT_WORKFLOW_DETERMINISM",
						"Workflow code cannot construct an ambient current date with new Date()",
					),
				);
				return;
			}
		}
		if (
			(ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
			!(ts.isCallExpression(node.parent) && node.parent.expression === node)
		) {
			const global = nondeterministicGlobal(node);
			if (global) {
				diagnostics.push(
					diagnosticAt(
						node,
						"RYOT_WORKFLOW_DETERMINISM",
						`Workflow code cannot reference ambient nondeterminism: ${global}`,
					),
				);
				return;
			}
		}
		node.forEachChild(visit);
	};
	visit(file);
	return diagnostics;
};

export const inspectWorkflowImports = (file: ts.SourceFile) => {
	const diagnostics: SandboxCompilerDiagnostic[] = [];
	for (const statement of file.statements) {
		if (
			(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
			getModuleSpecifier(statement) === "@ryot/sandbox-sdk/effect"
		) {
			diagnostics.push(
				diagnosticAt(
					statement.moduleSpecifier ?? statement,
					"RYOT_WORKFLOW_DETERMINISM",
					`Workflow code must import deterministic Effect and Schema exports from ${SANDBOX_SDK_WORKFLOW_IMPORT}`,
				),
			);
		}
	}
	return diagnostics;
};

const inspectImports = (file: ts.SourceFile, allowRelativeImports: boolean) => {
	const scriptHelpers = new Set<string>();
	const providerHelpers = new Set<string>();
	const manifestHelpers = new Set<string>();
	const operationHelpers = new Set<string>();
	const workflowHelpers = new Set<string>();
	const automationHelpers = new Set<string>();
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
					specifier === SANDBOX_SDK_PROVIDER_IMPORT ||
					specifier === SANDBOX_SDK_WORKFLOW_IMPORT ||
					specifier === "@ryot/sandbox-sdk/driver" ||
					specifier === "@ryot/sandbox-sdk/operation")
			) {
				const bindings = statement.importClause?.namedBindings;
				if (bindings && ts.isNamedImports(bindings)) {
					for (const element of bindings.elements) {
						const importedName = (element.propertyName ?? element.name).text;
						if (importedName === "defineDriver" || importedName === "defineProviderDriver") {
							diagnostics.push(
								diagnosticAt(
									element,
									"RYOT_DEFINITION",
									`${importedName} is obsolete; export one direct definition helper call instead`,
								),
							);
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
						if (importedName === "defineWorkflow") {
							workflowHelpers.add(element.name.text);
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
		scriptHelpers,
		manifestHelpers,
		providerHelpers,
		operationHelpers,
		workflowHelpers,
		automationHelpers,
	};
};

const inspectScriptDefinition = (
	file: ts.SourceFile,
	scriptHelpers: ReadonlySet<string>,
	automationHelpers: ReadonlySet<string>,
	providerHelpers: ReadonlySet<string>,
	operationHelpers: ReadonlySet<string>,
	workflowHelpers: ReadonlySet<string>,
) => {
	const defaults = file.statements.filter(
		(statement): statement is ts.ExportAssignment =>
			ts.isExportAssignment(statement) && !statement.isExportEquals,
	);
	if (defaults.length !== 1) {
		return {
			providerOperation: null,
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
	let definitionKind: SandboxManifest["kind"] | null = null;
	if (call && ts.isCallExpression(call) && ts.isIdentifier(call.expression)) {
		if (scriptHelpers.has(call.expression.text)) {
			definitionKind = "script";
		} else if (automationHelpers.has(call.expression.text)) {
			definitionKind = "automation";
		} else if (providerHelpers.has(call.expression.text)) {
			definitionKind = "provider";
		} else if (operationHelpers.has(call.expression.text)) {
			definitionKind = "operation";
		} else if (workflowHelpers.has(call.expression.text)) {
			definitionKind = "workflow";
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
			providerOperation: null,
			definitionKind: null,
			diagnostics: [
				diagnosticAt(
					assignment ?? file,
					"RYOT_DEFINITION",
					"The default export must be a direct automation, operation, script, provider, or workflow definition call",
				),
			],
		};
	}

	const definition = call.arguments[0];
	if (!definition || !ts.isObjectLiteralExpression(definition)) {
		return {
			definitionKind,
			providerOperation: null,
			diagnostics: [
				diagnosticAt(
					definition ?? call,
					"RYOT_DEFINITION",
					"The definition helper must receive a direct object literal",
				),
			],
		};
	}
	let hasManifest = false;
	let hasRun = false;
	let hasInput = false;
	let hasOutput = false;
	let hasDrivers = false;
	let providerOperation: string | null = null;
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
		}
		const name = "name" in property ? propertyName(property.name) : null;
		if (name === "drivers") {
			hasDrivers = true;
		} else if (
			name === "run" &&
			(ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property))
		) {
			hasRun = true;
		} else if (name === "input" && ts.isPropertyAssignment(property)) {
			hasInput = true;
		} else if (name === "output" && ts.isPropertyAssignment(property)) {
			hasOutput = true;
		} else if (
			name === "operation" &&
			ts.isPropertyAssignment(property) &&
			ts.isStringLiteralLikeNode(property.initializer)
		) {
			providerOperation = property.initializer.text;
		}
	}
	if (hasDrivers) {
		return {
			definitionKind,
			providerOperation,
			diagnostics: [
				diagnosticAt(
					definition,
					"RYOT_DEFINITION",
					'The "drivers" object is obsolete; export one direct definition with a run function',
				),
			],
		};
	}
	const requiresSchemas =
		definitionKind === "script" || definitionKind === "operation" || definitionKind === "workflow";
	const validProviderOperation =
		definitionKind !== "provider" ||
		providerOperation === "details" ||
		providerOperation === "search" ||
		providerOperation === "resolve" ||
		providerOperation === "translate";
	return {
		definitionKind,
		providerOperation,
		diagnostics:
			hasManifest &&
			hasRun &&
			(!requiresSchemas || (hasInput && hasOutput)) &&
			validProviderOperation
				? []
				: [
						diagnosticAt(
							definition,
							"RYOT_DEFINITION",
							definitionKind === "provider"
								? 'The provider definition must contain the exported "manifest", a static standard operation, and a run function'
								: `The ${definitionKind} definition must contain the exported "manifest"${requiresSchemas ? ", input and output schemas," : ""} and a run function`,
						),
					],
	};
};

export const inspectSandboxModuleImports = (file: ts.SourceFile) =>
	inspectImports(file, true).diagnostics;

export const sandboxDefinitionMismatch = (
	inspection: {
		readonly definitionKind: SandboxManifest["kind"] | null;
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
	} else if (manifest.kind === "workflow") {
		helper = "defineWorkflow";
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
			providerOperation: null,
			definitionKind: null,
			diagnostics: imports.diagnostics,
			manifestHelpers: imports.manifestHelpers,
		};
	}

	const definition = inspectScriptDefinition(
		file,
		imports.scriptHelpers,
		imports.automationHelpers,
		imports.providerHelpers,
		imports.operationHelpers,
		imports.workflowHelpers,
	);
	return { ...definition, manifestHelpers: imports.manifestHelpers };
};
