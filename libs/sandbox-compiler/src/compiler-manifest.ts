import { sandboxManifestSchema } from "@ryot/sandbox-sdk/core";
import { SANDBOX_SDK_ROOT_IMPORT } from "@ryot/sandbox-sdk/imports";
import * as ts from "typescript/unstable/ast";

import {
	type SandboxCompilerDiagnostic,
	sandboxDiagnosticAt as diagnosticAt,
	sandboxPropertyName as propertyName,
} from "./compiler-diagnostics";

type LiteralResult =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly diagnostic: SandboxCompilerDiagnostic };

const readLiteral = (rawExpression: ts.Expression): LiteralResult => {
	if (ts.isAssertionExpression(rawExpression)) {
		return {
			ok: false,
			diagnostic: diagnosticAt(
				rawExpression,
				"RYOT_MANIFEST",
				"Manifest type assertions are not allowed",
			),
		};
	}
	if (ts.isParenthesizedExpression(rawExpression) || ts.isSatisfiesExpression(rawExpression)) {
		return readLiteral(rawExpression.expression);
	}
	const expression = rawExpression;
	if (ts.isStringLiteralLikeNode(expression)) {
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

export const extractSandboxManifest = (
	file: ts.SourceFile,
	manifestHelpers: ReadonlySet<string>,
) => {
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
	if (declaration.type) {
		return {
			diagnostic: diagnosticAt(
				declaration.type,
				"RYOT_MANIFEST",
				"The exported manifest must not have an explicit type annotation",
			),
		};
	}
	const initializer = declaration.initializer;
	if (
		!initializer ||
		!ts.isCallExpression(initializer) ||
		!ts.isIdentifier(initializer.expression) ||
		!manifestHelpers.has(initializer.expression.text) ||
		initializer.typeArguments?.length ||
		initializer.arguments.length !== 1
	) {
		return {
			diagnostic: diagnosticAt(
				declaration,
				"RYOT_MANIFEST",
				`The exported manifest must be a direct ${SANDBOX_SDK_ROOT_IMPORT} defineManifest call`,
			),
		};
	}

	const argument = initializer.arguments[0];
	if (!argument) {
		return { diagnostic: diagnosticAt(initializer, "RYOT_MANIFEST", "Manifest is required") };
	}
	if (!ts.isObjectLiteralExpression(argument)) {
		return {
			diagnostic: diagnosticAt(
				argument,
				"RYOT_MANIFEST",
				"The exported manifest argument must be a direct object literal",
			),
		};
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
	return { manifest: parsed.data };
};
