import type { ConfigNode, GroupDef, ParsedChildren } from "./types";

export type EnvIndex = Record<string, string | undefined>;

export function parseGroupDef<T extends Record<string, ConfigNode>>(
	def: GroupDef<T>,
	env: NodeJS.ProcessEnv,
): { config: ParsedChildren<T>; envIndex: EnvIndex } {
	const envIndex: EnvIndex = {};

	function walk(node: ConfigNode): unknown {
		if (node.kind === "field") {
			const raw = env[node.envKey] ?? node.default;
			if (raw === undefined && !node.optional) {
				throw new Error(`Required config key "${node.envKey}" is not set`);
			}
			envIndex[node.envKey] = raw;
			return raw;
		}
		const result: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(node.children as Record<string, ConfigNode>)) {
			result[key] = walk(child);
		}
		return result;
	}

	return { envIndex, config: walk(def) as ParsedChildren<T> };
}

export function buildPathIndex(def: GroupDef, prefix = ""): Record<string, string> {
	const result: Record<string, string> = {};
	for (const [key, child] of Object.entries(def.children as Record<string, ConfigNode>)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (child.kind === "field") {
			result[path] = child.envKey;
		} else {
			Object.assign(result, buildPathIndex(child as GroupDef, path));
		}
	}
	return result;
}
