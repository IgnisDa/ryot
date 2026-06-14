import type { SandboxCompilationDiagnostic } from "@ryot/contract/modules/sandbox/schemas";
import * as ts from "typescript/unstable/ast";

export const SANDBOX_SOURCE_FILE = "script.ts";
export const SANDBOX_SDK_IMPORT = "@ryot/sandbox-sdk";

export const sandboxDiagnosticAt = (
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
		severity: "error",
		line: location.line + 1,
		file: SANDBOX_SOURCE_FILE,
		column: location.character + 1,
		length: node.getWidth(file),
	};
};

export const sandboxPropertyName = (name: ts.PropertyName) => {
	if (ts.isIdentifier(name) || ts.isStringLiteralLikeNode(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return null;
};
