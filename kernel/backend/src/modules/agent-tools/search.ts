import type { SearchCapabilitiesInput } from "@ryot-app/contract/schema/agent-tool";
import { type Capability, capabilityOwner } from "@ryot-app/contract/schema/capability";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { sortBy } from "@ryot-app/ts-utils/lodash";

import { capabilitySignature } from "./declarations";

const tokens = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? [];

const score = (capability: Capability, terms: readonly string[]) => {
	const id = capability.id.toLowerCase();
	const description = capability.description.toLowerCase();
	const fields = stableStringify([capability.input, capability.output]).toLowerCase();
	return terms.reduce(
		(total, term) =>
			total +
			(id.includes(term) ? 5 : 0) +
			(description.includes(term) ? 3 : 0) +
			(fields.includes(term) ? 1 : 0),
		0,
	);
};

export const searchCapabilities = (
	capabilities: readonly Capability[],
	namespaces: readonly unknown[],
	input: SearchCapabilitiesInput,
) => {
	const terms = tokens(input.query ?? "");
	if (terms.length === 0 && input.namespace == null) {
		return { namespaces, instruction: "Search with a query, a namespace, or both." };
	}
	const candidates = capabilities.filter(
		(capability) => input.namespace == null || capabilityOwner(capability.id) === input.namespace,
	);
	const ranked =
		terms.length === 0
			? candidates
			: sortBy(
					candidates
						.map((capability) => ({ capability, score: score(capability, terms) }))
						.filter((entry) => entry.score > 0),
					[(entry) => -entry.score, (entry) => entry.capability.id],
				).map((entry) => entry.capability);
	const selected = ranked.slice(0, input.limit ?? 10);
	const detail = input.detail ?? "summary";
	return {
		total: ranked.length,
		capabilities: selected.map((capability) =>
			detail === "names"
				? capability.id
				: Object.assign(
						{
							id: capability.id,
							readOnly: capability.hints.readOnly,
							description: capability.description,
							destructive: capability.hints.destructive,
						},
						detail === "full" ? { types: capabilitySignature(capability) } : {},
					),
		),
	};
};
