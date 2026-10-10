import {
	normalizeTypeScriptDiagnostic,
	TypeScriptCompilerDiagnostic,
} from "@ryot-app/typescript-compiler";
import { Schema } from "effect";
import * as ts from "typescript/unstable/ast";
import type { Diagnostic } from "typescript/unstable/async";

import { SANDBOX_COMPILER_LIMITS, utf8ByteLength } from "./limits";

const segmenter = new Intl.Segmenter();
export const SANDBOX_SOURCE_FILE = "script.ts";
const sandboxVirtualRoot = "/__ryot_sandbox__/";
const compilationFailedMessage = "Sandbox TypeScript compilation failed";

export const sandboxLogicalFile = (fileName: string) =>
	fileName.startsWith(sandboxVirtualRoot) ? fileName.slice(sandboxVirtualRoot.length) : fileName;

export const PluginBackendCompilerDiagnostic = TypeScriptCompilerDiagnostic;

export type PluginBackendCompilerDiagnostic = Schema.Schema.Type<
	typeof PluginBackendCompilerDiagnostic
>;

export class PluginBackendCompilerFailure extends Schema.TaggedError<PluginBackendCompilerFailure>()(
	"PluginBackendCompilerFailure",
	{ message: Schema.String, diagnostics: Schema.Array(PluginBackendCompilerDiagnostic) },
) {}

const diagnosticBytes = (diagnostic: PluginBackendCompilerDiagnostic) =>
	utf8ByteLength(JSON.stringify(diagnostic));

const fitDiagnostic = (diagnostic: PluginBackendCompilerDiagnostic, maximumBytes: number) => {
	if (diagnosticBytes(diagnostic) <= maximumBytes) {
		return diagnostic;
	}

	const characters = Array.from(segmenter.segment(diagnostic.message), ({ segment }) => segment);
	let low = 0;
	let high = characters.length;
	let fitted: PluginBackendCompilerDiagnostic | null = null;
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
	diagnostics: readonly PluginBackendCompilerDiagnostic[],
) => {
	const bounded: PluginBackendCompilerDiagnostic[] = [];
	let bytes = 2;
	for (const diagnostic of diagnostics) {
		if (bounded.length >= SANDBOX_COMPILER_LIMITS.diagnosticCount) {
			break;
		}

		const separatorBytes = bounded.length === 0 ? 0 : 1;
		const availableBytes = SANDBOX_COMPILER_LIMITS.diagnosticBytes - bytes - separatorBytes;
		const fitted = fitDiagnostic(diagnostic, availableBytes);
		if (!fitted) {
			break;
		}
		bounded.push(fitted);
		bytes += separatorBytes + diagnosticBytes(fitted);
	}
	return bounded;
};

export const pluginBackendCompilerDiagnostic = (
	code: string,
	message: string,
): PluginBackendCompilerDiagnostic => ({
	code,
	message,
	line: 1,
	column: 1,
	severity: "error",
	file: SANDBOX_SOURCE_FILE,
});

export const sandboxCompilationFailure = (
	diagnostics: readonly PluginBackendCompilerDiagnostic[],
) =>
	new PluginBackendCompilerFailure({
		message: compilationFailedMessage,
		diagnostics: limitSandboxCompilationDiagnostics(diagnostics),
	});

export const toTypeScriptDiagnostic = (
	diagnostic: Diagnostic,
	files: readonly ts.SourceFile[],
	entry: ts.SourceFile,
): PluginBackendCompilerDiagnostic =>
	normalizeTypeScriptDiagnostic(diagnostic, files, entry, sandboxLogicalFile);

export const sandboxDiagnosticAt = (
	node: ts.Node,
	code: string,
	message: string,
): PluginBackendCompilerDiagnostic => {
	const file = node.getSourceFile();
	const start = node.getStart(file);
	const location = file.getLineAndCharacterOfPosition(start);

	return {
		code,
		message,
		severity: "error",
		line: location.line + 1,
		length: node.getWidth(file),
		column: location.character + 1,
		file: sandboxLogicalFile(file.fileName),
	};
};

export const sandboxPropertyName = (name: ts.PropertyName) => {
	if (ts.isIdentifier(name) || ts.isStringLiteralLikeNode(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return null;
};
