import { Context, Effect, Layer, Path } from "effect";

export const canonicalRelativePosixPathIssue = (path: string) => {
	if (path.length === 0) {
		return "must not be empty";
	}
	if (path.startsWith("/")) {
		return "must be relative";
	}
	if (path.includes("\\")) {
		return "must use POSIX separators";
	}
	if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
		return "must not contain empty, '.', or '..' segments";
	}
	return null;
};

export const posixPath = Context.get(
	Effect.runSync(Effect.scoped(Layer.build(Path.layer))),
	Path.Path,
);
