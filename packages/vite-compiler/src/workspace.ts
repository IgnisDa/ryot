import { isAbsolute, join, relative, resolve, win32 } from "node:path";

import { Effect, FileSystem, Result } from "effect";

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

export interface AddressedCompilerWorkspaceOptions {
	readonly parentPath: string;
	readonly jobId: string;
}

export interface WorkspaceFile {
	readonly kind?: "file";
	readonly path: string;
	readonly contents: string | Uint8Array;
}

export interface WorkspaceSymlink {
	readonly kind: "symlink";
	readonly path: string;
	readonly target: string;
}

export type WorkspaceInput = WorkspaceFile | WorkspaceSymlink;

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
		isAbsolute(valuePath) ||
		win32.isAbsolute(valuePath)
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

export const getCompilerWorkspaceRoot = ({
	jobId,
	parentPath,
}: AddressedCompilerWorkspaceOptions): Result.Result<string, ViteCompilerError> => {
	if (typeof parentPath !== "string" || parentPath.length === 0) {
		return Result.fail(viteCompilerError("invalid-input", "Workspace parent path is invalid"));
	}
	const validatedJobId = validateJobId(jobId);
	if (Result.isFailure(validatedJobId)) {
		return validatedJobId;
	}
	return Result.succeed(join(resolve(parentPath), validatedJobId.success));
};

const filesystemError = (operation: string, path: string, cause: unknown) =>
	viteCompilerError("workspace-filesystem", `Could not ${operation}: ${path}`, cause);

const createCompilerWorkspace = Effect.fn("createCompilerWorkspace")(function* (
	options: CompilerWorkspaceOptions,
) {
	const fs = yield* FileSystem.FileSystem;
	let rootPath: string;
	if (options.jobId !== undefined) {
		if (options.parentPath === undefined) {
			return yield* Effect.fail(
				viteCompilerError("invalid-input", "A workspace job identity requires a parent path"),
			);
		}
		const parentPath = options.parentPath;
		rootPath = yield* Effect.fromResult(
			getCompilerWorkspaceRoot({ parentPath, jobId: options.jobId }),
		);
		yield* fs
			.makeDirectory(resolve(parentPath), { recursive: true })
			.pipe(
				Effect.mapError((cause) => filesystemError("create workspace parent", parentPath, cause)),
			);
		yield* fs
			.makeDirectory(rootPath)
			.pipe(Effect.mapError((cause) => filesystemError("create workspace", rootPath, cause)));
	} else {
		rootPath = yield* fs
			.makeTempDirectory({ prefix: "ryot-vite-", directory: options.parentPath })
			.pipe(
				Effect.mapError((cause) =>
					filesystemError("create temporary workspace", options.parentPath ?? "system temp", cause),
				),
			);
	}

	const workspace = {
		rootPath,
		sourcePath: join(rootPath, "source"),
		outputPath: join(rootPath, "output"),
		generatedPath: join(rootPath, "generated"),
	} satisfies CompilerWorkspace;
	return yield* Effect.forEach(
		[workspace.sourcePath, workspace.generatedPath, workspace.outputPath],
		(path) =>
			fs
				.makeDirectory(path)
				.pipe(
					Effect.mapError((cause) => filesystemError("create workspace namespace", path, cause)),
				),
		{ discard: true },
	).pipe(
		Effect.as(workspace),
		Effect.onError(() => fs.remove(rootPath, { force: true, recursive: true }).pipe(Effect.ignore)),
	);
});

export const acquireCompilerWorkspace = Effect.fn("acquireCompilerWorkspace")(function* (
	options: CompilerWorkspaceOptions = {},
) {
	const fs = yield* FileSystem.FileSystem;
	return yield* Effect.acquireRelease(createCompilerWorkspace(options), (workspace) =>
		fs.remove(workspace.rootPath, { force: true, recursive: true }).pipe(Effect.orDie),
	);
});

type ValidatedWorkspaceFile = { readonly path: string; readonly contents: string | Uint8Array };

const validateInputs = (
	inputs: readonly WorkspaceInput[],
): Result.Result<ValidatedWorkspaceFile[], ViteCompilerError> => {
	if (!Array.isArray(inputs)) {
		return Result.fail(viteCompilerError("invalid-input", "Workspace inputs must be an array"));
	}
	const files: ValidatedWorkspaceFile[] = [];
	for (const input of inputs) {
		if (typeof input !== "object" || input === null || !("path" in input)) {
			return Result.fail(viteCompilerError("invalid-input", "Workspace input must be a file"));
		}
		if (input.kind === "symlink") {
			return Result.fail(
				viteCompilerError(
					"workspace-symlink",
					`Workspace symlinks are not supported: ${String(input.path)}`,
				),
			);
		}
		if (input.kind !== undefined && input.kind !== "file") {
			return Result.fail(
				viteCompilerError("invalid-input", "Workspace input kind is not supported"),
			);
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
	for (let index = 1; index < files.length; index += 1) {
		const previousPath = files[index - 1]?.path;
		const currentPath = files[index]?.path;
		if (previousPath === currentPath || currentPath?.startsWith(`${previousPath}/`)) {
			return Result.fail(
				viteCompilerError("workspace-collision", `Workspace source path collision: ${currentPath}`),
			);
		}
	}
	return Result.succeed(files);
};

const stageFiles = Effect.fn("stageWorkspaceFiles")(function* (
	namespacePath: string,
	inputs: readonly WorkspaceInput[],
) {
	const fs = yield* FileSystem.FileSystem;
	const ordered = yield* Effect.fromResult(validateInputs(inputs));
	const namespaceRealPath = yield* fs
		.realPath(namespacePath)
		.pipe(
			Effect.mapError((cause) =>
				filesystemError("resolve workspace namespace", namespacePath, cause),
			),
		);
	const destinations = yield* Effect.forEach(ordered, (file) =>
		Effect.gen(function* () {
			const destination = resolve(namespacePath, file.path);
			const parent = resolve(destination, "..");
			yield* fs
				.makeDirectory(parent, { recursive: true })
				.pipe(
					Effect.mapError((cause) => filesystemError("create source directory", parent, cause)),
				);
			let componentPath = namespacePath;
			for (const component of file.path.split("/").slice(0, -1)) {
				componentPath = join(componentPath, component);
				const componentStatus = yield* fs
					.stat(componentPath)
					.pipe(
						Effect.mapError((cause) =>
							filesystemError("inspect source path", componentPath, cause),
						),
					);
				if (componentStatus.type === "SymbolicLink") {
					return yield* Effect.fail(
						viteCompilerError(
							"workspace-symlink",
							`Workspace path escapes through a symlink: ${file.path}`,
						),
					);
				}
			}
			const parentRealPath = yield* fs
				.realPath(parent)
				.pipe(
					Effect.mapError((cause) => filesystemError("resolve source directory", parent, cause)),
				);
			const relativeParent = relative(namespaceRealPath, parentRealPath);
			if (
				relativeParent === ".." ||
				relativeParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
			) {
				return yield* Effect.fail(
					viteCompilerError(
						"workspace-symlink",
						`Workspace path escapes its namespace: ${file.path}`,
					),
				);
			}
			const exists = yield* fs
				.exists(destination)
				.pipe(
					Effect.mapError((cause) =>
						filesystemError("inspect source destination", destination, cause),
					),
				);
			if (exists) {
				const status = yield* fs
					.stat(destination)
					.pipe(
						Effect.mapError((cause) =>
							filesystemError("inspect source destination", destination, cause),
						),
					);
				return yield* Effect.fail(
					viteCompilerError(
						status.type === "SymbolicLink" ? "workspace-symlink" : "workspace-collision",
						status.type === "SymbolicLink"
							? `Workspace destination is a symlink: ${file.path}`
							: `Workspace source path collision: ${file.path}`,
					),
				);
			}
			return { file, destination };
		}),
	);
	yield* Effect.forEach(
		destinations,
		({ file, destination }) => {
			const write =
				typeof file.contents === "string"
					? fs.writeFileString(destination, file.contents, { flag: "wx" })
					: fs.writeFile(destination, file.contents, { flag: "wx" });
			return write.pipe(
				Effect.mapError((cause) => filesystemError("write workspace source", destination, cause)),
			);
		},
		{ discard: true },
	);
	return ordered.map(({ path }) => path);
});

export const stageSourceFiles = (workspace: CompilerWorkspace, inputs: readonly WorkspaceInput[]) =>
	stageFiles(workspace.sourcePath, inputs);

export const stageGeneratedFiles = (
	workspace: CompilerWorkspace,
	inputs: readonly WorkspaceInput[],
) => stageFiles(workspace.generatedPath, inputs);
