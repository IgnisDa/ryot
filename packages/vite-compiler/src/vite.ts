import { isAbsolute, relative, resolve, sep } from "node:path";

import type { TypeScriptProjectConfiguration } from "@ryot-app/typescript-compiler";
import { Context, Effect, Layer, Predicate } from "effect";
import { build, createLogger, transformWithOxc } from "vite";
import type { InlineConfig, LogErrorOptions, LogOptions, Logger, Plugin } from "vite";

import { ViteBuildInvocationError, viteCompilerError } from "./error";
import type { ViteCompilerError, ViteDiagnostic } from "./error";
import { collectViteOutputs } from "./output";
import type { CollectedViteFile } from "./output";
import type { CompilerWorkspace } from "./workspace";

export interface ViteCompilerResult {
	readonly files: readonly CollectedViteFile[];
	readonly diagnostics: readonly ViteDiagnostic[];
}

export interface ViteCompilerOptions {
	readonly workspace: CompilerWorkspace;
	readonly config: InlineConfig;
	readonly typeScriptProject: TypeScriptProjectConfiguration;
	readonly root?: string;
}

export class ViteBuildService extends Context.Service<
	ViteBuildService,
	{ readonly build: (config: InlineConfig) => Effect.Effect<unknown, ViteBuildInvocationError> }
>()("@ryot-app/vite-compiler/ViteBuildService") {
	static readonly layer = Layer.succeed(
		this,
		this.of({
			build: (config) =>
				Effect.tryPromise({
					try: () => build(config),
					catch: (cause) => new ViteBuildInvocationError({ cause }),
				}),
		}),
	);
}

const boundedText = (value: unknown, limit: number) => {
	const text = typeof value === "string" ? value : String(value);
	return text.length <= limit ? text : `${text.slice(0, limit)}...`;
};

const boundedPosition = (value: unknown) =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? Math.min(value, 2_147_483_647)
		: undefined;

const normalizeFile = (value: unknown, workspace: CompilerWorkspace, root: string) => {
	if (typeof value !== "string" || value.length === 0) {
		return undefined;
	}
	const absolute = isAbsolute(value) ? value : resolve(root, value);
	const logical = relative(workspace.rootPath, absolute);
	const outsideWorkspace =
		logical === ".." || logical.startsWith(`..${sep}`) || isAbsolute(logical);
	return boundedText(outsideWorkspace ? value : logical, 1024);
};

const normalizeDiagnostic = (
	severity: ViteDiagnostic["severity"],
	value: unknown,
	workspace: CompilerWorkspace,
	root: string,
): ViteDiagnostic => {
	const record = Predicate.isObject(value) ? value : {};
	const location =
		"loc" in record && Predicate.isObject(record["loc"])
			? record["loc"]
			: ({} as Readonly<Record<PropertyKey, unknown>>);
	const line = boundedPosition(location["line"] ?? ("line" in record ? record["line"] : undefined));
	const column = boundedPosition(
		location["column"] ?? ("column" in record ? record["column"] : undefined),
	);
	const file = normalizeFile(
		location["file"] ?? ("id" in record ? record["id"] : undefined),
		workspace,
		root,
	);
	const rawMessage = "message" in record ? record["message"] : value;
	const message = boundedText(rawMessage, 8192).replaceAll(workspace.rootPath, "<workspace>");
	const code = "code" in record ? boundedText(record["code"], 128) : undefined;
	const plugin = "plugin" in record ? boundedText(record["plugin"], 256) : undefined;
	const frame = "frame" in record ? boundedText(record["frame"], 4096) : undefined;
	return {
		message,
		severity,
		...(code === undefined ? {} : { code }),
		...(plugin === undefined ? {} : { plugin }),
		...(file === undefined ? {} : { file }),
		...(line === undefined || column === undefined ? {} : { location: { line, column } }),
		...(frame === undefined ? {} : { frame }),
	};
};

const diagnosticLogger = (
	workspace: CompilerWorkspace,
	root: string,
	diagnostics: ViteDiagnostic[],
): Logger => {
	const logger = createLogger("silent");
	const capture = (
		severity: ViteDiagnostic["severity"],
		message: string,
		options?: LogOptions | LogErrorOptions,
	) => {
		const error = options && "error" in options ? options.error : undefined;
		diagnostics.push(normalizeDiagnostic(severity, error ?? { message }, workspace, root));
	};
	logger.info = () => undefined;
	logger.warn = (message, options) => capture("warning", message, options);
	logger.warnOnce = (message, options) => capture("warning", message, options);
	logger.error = (message, options) => capture("error", message, options);
	logger.clearScreen = () => undefined;
	return logger;
};

const thrownDiagnostics = (error: unknown, workspace: CompilerWorkspace, root: string) => {
	if (Predicate.isObject(error) && "errors" in error && Array.isArray(error["errors"])) {
		return error["errors"].map((item) => normalizeDiagnostic("error", item, workspace, root));
	}
	return [normalizeDiagnostic("error", error, workspace, root)];
};

const typeScriptTransformPlugin = (
	typeScriptProject: ViteCompilerOptions["typeScriptProject"],
	configuredOxc: Exclude<InlineConfig["oxc"], false>,
): Plugin => ({
	enforce: "pre",
	name: "ryot:typescript-transform",
	async transform(code, id) {
		if (!/\.(?:[cm]?ts|[jt]sx)(?:\?|$)/.test(id)) {
			return null;
		}
		const compilerOptions = typeScriptProject.compilerOptions;
		const result = await transformWithOxc(code, id, {
			tsconfig: typeScriptProject,
			...(configuredOxc?.jsx === undefined ? {} : { jsx: configuredOxc.jsx }),
			...(typeof compilerOptions["target"] === "string"
				? { target: compilerOptions["target"] }
				: {}),
			typescript: { onlyRemoveTypeImports: compilerOptions["verbatimModuleSyntax"] === true },
		});
		for (const warning of result.warnings) {
			this.warn(warning);
		}
		return { code: result.code, ...(result.map === undefined ? {} : { map: result.map }) };
	},
});

export const buildWithVite = Effect.fn("buildWithVite")(function* ({
	root,
	config,
	workspace,
	typeScriptProject,
}: ViteCompilerOptions): Effect.fn.Return<ViteCompilerResult, ViteCompilerError, ViteBuildService> {
	if (root !== undefined && root !== workspace.generatedPath) {
		return yield* Effect.fail(
			viteCompilerError("invalid-input", "Vite root must be the compiler workspace generated path"),
		);
	}
	const viteRoot = root ?? workspace.rootPath;
	const viteBuild = yield* ViteBuildService;
	const diagnostics: ViteDiagnostic[] = [];
	const customLogger = diagnosticLogger(workspace, viteRoot, diagnostics);
	const configuredOxc = config.oxc === false ? {} : config.oxc;
	const rolldownOptions = {
		...config.build?.rolldownOptions,
		onLog(level, log) {
			if (level === "warn") {
				diagnostics.push(normalizeDiagnostic("warning", log, workspace, viteRoot));
			}
		},
	} satisfies NonNullable<NonNullable<InlineConfig["build"]>["rolldownOptions"]>;
	const protectedConfig: InlineConfig = {
		...config,
		// The compiler-owned transform prevents Vite from discovering package tsconfigs.
		oxc: false,
		customLogger,
		envDir: false,
		root: viteRoot,
		publicDir: false,
		configFile: false,
		appType: "custom",
		clearScreen: false,
		logLevel: "silent",
		css: { ...config.css, postcss: { plugins: [] } },
		cacheDir: resolve(workspace.generatedPath, "vite-cache"),
		plugins: [
			typeScriptTransformPlugin(typeScriptProject, configuredOxc),
			...(config.plugins ?? []),
		],
		build: {
			...config.build,
			watch: null,
			write: false,
			outDir: workspace.outputPath,
			rolldownOptions: { ...rolldownOptions, tsconfig: false },
		},
	};
	const result = yield* viteBuild.build(protectedConfig).pipe(
		Effect.mapError((invocationError) => {
			const cause = invocationError.cause;
			const normalized = [...diagnostics, ...thrownDiagnostics(cause, workspace, viteRoot)];
			return viteCompilerError(
				"vite-build",
				normalized.at(-1)?.message ?? "Vite build failed",
				cause,
				normalized,
			);
		}),
	);
	if (Predicate.isObject(result) && "close" in result) {
		return yield* Effect.fail(
			viteCompilerError("vite-build", "Vite unexpectedly returned a build watcher"),
		);
	}
	const files = yield* Effect.fromResult(collectViteOutputs(result));
	return { files, diagnostics };
});
