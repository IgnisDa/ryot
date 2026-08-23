import { parseSync } from "@babel/core";

import { clientPluginCompilerDiagnostic, type ClientPluginCompilerDiagnostic } from "./diagnostics";
import { clientImportPolicyIssue, type ClientImportPolicySources } from "./import-policy";

type SourcePosition = { readonly line: number; readonly column: number };
type ImportReference = SourcePosition & { readonly specifier?: string };

const nodeType = (value: object) =>
	"type" in value && typeof value.type === "string" ? value.type : undefined;

const sourcePosition = (value: object): SourcePosition => {
	const location = "loc" in value ? value.loc : undefined;
	const start =
		typeof location === "object" && location !== null && "start" in location
			? location.start
			: undefined;
	return {
		line:
			typeof start === "object" &&
			start !== null &&
			"line" in start &&
			typeof start.line === "number"
				? start.line
				: 1,
		column:
			typeof start === "object" &&
			start !== null &&
			"column" in start &&
			typeof start.column === "number"
				? start.column + 1
				: 1,
	};
};

const stringLiteral = (value: unknown) => {
	if (
		typeof value === "object" &&
		value !== null &&
		nodeType(value) === "StringLiteral" &&
		"value" in value &&
		typeof value.value === "string"
	) {
		return { specifier: value.value, ...sourcePosition(value) };
	}
	return undefined;
};

const collectImportReferences = (root: unknown) => {
	const references: ImportReference[] = [];
	const visit = (value: unknown) => {
		if (Array.isArray(value)) {
			value.forEach(visit);
			return;
		}
		if (typeof value !== "object" || value === null) {
			return;
		}
		const type = nodeType(value);
		if (
			type === "ImportDeclaration" ||
			type === "ExportNamedDeclaration" ||
			type === "ExportAllDeclaration"
		) {
			if ("source" in value) {
				const reference = stringLiteral(value.source);
				if (reference !== undefined) {
					references.push(reference);
				}
			}
		} else if (type === "ImportExpression") {
			const reference = "source" in value ? stringLiteral(value.source) : undefined;
			references.push(reference ?? sourcePosition(value));
		} else if (type === "TSImportEqualsDeclaration" && "moduleReference" in value) {
			const moduleReference = value.moduleReference;
			const expression =
				typeof moduleReference === "object" &&
				moduleReference !== null &&
				"expression" in moduleReference
					? moduleReference.expression
					: undefined;
			const reference = stringLiteral(expression);
			if (reference !== undefined) {
				references.push(reference);
			}
		} else if (type === "CallExpression" && "callee" in value) {
			const callee = value.callee;
			if (typeof callee === "object" && callee !== null && nodeType(callee) === "Import") {
				const firstArgument =
					"arguments" in value && Array.isArray(value.arguments) ? value.arguments[0] : undefined;
				references.push(stringLiteral(firstArgument) ?? sourcePosition(callee));
			}
		}
		for (const [key, child] of Object.entries(value)) {
			if (key !== "loc" && key !== "start" && key !== "end") {
				visit(child);
			}
		}
	};
	visit(root);
	return references;
};

const parseErrorDiagnostic = (path: string, error: unknown) => {
	const line =
		error instanceof Error &&
		"loc" in error &&
		typeof error.loc === "object" &&
		error.loc !== null &&
		"line" in error.loc &&
		typeof error.loc.line === "number"
			? error.loc.line
			: 1;
	const column =
		error instanceof Error &&
		"loc" in error &&
		typeof error.loc === "object" &&
		error.loc !== null &&
		"column" in error.loc &&
		typeof error.loc.column === "number"
			? error.loc.column + 1
			: 1;
	return {
		...clientPluginCompilerDiagnostic(
			"RYOT_CLIENT_IMPORT",
			path,
			`Client imports could not be validated: ${error instanceof Error ? error.message : String(error)}`,
		),
		line,
		column,
	};
};

export const validateOriginalClientImports = (sources: ClientImportPolicySources) => {
	const diagnostics: ClientPluginCompilerDiagnostic[] = [];
	for (const [path, source] of Object.entries(sources.files)) {
		if (!/\.tsx?$/.test(path)) {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = parseSync(source, {
				babelrc: false,
				filename: path,
				configFile: false,
				parserOpts: {
					sourceType: "module",
					plugins: [
						["typescript", { dts: path.endsWith(".d.ts") }],
						...(path.endsWith(".tsx") ? (["jsx"] as const) : []),
					],
				},
			});
		} catch (error) {
			diagnostics.push(parseErrorDiagnostic(path, error));
			continue;
		}
		for (const reference of collectImportReferences(parsed)) {
			const message =
				reference.specifier === undefined
					? "Dynamic client imports must use a string literal"
					: clientImportPolicyIssue(sources, path, reference.specifier);
			if (message !== null) {
				diagnostics.push({
					...clientPluginCompilerDiagnostic("RYOT_CLIENT_IMPORT", path, message),
					line: reference.line,
					column: reference.column,
				});
			}
		}
	}
	return diagnostics;
};
