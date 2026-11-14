import { type AgentToolName, agentTools } from "./agent-tool";
import type { PluginPackageId } from "./brands";
import type { Capability } from "./capability";

export type ApprovalTarget =
	| { readonly kind: "tool"; readonly tool: AgentToolName }
	| { readonly kind: "capability"; readonly capability: Capability };

export const approvalSubject = (
	target: ApprovalTarget,
	sourceName: (packageId: PluginPackageId) => string,
) => {
	if (target.kind === "tool") {
		const tool = agentTools[target.tool];
		return {
			source: "Ryot",
			title: tool.title,
			schema: tool.input,
			description: tool.description,
			destructive: tool.hints.destructive,
		};
	}
	const { capability } = target;
	return {
		title: capability.title,
		schema: capability.input,
		description: capability.description,
		destructive: capability.hints.destructive,
		source: capability.source.kind === "kernel" ? "Ryot" : sourceName(capability.source.packageId),
	};
};
