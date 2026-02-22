import { isObjectRecord } from "@ryot/ts-utils/predicates";

type HostFunction = (...args: Array<unknown>) => unknown;

export const runBuiltinScript = (
	code: string,
	context: unknown,
	hostFunctions: Record<string, HostFunction>,
	subscriptionContext = context,
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

	const trigger = driverRegistry["trigger"];
	if (trigger) {
		return Promise.resolve(trigger(context));
	}

	const subscription = driverRegistry["subscription"];
	if (!subscription) {
		throw new Error("Script did not register a trigger or subscription driver");
	}
	return Promise.resolve(subscription(subscriptionContext));
};

export const runTriggerScript = (
	code: string,
	context: unknown,
	hostFunctions: Record<string, HostFunction>,
) => {
	const triggerContext = toRecord(context)["trigger"];
	const triggerRecord = toRecord(triggerContext);
	return runBuiltinScript(code, context, hostFunctions, {
		automation: {
			source: { kind: "event", after: { ...triggerRecord, id: triggerRecord["eventId"] } },
		},
	});
};

const PUSH_HELPER_NAMES =
	"normalizeBaseUrl, parseJsonBody, integrationsDisabledForUser, listActiveIntegrations, fetchEntity, resolveEntityProviderName, collectionSyncMatches";

export const wrapWithPushHelpers = (pushHelperCode: string, scriptCode: string) =>
	`const { ${PUSH_HELPER_NAMES} } = (function () {\n${pushHelperCode}\n})();\n\n${scriptCode}`;

export const hostSuccess = (data: unknown) => ({ success: true, data });

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
