type HostFunction = (...args: Array<unknown>) => unknown;

/**
 * Evaluates a trigger sandbox script the same way the Deno runner does: host
 * functions are exposed as in-scope identifiers and the registered `trigger`
 * driver is invoked with the supplied context. The driver's return value is
 * returned so before-create policy results can be asserted.
 */
export const runTriggerScript = async (
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

	return await trigger(context);
};

export const appApiSuccess = (data: unknown) => ({
	success: true,
	data: { body: { data }, status: 200, statusText: "OK", headers: {} },
});

export const appApiFailure = (error = "not found", status = 404) => ({
	error,
	success: false,
	data: { body: null, status, headers: {} },
});

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
