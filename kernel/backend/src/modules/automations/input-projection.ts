import type {
	AutomationAfterInputProjection,
	AutomationAfterPayload,
	AutomationPopulationContext,
	AutomationPolicyInputProjection,
	AutomationProjectedAfterPayload,
	AutomationProjectedRequestPayload,
	AutomationRequestPayload,
} from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { stableStringify } from "@ryot-app/ts-utils/json";

type Properties = Readonly<Record<string, JsonValue>>;
type ResourceProjection = {
	readonly properties: ReadonlyArray<string>;
	readonly parentEntityProperties?: ReadonlyArray<string>;
	readonly compareProperties?: ReadonlyArray<{
		readonly property: string;
		readonly equality: "json" | "unordered-array";
	}>;
};

const codeUnitCompare = (left: string, right: string) => {
	if (left < right) {
		return -1;
	}
	return left > right ? 1 : 0;
};

const projectProperties = (properties: Properties, names: ReadonlyArray<string>) =>
	Object.fromEntries(
		names.flatMap((name) => {
			const value = properties[name];
			return value === undefined ? [] : [[name, value]];
		}),
	);

const canonicalSet = (value: unknown) =>
	Array.isArray(value) ? new Set(value.map((element) => stableStringify(element))) : null;

const equal = (
	left: unknown,
	right: unknown,
	leftPresent: boolean,
	rightPresent: boolean,
	mode: "json" | "unordered-array",
) => {
	if (leftPresent !== rightPresent) {
		return false;
	}
	if (!leftPresent) {
		return true;
	}
	const jsonEqual = stableStringify(left) === stableStringify(right);
	if (mode === "json" || jsonEqual) {
		return jsonEqual;
	}
	const leftSet = canonicalSet(left);
	const rightSet = canonicalSet(right);
	return (
		leftSet !== null &&
		rightSet !== null &&
		leftSet.size === rightSet.size &&
		[...leftSet].every((element) => rightSet.has(element))
	);
};

const projectRecord = <Value extends { readonly properties: Properties }>(
	value: Value,
	properties: ReadonlyArray<string>,
) => ({ ...value, properties: projectProperties(value.properties, properties) });

const changedProperties = (
	before: { readonly properties: Properties },
	after: { readonly properties: Properties },
	comparisons: ReadonlyArray<{
		readonly property: string;
		readonly equality: "json" | "unordered-array";
	}>,
) =>
	comparisons
		.filter(
			({ property, equality }) =>
				!equal(
					before.properties[property],
					after.properties[property],
					Object.hasOwn(before.properties, property),
					Object.hasOwn(after.properties, property),
					equality,
				),
		)
		.map(({ property }) => property)
		.sort(codeUnitCompare);

const projectPopulation = (
	population: AutomationPopulationContext | undefined,
	projection: ResourceProjection,
) => {
	if (!population?.parentEntity) {
		return population;
	}
	return {
		...population,
		parentEntity: projectRecord(population.parentEntity, projection.parentEntityProperties ?? []),
	};
};

const projectMutation = (
	payload: Exclude<
		AutomationAfterPayload | AutomationRequestPayload,
		{ resource: "signal" | "provider-entity-import" }
	>,
	projection: ResourceProjection,
): unknown => {
	if (payload.operation === "batch") {
		return { ...payload, items: payload.items.map((item) => projectMutation(item, projection)) };
	}
	const projected = {
		...payload,
		...("draft" in payload ? { draft: projectRecord(payload.draft, projection.properties) } : {}),
		...("before" in payload
			? { before: projectRecord(payload.before, projection.properties) }
			: {}),
		...("after" in payload ? { after: projectRecord(payload.after, projection.properties) } : {}),
		...("population" in payload
			? { population: projectPopulation(payload.population, projection) }
			: {}),
	};
	if (payload.operation !== "update") {
		return projected;
	}
	const comparisons =
		projection.compareProperties ??
		projection.properties.map((property) => ({ property, equality: "json" as const }));
	return {
		...projected,
		changedProperties: changedProperties(
			payload.before,
			"after" in payload ? payload.after : payload.draft,
			comparisons,
		),
	};
};

export const projectAutomationAfterInput = (
	payload: AutomationAfterPayload,
	inputProjection: AutomationAfterInputProjection,
): AutomationProjectedAfterPayload | null => {
	if (payload.resource === "provider-entity-import") {
		return inputProjection.providerEntityImport ? payload : null;
	}
	if (payload.resource === "signal") {
		const projection = inputProjection.signal;
		return projection
			? { ...payload, properties: projectProperties(payload.properties, projection.properties) }
			: null;
	}
	const projection = inputProjection[payload.resource];
	if (!projection) {
		return null;
	}
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- projection preserves the payload discriminants while TypeScript cannot map the transformed union
	return projectMutation(payload, projection) as AutomationProjectedAfterPayload;
};

export const projectAutomationPolicyInput = (
	payload: AutomationRequestPayload,
	inputProjection: AutomationPolicyInputProjection,
): AutomationProjectedRequestPayload | null => {
	const projection = inputProjection[payload.resource];
	if (!projection) {
		return null;
	}
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- projection preserves the payload discriminants while TypeScript cannot map the transformed union
	return projectMutation(payload, projection) as AutomationProjectedRequestPayload;
};
