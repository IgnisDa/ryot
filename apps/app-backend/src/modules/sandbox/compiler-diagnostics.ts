import type { SandboxCompilationDiagnostic } from "@ryot/contract/modules/sandbox/schemas";
import * as ts from "typescript/unstable/ast";

import { SANDBOX_SDK_ROOT_IMPORT } from "#lib/infrastructure/sandbox-runtime/dependencies";

export const SANDBOX_SOURCE_FILE = "script.ts";
export const SANDBOX_SDK_IMPORT = SANDBOX_SDK_ROOT_IMPORT;

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
