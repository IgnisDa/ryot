import type { genericImportWorkflowResultSchema } from "@ryot-app/sandbox-sdk/imports";

type MediaIssue = (typeof genericImportWorkflowResultSchema.Type)["issues"][number];
export const appendMediaIssues = (
	current: MediaIssue[],
	incoming: ReadonlyArray<MediaIssue>,
	limit: number,
) => {
	const encoder = new TextEncoder();
	let bytes = encoder.encode(JSON.stringify(current)).length;
	for (const issue of incoming) {
		if (current.length >= limit) {
			break;
		}
		const size = encoder.encode(JSON.stringify(issue)).length + 1;
		if (bytes + size > 256 * 1024) {
			continue;
		}
		current.push(issue);
		bytes += size;
	}
};
