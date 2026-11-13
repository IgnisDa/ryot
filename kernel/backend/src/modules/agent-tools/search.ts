import type { DiscoveryInput } from "@ryot-app/contract/schema/agent-tool";
import type { Capability } from "@ryot-app/contract/schema/capability";
import { stableStringify } from "@ryot-app/ts-utils/json";

import { capabilitySignature } from "./declarations";
import { discover, discoveryInstruction } from "./discovery";

export const searchCapabilities = (
	capabilities: readonly Capability[],
	namespaces: readonly unknown[],
	input: DiscoveryInput,
) => {
	const found = discover(
		capabilities,
		(capability) => ({
			id: capability.id,
			description: capability.description,
			fields: stableStringify([capability.input, capability.output]),
		}),
		input,
	);
	if (found === null) {
		return { namespaces, instruction: discoveryInstruction };
	}
	const detail = input.detail ?? "summary";
	return {
		total: found.total,
		capabilities: found.selected.map((capability) =>
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
