import type {
	SandboxCompilationDiagnostic,
	SandboxCompilationFailure,
} from "@ryot/contract/modules/sandbox/schemas";
import { Effect } from "effect";

import {
	SANDBOX_RUNTIME_SDK_IMPORTS,
	SANDBOX_SDK_ROOT_IMPORT,
} from "#lib/infrastructure/sandbox-runtime/dependencies";

import { SANDBOX_SOURCE_FILE, sandboxCompilationFailure } from "./compiler-diagnostics";

type BundleResult =
	| { readonly diagnostics: readonly SandboxCompilationDiagnostic[] }
	| { readonly javascript: string };

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const dependencyImportPattern = new RegExp(
	`^(?:${SANDBOX_RUNTIME_SDK_IMPORTS.map(escapeRegExp).join("|")})$`,
);

const buildDiagnosticSeverity = (level: BuildMessage["level"]) => {
	if (level === "warning") {
		return "warning" as const;
	}
	if (level === "info") {
		return "info" as const;
	}
	return "error" as const;
};

const toBuildDiagnostic = (log: BuildMessage | ResolveMessage): SandboxCompilationDiagnostic => ({
	code: "RYOT_BUNDLE",
	message: log.message,
	file: SANDBOX_SOURCE_FILE,
	severity: buildDiagnosticSeverity(log.level),
	line: Math.max(1, log.position?.line ?? 1),
	column: Math.max(1, log.position?.column ?? 1),
	...(log.position === null ? {} : { length: log.position.length }),
});

export const bundleUserScript = (source: string, sdkEntries: Readonly<Record<string, string>>) => {
	const plugin: Bun.BunPlugin = {
		name: "sandbox-user-source",
		setup(builder) {
			builder.onResolve({ filter: /^sandbox:user-source$/ }, () => ({
				path: SANDBOX_SOURCE_FILE,
				namespace: "sandbox-user",
			}));
			builder.onLoad({ filter: /.*/, namespace: "sandbox-user" }, () => ({
				loader: "ts",
				contents: source,
			}));
			builder.onResolve({ filter: /^@ryot\/sandbox-sdk$/, namespace: "sandbox-user" }, () => ({
				path: sdkEntries[SANDBOX_SDK_ROOT_IMPORT] ?? SANDBOX_SDK_ROOT_IMPORT,
			}));
			builder.onResolve({ filter: dependencyImportPattern }, ({ path }) => ({
				path,
				external: true,
			}));
		},
	};
	return Effect.tryPromise({
		try: () =>
			Bun.build({
				throw: false,
				format: "esm",
				minify: false,
				splitting: false,
				plugins: [plugin],
				target: "browser",
				packages: "bundle",
				sourcemap: "inline",
				allowUnresolved: [],
				entrypoints: ["sandbox:user-source"],
			}),
		catch: (error) =>
			sandboxCompilationFailure([
				{
					line: 1,
					column: 1,
					severity: "error",
					code: "RYOT_BUNDLE",
					file: SANDBOX_SOURCE_FILE,
					message: `JavaScript bundling failed: ${String(error)}`,
				},
			]),
	}).pipe(
		Effect.flatMap((result): Effect.Effect<BundleResult, SandboxCompilationFailure> => {
			if (!result.success) {
				return Effect.succeed({
					diagnostics: result.logs.map(toBuildDiagnostic),
				} satisfies BundleResult);
			}

			const outputs = result.outputs.filter((output) => output.kind === "entry-point");
			const output = outputs[0];
			if (outputs.length !== 1 || !output) {
				return Effect.succeed({
					diagnostics: [
						{
							line: 1,
							column: 1,
							code: "RYOT_BUNDLE",
							file: SANDBOX_SOURCE_FILE,
							severity: "error" as const,
							message: "Compiler did not emit exactly one JavaScript module",
						},
					],
				} satisfies BundleResult);
			}

			return Effect.tryPromise({
				try: () => output.text(),
				catch: (error) =>
					sandboxCompilationFailure([
						{
							line: 1,
							column: 1,
							severity: "error",
							code: "RYOT_BUNDLE",
							file: SANDBOX_SOURCE_FILE,
							message: `Compiled JavaScript could not be read: ${String(error)}`,
						},
					]),
			}).pipe(Effect.map((javascript) => ({ javascript }) satisfies BundleResult));
		}),
	);
};
