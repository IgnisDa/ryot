import type {
	AutomationPolicyPatch,
	AutomationRequestPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { stableStringify } from "@ryot-app/ts-utils/json";

type LifecyclePolicyPatchResult<Request extends AutomationRequestPayload> =
	| { readonly ok: true; readonly request: Request }
	| { readonly ok: false; readonly reason: string };

const codeUnitCompare = (left: string, right: string) => {
	if (left < right) {
		return -1;
	}
	return left > right ? 1 : 0;
};

const propertiesDelta = (
	previous: AutomationRequestPayload["draft"]["properties"],
	successor: AutomationRequestPayload["draft"]["properties"],
) => {
	const remove: string[] = [];
	const set: Record<string, JsonValue> = {};
	const properties = [...new Set([...Object.keys(previous), ...Object.keys(successor)])].sort(
		codeUnitCompare,
	);
	for (const property of properties) {
		const previousPresent = Object.hasOwn(previous, property);
		const successorPresent = Object.hasOwn(successor, property);
		if (!successorPresent) {
			remove.push(property);
			continue;
		}
		const value = successor[property];
		if (
			value !== undefined &&
			(!previousPresent || stableStringify(previous[property]) !== stableStringify(value))
		) {
			set[property] = value;
		}
	}
	return remove.length === 0 && Object.keys(set).length === 0 ? undefined : { set, remove };
};

export const canonicalLifecyclePolicyPatch = (
	previous: AutomationRequestPayload,
	successor: AutomationRequestPayload,
): AutomationPolicyPatch | null => {
	if (
		previous.resource !== successor.resource ||
		previous.operation !== successor.operation ||
		previous.operation === "delete" ||
		(previous.resource === "event" && previous.operation !== "create")
	) {
		return null;
	}
	const properties = propertiesDelta(previous.draft.properties, successor.draft.properties);
	if (previous.resource === "entity" && successor.resource === "entity") {
		const name = previous.draft.name === successor.draft.name ? undefined : successor.draft.name;
		if (!properties && name === undefined) {
			return null;
		}
		return {
			resource: "entity",
			draft: { ...(properties ? { properties } : {}), ...(name === undefined ? {} : { name }) },
		};
	}
	if (previous.resource === "event" && successor.resource === "event") {
		const sessionEntityId =
			previous.draft.sessionEntityId === successor.draft.sessionEntityId
				? undefined
				: successor.draft.sessionEntityId;
		if (!properties && sessionEntityId === undefined) {
			return null;
		}
		return {
			resource: "event",
			draft: {
				...(properties ? { properties } : {}),
				...(sessionEntityId === undefined ? {} : { sessionEntityId }),
			},
		};
	}
	if (previous.resource === "relationship" && successor.resource === "relationship" && properties) {
		return { draft: { properties }, resource: "relationship" };
	}
	return null;
};

const patchProperties = (
	properties: AutomationRequestPayload["draft"]["properties"],
	patch: {
		readonly remove: ReadonlyArray<string>;
		readonly set: Readonly<Record<string, JsonValue>>;
	},
) => {
	const next = { ...properties };
	for (const property of patch.remove) {
		delete next[property];
	}
	return { ...next, ...patch.set };
};

export const applyLifecyclePolicyPatch = <Request extends AutomationRequestPayload>(
	request: Request,
	patch: AutomationPolicyPatch,
): LifecyclePolicyPatchResult<Request> => {
	if (request.resource !== patch.resource) {
		return { ok: false, reason: "Policy patch resource does not match the retained request" };
	}
	if (
		request.operation === "delete" ||
		(request.resource === "event" && request.operation !== "create")
	) {
		return { ok: false, reason: "Policy patch is not allowed for this mutation operation" };
	}
	const properties = patch.draft.properties
		? patchProperties(request.draft.properties, patch.draft.properties)
		: request.draft.properties;
	if (request.resource === "entity" && patch.resource === "entity") {
		return {
			ok: true,
			request: {
				...request,
				draft: {
					...request.draft,
					properties,
					...(patch.draft.name === undefined ? {} : { name: patch.draft.name }),
				},
			} as Request,
		};
	}
	if (request.resource === "event" && patch.resource === "event") {
		return {
			ok: true,
			request: {
				...request,
				draft: {
					...request.draft,
					properties,
					...(patch.draft.sessionEntityId === undefined
						? {}
						: { sessionEntityId: patch.draft.sessionEntityId }),
				},
			} as Request,
		};
	}
	if (request.resource === "relationship" && patch.resource === "relationship") {
		return {
			ok: true,
			request: { ...request, draft: { ...request.draft, properties } } as Request,
		};
	}
	return { ok: false, reason: "Policy patch resource does not match the retained request" };
};

export const applyLifecyclePolicyPatches = (
	request: AutomationRequestPayload,
	patches: ReadonlyArray<AutomationPolicyPatch>,
): LifecyclePolicyPatchResult<AutomationRequestPayload> => {
	let current = request;
	for (const patch of patches) {
		const result = applyLifecyclePolicyPatch(current, patch);
		if (!result.ok) {
			return result;
		}
		current = result.request;
	}
	return { ok: true, request: current };
};
