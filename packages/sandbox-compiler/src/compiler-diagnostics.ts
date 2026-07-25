import { Schema } from "effect";
import * as ts from "typescript/unstable/ast";
import { DiagnosticCategory, type Diagnostic } from "typescript/unstable/async";

import { SANDBOX_COMPILER_LIMITS, utf8ByteLength } from "./limits";

const segmenter = new Intl.Segmenter();
export const SANDBOX_SOURCE_FILE = "script.ts";
const sandboxVirtualRoot = "/__ryot_sandbox__/";
const compilationFailedMessage = "Sandbox TypeScript compilation failed";

export const sandboxLogicalFile = (fileName: string) =>
	fileName.startsWith(sandboxVirtualRoot) ? fileName.slice(sandboxVirtualRoot.length) : fileName;

export const SandboxCompilerDiagnostic = Schema.Struct({
	code: Schema.String,
	file: Schema.String,
	line: Schema.Number,
	column: Schema.Number,
	message: Schema.String,
	length: Schema.optional(Schema.Number),
	severity: Schema.Literals(["error", "warning", "info"]),
});

export type SandboxCompilerDiagnostic = Schema.Schema.Type<typeof SandboxCompilerDiagnostic>;

export class SandboxCompilerFailure extends Schema.TaggedError<SandboxCompilerFailure>()(
	"SandboxCompilerFailure",
	{ message: Schema.String, diagnostics: Schema.Array(SandboxCompilerDiagnostic) },
) {}

const diagnosticBytes = (diagnostic: SandboxCompilerDiagnostic) =>
	utf8ByteLength(JSON.stringify(diagnostic));

const fitDiagnostic = (diagnostic: SandboxCompilerDiagnostic, maximumBytes: number) => {
	if (diagnosticBytes(diagnostic) <= maximumBytes) {
		return diagnostic;
	}

	const characters = Array.from(segmenter.segment(diagnostic.message), ({ segment }) => segment);
	let low = 0;
	let high = characters.length;
	let fitted: SandboxCompilerDiagnostic | null = null;
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
	diagnostics: readonly SandboxCompilerDiagnostic[],
) => {
	const bounded: SandboxCompilerDiagnostic[] = [];
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

export const sandboxCompilerDiagnostic = (
	code: string,
	message: string,
): SandboxCompilerDiagnostic => ({
	code,
	message,
	line: 1,
	column: 1,
	severity: "error",
	file: SANDBOX_SOURCE_FILE,
});

export const sandboxCompilationFailure = (diagnostics: readonly SandboxCompilerDiagnostic[]) =>
	new SandboxCompilerFailure({
		message: compilationFailedMessage,
		diagnostics: limitSandboxCompilationDiagnostics(diagnostics),
	});

const diagnosticSeverity = (category: DiagnosticCategory) => {
	if (category === DiagnosticCategory.Warning) {
		return "warning" as const;
	}
	if (category === DiagnosticCategory.Message || category === DiagnosticCategory.Suggestion) {
		return "info" as const;
	}
	return "error" as const;
};

const diagnosticMessage = (diagnostic: Diagnostic): string =>
	[diagnostic.text, ...(diagnostic.messageChain ?? []).map(diagnosticMessage)].join("\n");

export const toTypeScriptDiagnostic = (
	diagnostic: Diagnostic,
	files: readonly ts.SourceFile[],
	entry: ts.SourceFile,
): SandboxCompilerDiagnostic => {
	const file = files.find((sourceFile) => sourceFile.fileName === diagnostic.fileName) ?? entry;
	const start = Math.max(0, diagnostic.pos);
	const location = diagnostic.fileName ? file.getLineAndCharacterOfPosition(start) : undefined;

	return {
		code: `TS${diagnostic.code}`,
		line: (location?.line ?? 0) + 1,
		column: (location?.character ?? 0) + 1,
		message: diagnosticMessage(diagnostic),
		severity: diagnosticSeverity(diagnostic.category),
		file: sandboxLogicalFile(diagnostic.fileName ?? entry.fileName),
		...(diagnostic.end > diagnostic.pos ? { length: diagnostic.end - diagnostic.pos } : {}),
	};
};

export const sandboxDiagnosticAt = (
	node: ts.Node,
	code: string,
	message: string,
): SandboxCompilerDiagnostic => {
	const file = node.getSourceFile();
	const start = node.getStart(file);
	const location = file.getLineAndCharacterOfPosition(start);

	return {
		code,
		message,
		severity: "error",
		line: location.line + 1,
		column: location.character + 1,
		length: node.getWidth(file),
		file: sandboxLogicalFile(file.fileName),
	};
};

export const sandboxPropertyName = (name: ts.PropertyName) => {
	if (ts.isIdentifier(name) || ts.isStringLiteralLikeNode(name) || ts.isNumericLiteral(name)) {
		return name.text;
	}
	return null;
};
