import {
	SandboxCompilationFailure,
	type SandboxCompilationDiagnostic,
} from "@ryot/contract/modules/sandbox/schemas";
import * as ts from "typescript/unstable/ast";

import { SANDBOX_SDK_ROOT_IMPORT } from "#lib/infrastructure/sandbox-runtime/dependencies";
import { SANDBOX_LIMITS, utf8ByteLength } from "#lib/infrastructure/sandbox-runtime/limits";

const segmenter = new Intl.Segmenter();
export const SANDBOX_SOURCE_FILE = "script.ts";
export const SANDBOX_SDK_IMPORT = SANDBOX_SDK_ROOT_IMPORT;
const compilationFailedMessage = "Sandbox TypeScript compilation failed";

const diagnosticBytes = (diagnostic: SandboxCompilationDiagnostic) =>
	utf8ByteLength(JSON.stringify(diagnostic));

const fitDiagnostic = (diagnostic: SandboxCompilationDiagnostic, maximumBytes: number) => {
	if (diagnosticBytes(diagnostic) <= maximumBytes) {
		return diagnostic;
	}

	const characters = Array.from(segmenter.segment(diagnostic.message), ({ segment }) => segment);
	let low = 0;
	let high = characters.length;
	let fitted: SandboxCompilationDiagnostic | null = null;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const candidate = { ...diagnostic, message: characters.slice(0, middle).join("") };
		if (diagnosticBytes(candidate) <= maximumBytes) {
			fitted = candidate;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return fitted;
};

export const limitSandboxCompilationDiagnostics = (
	diagnostics: readonly SandboxCompilationDiagnostic[],
) => {
	const bounded: SandboxCompilationDiagnostic[] = [];
	let bytes = 2;
	for (const diagnostic of diagnostics) {
		if (bounded.length >= SANDBOX_LIMITS.compiler.diagnosticCount) {
			break;
		}

		const separatorBytes = bounded.length === 0 ? 0 : 1;
		const availableBytes = SANDBOX_LIMITS.compiler.diagnosticBytes - bytes - separatorBytes;
		const fitted = fitDiagnostic(diagnostic, availableBytes);
		if (!fitted) {
			break;
		}
		bounded.push(fitted);
		bytes += separatorBytes + diagnosticBytes(fitted);
	}
	return bounded;
};

export const sandboxCompilerDiagnostic = (
	code: string,
	message: string,
): SandboxCompilationDiagnostic => ({
	code,
	message,
	line: 1,
	column: 1,
	severity: "error",
	file: SANDBOX_SOURCE_FILE,
});

export const sandboxCompilationFailure = (diagnostics: readonly SandboxCompilationDiagnostic[]) =>
	new SandboxCompilationFailure({
		message: compilationFailedMessage,
		diagnostics: limitSandboxCompilationDiagnostics(diagnostics),
	});

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
