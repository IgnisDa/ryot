import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Data, Effect, FileSystem, Option, Path } from "effect";

const artifacts = [
	"ryot-sandboxd",
	"ryot-sandbox-launcher",
	"snapshots/core.snap",
	"snapshots/data.snap",
	"snapshots/full.snap",
];

class NativeSandboxSetupError extends Data.TaggedError("NativeSandboxSetupError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

const isSymlink = (fs: FileSystem.FileSystem, paths: Path.Path, filePath: string) =>
	Effect.gen(function* () {
		const realParent = yield* fs.realPath(paths.dirname(filePath));
		const realPath = yield* fs.realPath(filePath);
		return realPath !== paths.join(realParent, paths.basename(filePath));
	});

const verifyPath = (
	fs: FileSystem.FileSystem,
	paths: Path.Path,
	filePath: string,
	mode: number,
	directory = false,
) =>
	Effect.gen(function* () {
		const symlink = yield* isSymlink(fs, paths, filePath);
		const stat = yield* fs.stat(filePath);
		if (
			symlink ||
			!Option.isSome(stat.uid) ||
			stat.uid.value !== 0 ||
			!Option.isSome(stat.gid) ||
			stat.gid.value !== 0 ||
			(stat.mode & 0o7777) !== mode ||
			(directory ? stat.type !== "Directory" : stat.type !== "File")
		) {
			return yield* new NativeSandboxSetupError({
				message: `Native sandbox setup failure: untrusted installation at ${filePath}`,
			});
		}
		return undefined;
	});

const digest = (fs: FileSystem.FileSystem, path: string) =>
	fs.readFile(path).pipe(Effect.map(sha256Hex));

const artifactMode = (artifact: string) => {
	if (artifact === "ryot-sandbox-launcher") {
		return 0o4755;
	}
	if (artifact === "ryot-sandboxd") {
		return 0o555;
	}
	return 0o444;
};

export const verifyNativeSandboxProvisioning = Effect.fnUntraced(function* (root: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const dist = path.join(root, "kernel/sandboxd/dist");
	for (const artifact of artifacts) {
		const artifactPath = path.join(dist, artifact);
		const symlink = yield* isSymlink(fs, path, artifactPath);
		const stat = yield* fs.stat(artifactPath);
		if (symlink || stat.type !== "File") {
			return yield* new NativeSandboxSetupError({
				message: `Native sandbox setup failure: missing release artifact ${artifact}`,
			});
		}
	}
	if (process.platform === "darwin") {
		return yield* Effect.logInfo("Native sandbox: unconfined macOS development");
	}
	if (process.platform !== "linux" || process.getuid?.() !== 1001 || process.getgid?.() !== 1001) {
		return yield* new NativeSandboxSetupError({
			message: "Native sandbox setup failure: Linux e2e must run as UID/GID 1001",
		});
	}
	const setupCommand = `sudo bash kernel/sandboxd/provision.sh ${dist}/ryot-sandbox-launcher ${dist}/ryot-sandboxd ${dist}/snapshots`;
	const verifyInstalled = Effect.gen(function* () {
		for (const installedPath of [
			"/home/ryot",
			"/home/ryot/sandboxd",
			"/home/ryot/sandboxd/snapshots",
			"/usr/local/libexec",
		]) {
			yield* verifyPath(fs, path, installedPath, 0o755, true);
		}
		yield* verifyPath(fs, path, "/run/ryot-sandboxd", 0o700, true);
		for (const artifact of artifacts) {
			const installed =
				artifact === "ryot-sandbox-launcher"
					? "/usr/local/libexec/ryot-sandbox-launcher"
					: path.join("/home/ryot/sandboxd", artifact);
			yield* verifyPath(fs, path, installed, artifactMode(artifact));
			const [installedDigest, releaseDigest] = yield* Effect.all([
				digest(fs, installed),
				digest(fs, path.join(dist, artifact)),
			]);
			if (installedDigest !== releaseDigest) {
				return yield* new NativeSandboxSetupError({
					message: `Native sandbox setup failure: stale installed artifact ${installed}`,
				});
			}
		}
		return undefined;
	});
	return yield* verifyInstalled.pipe(
		Effect.mapError(
			(cause) =>
				new NativeSandboxSetupError({
					cause,
					message: `Native sandbox setup failure: run the explicit root provisioning step: ${setupCommand}`,
				}),
		),
	);
});
