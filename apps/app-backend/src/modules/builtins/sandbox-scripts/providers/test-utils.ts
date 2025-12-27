import { isObjectRecord } from "@ryot/ts-utils/predicates";

export type HostFunction = (...args: Array<unknown>) => unknown;

type CheerioApi = {
	text: () => string;
	(selector?: string): CheerioApi;
	root: () => { text: () => string };
	replaceWith: (value: string) => void;
};

const zodChain = {
	catch() {
		return this;
	},
	max() {
		return this;
	},
	min() {
		return this;
	},
	parse(value: unknown) {
		return value;
	},
	trim() {
		return this;
	},
	transform() {
		return this;
	},
};

// Provider scripts run inside a Deno subprocess in production, where "npm:zod" etc. resolve
// against packages vendored via `deno cache` (see sandbox/runtime.ts). None of those packages
// are installed in this workspace, so driver code under test gets these lightweight stand-ins
// instead via `rewriteProviderImports`.
const providerTestImports = {
	dayjsCustomParseFormat: { default: () => undefined },
	youtubei: {
		Innertube: {
			create: () => Promise.reject(new Error("youtubei.js should be overridden in this test")),
		},
	},
	zod: {
		z: {
			string: () => zodChain,
			coerce: { number: () => zodChain },
			object: () => ({ parse: (value: unknown) => value ?? {} }),
		},
	},
	dayjs: {
		default: Object.assign(
			(value?: string | number | Date) => {
				const date = value instanceof Date ? value : new Date(value ?? 0);
				return {
					date: () => date.getUTCDate(),
					month: () => date.getUTCMonth(),
					year: () => date.getUTCFullYear(),
					toISOString: () => date.toISOString(),
					isValid: () => !Number.isNaN(date.getTime()),
				};
			},
			{
				extend: () => undefined,
				unix: (value: number) => providerTestImports.dayjs.default(value * 1000),
			},
		),
	},
	cheerio: {
		load: (html: string) => {
			const text = html
				.replace(/<br\s*\/?>/gi, "\n")
				.replace(/<[^>]+>/g, "")
				.trim();
			// oxlint-disable-next-line no-unsafe-type-assertion -- self-referential callable mock has no cast-free construction
			const api = ((_selector?: string) => api) as CheerioApi;
			api.replaceWith = () => undefined;
			api.root = () => ({ text: () => text });
			api.text = () => text;
			return api;
		},
	},
};

const rewriteProviderImports = (code: string) =>
	code
		.replaceAll('await import("npm:zod")', "__providerImports.zod")
		.replaceAll('await import("zod")', "__providerImports.zod")
		.replaceAll('await import("npm:dayjs")', "__providerImports.dayjs")
		.replaceAll('await import("dayjs")', "__providerImports.dayjs")
		.replaceAll(
			'await import("npm:dayjs/plugin/customParseFormat.js")',
			"__providerImports.dayjsCustomParseFormat",
		)
		.replaceAll(
			'await import("dayjs/plugin/customParseFormat.js")',
			"__providerImports.dayjsCustomParseFormat",
		)
		.replaceAll('await import("npm:cheerio")', "__providerImports.cheerio")
		.replaceAll('await import("cheerio")', "__providerImports.cheerio")
		.replaceAll('await import("npm:youtubei.js")', "__providerImports.youtubei")
		.replaceAll('await import("youtubei.js")', "__providerImports.youtubei");

export const runProviderDriver = (
	code: string,
	context: unknown,
	hostFunctions: Record<string, HostFunction>,
	options: {
		metadata?: unknown;
		driverName?: string;
		extraBindings?: Record<string, unknown>;
		transformCode?: (code: string) => string;
	} = {},
): Promise<unknown> => {
	const driverRegistry: Record<string, HostFunction> = {};
	const register = (name: string, fn: HostFunction) => {
		driverRegistry[name] = fn;
	};

	const hostNames = Object.keys(hostFunctions);
	const hostImplementations = hostNames.map((name) => hostFunctions[name]);

	const extraBindings = options.extraBindings ?? {};
	const extraNames = Object.keys(extraBindings);
	const extraValues = extraNames.map((name) => extraBindings[name]);

	const transformedCode = options.transformCode ? options.transformCode(code) : code;
	const rewrittenCode = rewriteProviderImports(transformedCode);

	// oxlint-disable-next-line no-implied-eval
	const factory = new Function(
		"driver",
		...hostNames,
		...extraNames,
		"__providerImports",
		rewrittenCode,
	);
	factory(register, ...hostImplementations, ...extraValues, providerTestImports);

	const driverName = options.driverName ?? "details";
	const driverFn = driverRegistry[driverName];
	if (!driverFn) {
		throw new Error(`Driver not found: ${driverName}`);
	}

	return Promise.resolve(
		driverFn(context, { metadata: options.metadata, sandboxScriptId: "script_test" }),
	);
};

export const hostSuccess = (data: unknown) => ({ success: true, data });

export const toRecord = (value: unknown): Record<string, unknown> =>
	isObjectRecord(value) ? value : Object.create(null);

export const httpSuccess = (body: unknown) => ({
	success: true,
	data: {
		headers: {},
		status: 200,
		statusText: "OK",
		body: typeof body === "string" ? body : JSON.stringify(body),
	},
});

export const withTitleCaseHelper = (helperCode: string, code: string) =>
	`const { toTitleCase } = (function () {\n${helperCode}\n})();\n\n${code}`;
