import type { SandboxSourceExecutionMetadata } from "@ryot-app/contract/modules/plugins/execution-metadata";
import type { SandboxManifest } from "@ryot-app/plugin-backend-sdk/core";
import { Effect } from "effect";
import * as ts from "typescript/unstable/ast";

import type { SandboxEntryDeclaration } from "./compiler-builtins";
import {
	type PluginBackendCompilerDiagnostic,
	pluginBackendCompilerDiagnostic,
	type PluginBackendCompilerFailure,
	sandboxCompilationFailure,
} from "./compiler-diagnostics";
import { extractSandboxManifest } from "./compiler-manifest";
import { validateSandboxCapabilities } from "./compiler-metadata";
import type { createTypeScriptSourcesProjectForEntries } from "./compiler-project";
import {
	type inspectSandboxSource,
	inspectWorkflowDeterminism,
	inspectWorkflowImports,
	sandboxDefinitionMismatch,
} from "./compiler-source";

export type InspectedSandboxEntry = {
	readonly entry: string;
	readonly source: string;
	readonly sourceFile: ts.SourceFile;
	readonly inspection: ReturnType<typeof inspectSandboxSource>;
};

export type ValidatedSandboxEntry = InspectedSandboxEntry & {
	readonly manifest: SandboxManifest;
	readonly metadata: SandboxSourceExecutionMetadata;
};

type ValidateSandboxEntryInput = {
	readonly inspected: InspectedSandboxEntry;
	readonly execution:
		| Effect.Success<
				ReturnType<typeof createTypeScriptSourcesProjectForEntries>
		  >["executionByEntry"][string]
		| undefined;
	readonly sourceFiles: readonly ts.SourceFile[];
	readonly moduleDiagnostics?: readonly PluginBackendCompilerDiagnostic[];
	readonly declaration?: SandboxEntryDeclaration;
	readonly validateTypes?: Effect.Effect<void, PluginBackendCompilerFailure>;
};

const relativeModulePath = (sourceFile: ts.SourceFile, specifier: string) => {
	const segments = sourceFile.fileName.split("/").slice(0, -1);
	for (const segment of specifier.split("/")) {
		if (segment === "..") {
			segments.pop();
		} else if (segment !== ".") {
			segments.push(segment);
		}
	}
	return segments.join("/");
};

const workflowSourceFiles = (entry: ts.SourceFile, sourceFiles: ReadonlyArray<ts.SourceFile>) => {
	const byName = new Map(sourceFiles.map((file) => [file.fileName, file]));
	const visited = new Set<string>();
	const reachable: ts.SourceFile[] = [];
	const visit = (file: ts.SourceFile) => {
		if (visited.has(file.fileName)) {
			return;
		}
		visited.add(file.fileName);
		reachable.push(file);
		for (const statement of file.statements) {
			if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) {
				continue;
			}
			const moduleSpecifier = statement.moduleSpecifier;
			if (!moduleSpecifier || !ts.isStringLiteralLikeNode(moduleSpecifier)) {
				continue;
			}
			const specifier = moduleSpecifier.text;
			if (!specifier.startsWith(".")) {
				continue;
			}
			const path = relativeModulePath(file, specifier);
			const dependency =
				byName.get(path) ??
				byName.get(`${path}.ts`) ??
				byName.get(path.replace(/\.js$/, ".ts")) ??
				byName.get(`${path}/index.ts`);
			if (dependency) {
				visit(dependency);
			}
		}
	};
	visit(entry);
	return reachable;
};

export const validateSandboxEntry = Effect.fn("validateSandboxEntry")(function* ({
	inspected,
	execution,
	sourceFiles,
	declaration,
	validateTypes,
	moduleDiagnostics,
}: ValidateSandboxEntryInput) {
	if (!execution) {
		return yield* sandboxCompilationFailure([
			pluginBackendCompilerDiagnostic("RYOT_DEPENDENCY", "Executable analysis is missing"),
		]);
	}
	if (execution.diagnostics.length > 0) {
		return yield* sandboxCompilationFailure(execution.diagnostics);
	}
	if (inspected.inspection.diagnostics.length > 0) {
		return yield* sandboxCompilationFailure(inspected.inspection.diagnostics);
	}
	yield* validateTypes ?? Effect.void;
	if (moduleDiagnostics && moduleDiagnostics.length > 0) {
		return yield* sandboxCompilationFailure(moduleDiagnostics);
	}

	const { sourceFile, inspection } = inspected;
	const extracted = extractSandboxManifest(sourceFile, inspection.manifestHelpers);
	if (extracted.diagnostic) {
		return yield* sandboxCompilationFailure([extracted.diagnostic]);
	}
	const definitionMismatch = sandboxDefinitionMismatch(inspection, extracted.manifest);
	if (definitionMismatch) {
		return yield* sandboxCompilationFailure([
			pluginBackendCompilerDiagnostic("RYOT_DEFINITION", definitionMismatch),
		]);
	}
	if (extracted.manifest.kind === "workflow") {
		const diagnostics = workflowSourceFiles(sourceFile, sourceFiles).flatMap((file) =>
			inspectWorkflowImports(file).concat(inspectWorkflowDeterminism(file)),
		);
		if (diagnostics.length > 0) {
			return yield* sandboxCompilationFailure(diagnostics);
		}
	}
	if (declaration && inspection.definitionKind !== declaration.kind) {
		return yield* sandboxCompilationFailure([
			pluginBackendCompilerDiagnostic(
				"RYOT_DEFINITION",
				`Plugin declaration kind "${declaration.kind}" must use the matching definition helper`,
			),
		]);
	}
	if (
		declaration?.kind === "provider" &&
		inspection.providerOperation !== declaration.providerOperation
	) {
		return yield* sandboxCompilationFailure([
			pluginBackendCompilerDiagnostic(
				"RYOT_DEFINITION",
				`Provider definition operation "${inspection.providerOperation ?? "none"}" does not match plugin declaration "${declaration.providerOperation}"`,
			),
		]);
	}
	const capabilityDiagnostic = validateSandboxCapabilities({
		...extracted.manifest,
		...execution.metadata,
	});
	if (capabilityDiagnostic) {
		return yield* sandboxCompilationFailure([capabilityDiagnostic]);
	}

	return { ...inspected, manifest: extracted.manifest, metadata: execution.metadata };
});
