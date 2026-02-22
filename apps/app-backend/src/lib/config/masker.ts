import { appConfigDef, systemConfigDef } from "./definition";
import type { EnvIndex } from "./parser";
import type { ConfigNode } from "./types";

function maskNode(node: ConfigNode, envIndex: EnvIndex): unknown {
	if (node._kind === "field") {
		const raw = envIndex[node.envKey];
		if (raw === undefined) {
			return null;
		}
		return node.sensitive ? "****" : raw;
	}
	const result: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(node.children as Record<string, ConfigNode>)) {
		result[key] = maskNode(child, envIndex);
	}
	return result;
}

export function getMaskedConfig(envIndexes: { system: EnvIndex; providers: EnvIndex }) {
	return {
		system: maskNode(systemConfigDef, envIndexes.system),
		providers: maskNode(appConfigDef, envIndexes.providers),
	};
}
