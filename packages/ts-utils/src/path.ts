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

const posixNormalize = (path: string) => {
	if (path.length === 0) {
		return ".";
	}
	const absolute = path.startsWith("/");
	const segments: string[] = [];
	for (const segment of path.split("/")) {
		if (segment === "" || segment === ".") {
			continue;
		}
		if (segment !== "..") {
			segments.push(segment);
		} else if (segments.length > 0 && segments.at(-1) !== "..") {
			segments.pop();
		} else if (!absolute) {
			segments.push("..");
		}
	}
	let normalized = segments.join("/");
	if (normalized.length === 0 && !absolute) {
		normalized = ".";
	}
	if (normalized.length > 0 && path.endsWith("/")) {
		normalized += "/";
	}
	return absolute ? `/${normalized}` : normalized;
};

export const posixJoin = (...segments: readonly string[]) =>
	posixNormalize(segments.filter((segment) => segment.length > 0).join("/"));

export const posixDirname = (path: string) => {
	if (path.length === 0) {
		return ".";
	}
	let end = -1;
	let trailing = true;
	for (let index = path.length - 1; index >= 1; index--) {
		if (path[index] !== "/") {
			trailing = false;
		} else if (!trailing) {
			end = index;
			break;
		}
	}
	if (end === -1) {
		return path.startsWith("/") ? "/" : ".";
	}
	return path.startsWith("/") && end === 1 ? "//" : path.slice(0, end);
};

export const posixExtname = (path: string) => {
	let dot = -1;
	let partStart = 0;
	let end = -1;
	let trailing = true;
	let beforeDot = 0;
	for (let index = path.length - 1; index >= 0; index--) {
		if (path[index] === "/") {
			if (!trailing) {
				partStart = index + 1;
				break;
			}
			continue;
		}
		if (end === -1) {
			trailing = false;
			end = index + 1;
		}
		if (path[index] === ".") {
			if (dot === -1) {
				dot = index;
			} else if (beforeDot !== 1) {
				beforeDot = 1;
			}
		} else if (dot !== -1) {
			beforeDot = -1;
		}
	}
	if (
		dot === -1 ||
		end === -1 ||
		beforeDot === 0 ||
		(beforeDot === 1 && dot === end - 1 && dot === partStart + 1)
	) {
		return "";
	}
	return path.slice(dot, end);
};
