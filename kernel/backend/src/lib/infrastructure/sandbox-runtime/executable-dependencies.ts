import type { SandboxScriptMetadata } from "@ryot-app/contract/modules/sandbox/schemas";
import type { WorkflowDurableCallRequest } from "@ryot-app/sandbox-sdk/workflow";

export const isDeclaredExecutableCall = (
	metadata: SandboxScriptMetadata,
	request: WorkflowDurableCallRequest,
): boolean => {
	if (request.kind === "host" || request.kind === "sleep") {
		return true;
	}
	const kind = request.kind === "activity" ? "script" : "workflow";
	const slug = request.kind === "activity" ? request.args.scriptSlug : request.args.workflowSlug;
	return (
		metadata.executableDependencies?.some(
			(dependency) => dependency.kind === kind && dependency.slug === slug,
		) ?? false
	);
};
