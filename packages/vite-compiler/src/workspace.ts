import { Effect, Exit, FileSystem, Path, Result, Scope } from "effect";

import { viteCompilerError } from "./error";
import type { ViteCompilerError } from "./error";

export interface CompilerWorkspace {
	readonly rootPath: string;
	readonly sourcePath: string;
	readonly generatedPath: string;
	readonly outputPath: string;
}

export interface CompilerWorkspaceOptions {
	readonly parentPath?: string;
	readonly jobId?: string;
}

export interface WorkspaceFile {
	readonly path: string;
	readonly contents: string | Uint8Array;
}

interface CompilerWorkspaceInput extends CompilerWorkspaceOptions {
	readonly sources?: readonly WorkspaceFile[];
	readonly generated?:
		readonly WorkspaceFile[] | ((paths: CompilerWorkspace) => readonly WorkspaceFile[]);
}

const jobIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export const validateRelativePath = (
	valuePath: unknown,
): Result.Result<string, ViteCompilerError> => {
	if (
		typeof valuePath !== "string" ||
		valuePath.length === 0 ||
		valuePath.length > 1024 ||
		valuePath.includes("\0") ||
		valuePath.includes("\\") ||
		valuePath.startsWith("/") ||
		/^[a-z]:\//i.test(valuePath)
	) {
		return Result.fail(viteCompilerError("invalid-input", "Path must be a safe relative path"));
	}
	if (valuePath.split("/").some((part) => part === "" || part === "." || part === "..")) {
		return Result.fail(
			viteCompilerError("invalid-input", "Path must not contain empty or traversal segments"),
		);
	}
	return Result.succeed(valuePath);
};

const validateJobId = (jobId: unknown): Result.Result<string, ViteCompilerError> => {
	if (typeof jobId !== "string" || !jobIdPattern.test(jobId) || jobId === "." || jobId === "..") {
		return Result.fail(viteCompilerError("invalid-input", "Workspace job identity is invalid"));
	}
	return Result.succeed(jobId);
};

export const getCompilerWorkspaceRoot = (
	path: Path.Path,
	{ jobId, parentPath }: Required<CompilerWorkspaceOptions>,
): Result.Result<string, ViteCompilerError> => {
	if (typeof parentPath !== "string" || parentPath.length === 0) {
		return Result.fail(viteCompilerError("invalid-input", "Workspace parent path is invalid"));
	}
	const validatedJobId = validateJobId(jobId);
	if (Result.isFailure(validatedJobId)) {
		return validatedJobId;
	}
	return Result.succeed(path.join(path.resolve(parentPath), validatedJobId.success));
};

const filesystemError = (operation: string, path: string, cause: unknown) =>
	viteCompilerError("workspace-filesystem", `Could not ${operation}: ${path}`, cause);

const createWorkspaceRoot = Effect.fn("createWorkspaceRoot")(function* (
	options: CompilerWorkspaceOptions,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	let rootPath: string;
	if (options.jobId !== undefined) {
		if (options.parentPath === undefined) {
			return yield* viteCompilerError(
				"invalid-input",
				"A workspace job identity requires a parent path",
			);
		}
		const parentPath = options.parentPath;
		rootPath = yield* Effect.fromResult(
			getCompilerWorkspaceRoot(path, { parentPath, jobId: options.jobId }),
		);
		yield* fs
			.makeDirectory(path.resolve(parentPath), { recursive: true })
			.pipe(
				Effect.mapError((cause) => filesystemError("create workspace parent", parentPath, cause)),
			);
		yield* fs
			.makeDirectory(rootPath)
			.pipe(
				Effect.mapError((cause) =>
					cause.reason._tag === "AlreadyExists"
						? viteCompilerError(
								"workspace-collision",
								`Workspace path collision: ${rootPath}`,
								cause,
							)
						: filesystemError("create workspace", rootPath, cause),
				),
			);
	} else {
		rootPath = yield* fs
			.makeTempDirectory({ prefix: "ryot-vite-", directory: options.parentPath })
			.pipe(
				Effect.mapError((cause) =>
					filesystemError("create temporary workspace", options.parentPath ?? "system temp", cause),
				),
			);
	}

	return rootPath;
});

const validateInputs = (
	inputs: readonly WorkspaceFile[],
): Result.Result<WorkspaceFile[], ViteCompilerError> => {
	if (!Array.isArray(inputs)) {
		return Result.fail(viteCompilerError("invalid-input", "Workspace inputs must be an array"));
	}
	const files: WorkspaceFile[] = [];
	for (const input of inputs) {
		if (typeof input !== "object" || input === null || !("path" in input)) {
			return Result.fail(viteCompilerError("invalid-input", "Workspace input must be a file"));
		}
		const validatedPath = validateRelativePath(input.path);
		if (Result.isFailure(validatedPath)) {
			return Result.fail(validatedPath.failure);
		}
		if (typeof input.contents !== "string" && !(input.contents instanceof Uint8Array)) {
			return Result.fail(
				viteCompilerError(
					"invalid-input",
					`Workspace file contents are not supported: ${validatedPath.success}`,
				),
			);
		}
		files.push({ contents: input.contents, path: validatedPath.success });
	}
	files.sort(({ path: left }, { path: right }) => {
		if (left < right) {
			return -1;
		}
		if (left > right) {
			return 1;
		}
		return 0;
	});
	const paths = new Set<string>();
	for (const file of files) {
		const components = file.path.split("/");
		if (
			paths.has(file.path) ||
			components.some((_, index) => paths.has(components.slice(0, index).join("/")))
		) {
			return Result.fail(
				viteCompilerError("workspace-collision", `Workspace path collision: ${file.path}`),
			);
		}
		paths.add(file.path);
	}
	return Result.succeed(files);
};

const stageFiles = Effect.fn("stageWorkspaceFiles")(function* (
	namespacePath: string,
	files: readonly WorkspaceFile[],
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	yield* Effect.forEach(
		files,
		(file) =>
			Effect.gen(function* () {
				const destination = path.resolve(namespacePath, file.path);
				const parent = path.resolve(destination, "..");
				yield* fs
					.makeDirectory(parent, { recursive: true })
					.pipe(
						Effect.mapError((cause) =>
							filesystemError("create workspace directory", parent, cause),
						),
					);
				const write =
					typeof file.contents === "string"
						? fs.writeFileString(destination, file.contents, { flag: "wx" })
						: fs.writeFile(destination, file.contents, { flag: "wx" });
				yield* write.pipe(
					Effect.mapError((cause) => filesystemError("write workspace file", destination, cause)),
				);
			}),
		{ discard: true },
	);
});

export const acquireCompilerWorkspace = Effect.fn("acquireCompilerWorkspace")(function* (
	input: CompilerWorkspaceInput = {},
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const sources = yield* Effect.fromResult(validateInputs(input.sources ?? []));
	const scope = yield* Scope.fork(yield* Effect.scope);
	return yield* Effect.gen(function* () {
		const rootPath = yield* Effect.acquireRelease(createWorkspaceRoot(input), (root) =>
			fs.remove(root, { force: true, recursive: true }).pipe(Effect.orDie),
		);
		yield* fs
			.chmod(rootPath, 0o700)
			.pipe(Effect.mapError((cause) => filesystemError("make workspace private", rootPath, cause)));
		const workspace: CompilerWorkspace = {
			rootPath,
			sourcePath: path.join(rootPath, "source"),
			outputPath: path.join(rootPath, "output"),
			generatedPath: path.join(rootPath, "generated"),
		};
		const generatedInputs =
			typeof input.generated === "function" ? input.generated(workspace) : (input.generated ?? []);
		const generated = yield* Effect.fromResult(validateInputs(generatedInputs));
		for (const directory of [workspace.sourcePath, workspace.generatedPath, workspace.outputPath]) {
			yield* fs
				.makeDirectory(directory)
				.pipe(
					Effect.mapError((cause) =>
						filesystemError("create workspace namespace", directory, cause),
					),
				);
		}
		yield* stageFiles(workspace.sourcePath, sources);
		yield* stageFiles(workspace.generatedPath, generated);
		return workspace;
	}).pipe(
		Effect.provideService(Scope.Scope, scope),
		Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause))),
	);
});
