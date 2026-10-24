import type { SandboxSourceExecutionMetadata } from "@ryot-app/contract/modules/plugins/execution-metadata";
import type { SandboxManifest } from "@ryot-app/plugin-backend-sdk/core";
import type { ProviderOperation } from "@ryot-app/plugin-backend-sdk/provider";
import { Effect } from "effect";
import * as ts from "typescript/unstable/ast";
import { type Diagnostic, DiagnosticCategory } from "typescript/unstable/async";

import {
	type PluginBackendCompilerDiagnostic,
	pluginBackendCompilerDiagnostic,
	sandboxCompilationFailure,
	toTypeScriptDiagnostic,
} from "./compiler-diagnostics";
import { extractSandboxManifest } from "./compiler-manifest";
import { validateSandboxCapabilities } from "./compiler-metadata";
import { type SandboxProjectEntry, sandboxSourcePath } from "./compiler-project";
import {
	getModuleSpecifier,
	inspectSandboxSource,
	inspectWorkflowDeterminism,
	inspectWorkflowImports,
	resolveRelativeModulePath,
	sandboxDefinitionMismatch,
} from "./compiler-source";
import { SANDBOX_COMPILER_LIMITS } from "./limits";

export type SandboxEntryDeclaration =
	| {
			readonly kind: Exclude<SandboxManifest["kind"], "provider">;
			readonly providerOperation?: never;
	  }
	| { readonly kind: "provider"; readonly providerOperation: ProviderOperation };

const inspectedSandboxEntry = Symbol("InspectedSandboxEntry");

export type InspectedSandboxEntry = SandboxProjectEntry & {
	readonly [inspectedSandboxEntry]: true;
	readonly source: string;
	readonly inspection: ReturnType<typeof inspectSandboxSource>;
};

export type ValidatedSandboxEntry = InspectedSandboxEntry & {
	readonly manifest: SandboxManifest;
	readonly metadata: SandboxSourceExecutionMetadata;
};

type ValidateSandboxEntryInput = {
	readonly inspected: InspectedSandboxEntry;
	readonly sourceFiles: readonly ts.SourceFile[];
	readonly moduleDiagnostics: readonly PluginBackendCompilerDiagnostic[];
	readonly declaration?: SandboxEntryDeclaration;
};

export const inspectSandboxEntry = Effect.fn("inspectSandboxEntry")(function* (
	projectEntry: SandboxProjectEntry,
	source: string,
	options: { readonly allowRelativeImports: boolean },
) {
	const inspection = inspectSandboxSource(projectEntry.sourceFile, options);
	if (inspection.diagnostics.length > 0) {
		return yield* sandboxCompilationFailure(inspection.diagnostics);
	}
	const inspected: InspectedSandboxEntry = {
		...projectEntry,
		source,
		inspection,
		[inspectedSandboxEntry]: true,
	};
	return inspected;
});

export const validateSandboxProjectDiagnostics = (
	project: {
		readonly diagnostics: readonly Diagnostic[];
		readonly sourceFiles: readonly ts.SourceFile[];
	},
	fallbackSourceFile: ts.SourceFile,
) => {
	const typeErrors = project.diagnostics.filter(
		(diagnostic) => diagnostic.category === DiagnosticCategory.Error,
	);
	return typeErrors.length === 0
		? Effect.void
		: sandboxCompilationFailure(
				typeErrors
					.slice(0, SANDBOX_COMPILER_LIMITS.diagnosticCount)
					.map((diagnostic) =>
						toTypeScriptDiagnostic(diagnostic, project.sourceFiles, fallbackSourceFile),
					),
			);
};

const workflowSourceFiles = (entry: ts.SourceFile, sourceFiles: ReadonlyArray<ts.SourceFile>) => {
	const byPath = new Map(sourceFiles.map((file) => [sandboxSourcePath(file.fileName), file]));
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
			const specifier = getModuleSpecifier(statement);
			if (!specifier?.startsWith(".")) {
				continue;
			}
			const path = resolveRelativeModulePath(sandboxSourcePath(file.fileName), specifier);
			const dependency =
				byPath.get(path) ??
				byPath.get(`${path}.ts`) ??
				byPath.get(path.replace(/\.js$/, ".ts")) ??
				byPath.get(`${path}/index.ts`);
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
	sourceFiles,
	declaration,
	moduleDiagnostics,
}: ValidateSandboxEntryInput) {
	const { execution, sourceFile, inspection } = inspected;
	if (execution.diagnostics.length > 0) {
		return yield* sandboxCompilationFailure(execution.diagnostics);
	}
	if (moduleDiagnostics.length > 0) {
		return yield* sandboxCompilationFailure(moduleDiagnostics);
	}

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
