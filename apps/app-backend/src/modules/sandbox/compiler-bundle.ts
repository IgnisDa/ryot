import {
	SandboxCompilationFailure,
	type SandboxCompilationDiagnostic,
} from "@ryot/contract/modules/sandbox/schemas";
import { Effect } from "effect";

type BundleResult =
	| { readonly diagnostics: readonly SandboxCompilationDiagnostic[] }
	| { readonly javascript: string };

const sourceFile = "script.ts";
const compilationFailedMessage = "Sandbox TypeScript compilation failed";

const compilationFailure = (diagnostics: readonly SandboxCompilationDiagnostic[]) =>
	new SandboxCompilationFailure({
		message: compilationFailedMessage,
		diagnostics: [...diagnostics],
	});

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
	file: sourceFile,
	code: "RYOT_BUNDLE",
	message: log.message,
	line: Math.max(1, log.position?.line ?? 1),
	column: Math.max(1, log.position?.column ?? 1),
	severity: buildDiagnosticSeverity(log.level),
	...(log.position === null ? {} : { length: log.position.length }),
});

export const bundleUserScript = (source: string, sdkEntry: string) => {
	const plugin: Bun.BunPlugin = {
		name: "sandbox-user-source",
		setup(builder) {
			builder.onResolve({ filter: /^sandbox:user-source$/ }, () => ({
				path: sourceFile,
				namespace: "sandbox-user",
			}));
			builder.onLoad({ filter: /.*/, namespace: "sandbox-user" }, () => ({
				loader: "ts",
				contents: source,
			}));
			builder.onResolve({ filter: /^@ryot\/sandbox-sdk$/, namespace: "sandbox-user" }, () => ({
				path: sdkEntry,
			}));
		},
	};
	return Effect.tryPromise({
		try: () =>
			Bun.build({
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
			compilationFailure([
				{
					line: 1,
					column: 1,
					file: sourceFile,
					severity: "error",
					code: "RYOT_BUNDLE",
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
							file: sourceFile,
							code: "RYOT_BUNDLE",
							severity: "error" as const,
							message: "Compiler did not emit exactly one JavaScript module",
						},
					],
				} satisfies BundleResult);
			}

			return Effect.tryPromise({
				try: () => output.text(),
				catch: (error) =>
					compilationFailure([
						{
							line: 1,
							column: 1,
							file: sourceFile,
							severity: "error",
							code: "RYOT_BUNDLE",
							message: `Compiled JavaScript could not be read: ${String(error)}`,
						},
					]),
			}).pipe(Effect.map((javascript) => ({ javascript }) satisfies BundleResult));
		}),
	);
};
