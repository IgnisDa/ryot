import { isObjectRecord } from "#lib/predicates";

type HostFunction = (...args: Array<unknown>) => unknown;

export const runTriggerScript = (
	code: string,
	context: unknown,
	hostFunctions: Record<string, HostFunction>,
): Promise<unknown> => {
	const driverRegistry: Record<string, HostFunction> = {};
	const register = (name: string, fn: HostFunction) => {
		driverRegistry[name] = fn;
	};

	const hostNames = Object.keys(hostFunctions);
	const hostImplementations = hostNames.map((name) => hostFunctions[name]);

	// oxlint-disable-next-line no-implied-eval
	const factory = new Function("driver", ...hostNames, code);
	factory(register, ...hostImplementations);

	const trigger = driverRegistry.trigger;
	if (!trigger) {
		throw new Error("Script did not register a 'trigger' driver");
	}

	return Promise.resolve(trigger(context));
};

export const hostSuccess = (data: unknown) => ({ success: true, data });

export const readScriptFile = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

export const toRecord = (value: unknown): Record<string, unknown> =>
	isObjectRecord(value) ? value : Object.create(null);

export const hostFailure = (error = "not found") => ({ error, success: false });

export const httpSuccess = (body: unknown) => ({
	success: true,
	data: {
		headers: {},
		status: 200,
		statusText: "OK",
		body: typeof body === "string" ? body : JSON.stringify(body),
	},
});

export const httpFailure = (error = "request failed", status = 500) => ({
	error,
	success: false,
	data: { status },
});
