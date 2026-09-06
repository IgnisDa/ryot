/**
 * Raw profile frames carry script URLs and function names that can embed provider data (evaluated
 * code, source-mapped paths). Only these derived categories and allow-listed names leave a raw
 * profile; a raw URL is never emitted.
 */
const identifierName = /^[A-Za-z_$][\w$]{0,79}$/;
const pseudoName = /^\([a-z][a-z ]{0,39}\)$/;
/** A hex run this long in an identifier is a digest or an external ID, not a function name. */
const hexRun = /[0-9a-f]{20,}/i;

export const REDACTED_NAME = "<redacted-name>";

export const sanitizeFunctionName = (name: string) => {
	if (name === "") {
		return "(anonymous)";
	}
	if (pseudoName.test(name)) {
		return name;
	}
	return identifierName.test(name) && !hexRun.test(name) ? name : REDACTED_NAME;
};

const v8PseudoCategories: Record<string, string> = {
	"(root)": "root",
	"(idle)": "idle",
	"(program)": "program",
	"(garbage collector)": "gc",
};

const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const dependencyModule =
	/\/runtime-v[^/]*\/((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.mjs$/;
const compiledModule = /\/[0-9a-f]{64}\.mjs$/;
const runnerModule =
	/^file:\/\/\/.*\/(?:runner\.mjs|runner-source\.sandbox\.ts|runner-utilities\.sandbox\.ts)$/;
const runnerBundledPackage = /^ryot:external\/((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)\//;

/**
 * V8 builtins have an empty URL and a plain name, so an empty URL that is not a pseudo frame is
 * reported as `native` rather than `other`.
 */
export const categorizeV8Frame = (url: string, functionName: string) => {
	if (url === "") {
		return v8PseudoCategories[functionName] ?? "native";
	}
	if (url.startsWith("ext:") || url.startsWith("node:")) {
		return "deno-internal";
	}
	const bundled = runnerBundledPackage.exec(url)?.[1];
	if (bundled !== undefined) {
		return `runner-dependency:${bundled}`;
	}
	if (!url.startsWith("file:///")) {
		return "other";
	}
	if (runnerModule.test(url)) {
		return "runner";
	}
	if (compiledModule.test(url)) {
		return "script-module";
	}
	const dependency = dependencyModule.exec(url)?.[1];
	return dependency === undefined ? "other" : `dependency:${dependency}`;
};

export const categorizeJscFrame = (sourceUrl: string | undefined, builtin: boolean) => {
	if (sourceUrl === undefined || sourceUrl === "") {
		return builtin ? "bun-builtin" : "native";
	}
	if (builtin || /^(?:node|bun):/.test(sourceUrl)) {
		return "bun-builtin";
	}
	const modulesIndex = sourceUrl.lastIndexOf("/node_modules/");
	if (modulesIndex !== -1) {
		const segments = sourceUrl.slice(modulesIndex + "/node_modules/".length).split("/");
		const name = segments[0]?.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];
		return name !== undefined && packageName.test(name) ? `dependency:${name}` : "other";
	}
	if (sourceUrl.startsWith("/home/ryot/dist/")) {
		return "backend-dist";
	}
	return "other";
};
