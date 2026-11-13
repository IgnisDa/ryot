import type {
	AssistantToolCall,
	AssistantTurnFailure,
} from "@ryot-app/contract/modules/assistant/schemas";
import { type AgentToolName, agentTools } from "@ryot-app/contract/schema/agent-tool";
import type {
	AssistantTranscriptStep,
	AssistantTranscriptTurn,
} from "@ryot-app/ryotql-recipes/assistant";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";

export const ASSISTANT_NAME = "Ryo";

const toolLabels = {
	read_docs: { detail: "topic", done: "Read docs", approval: "Read docs", running: "Reading docs" },
	execute: {
		detail: null,
		done: "Ran a script",
		approval: "Run a script",
		running: "Running a script",
	},
	page_publish: {
		detail: null,
		approval: "Publish page",
		done: "Published a page",
		running: "Publishing a page",
	},
	page_write: {
		detail: "name",
		done: "Wrote a page draft",
		approval: "Write a page draft",
		running: "Writing a page draft",
	},
	search: {
		detail: "query",
		done: "Searched capabilities",
		approval: "Search capabilities",
		running: "Searching capabilities",
	},
} as const satisfies Record<
	AgentToolName,
	{
		readonly done: string;
		readonly running: string;
		readonly approval: string;
		readonly detail: null | string;
	}
>;

export const stepTitle = (step: AssistantTranscriptStep) => {
	if (step.kind === "reasoning") {
		return "Thought it through";
	}
	const labels = toolLabels[step.tool];
	return step.status === "running" ? `${labels.running}…` : labels.done;
};

export const stepDetail = (step: AssistantTranscriptStep): string | undefined => {
	if (step.kind === "reasoning") {
		return undefined;
	}
	const key = toolLabels[step.tool].detail;
	const value = key !== null && isObjectRecord(step.arguments) ? step.arguments[key] : undefined;
	if (typeof value === "string" && value.trim() !== "") {
		return value;
	}
	if (step.tool === "search" && isObjectRecord(step.arguments)) {
		const namespace = step.arguments["namespace"];
		return typeof namespace === "string" ? namespace : undefined;
	}
	return undefined;
};

export const approvalSubject = (call: AssistantToolCall, catalog: PluginClientCatalog) => {
	if (call.kind === "tool") {
		const tool = agentTools[call.tool];
		return {
			source: "Ryot",
			schema: tool.input,
			description: tool.description,
			destructive: tool.hints.destructive,
			title: toolLabels[call.tool].approval,
		};
	}
	const { capability } = call;
	const { source } = capability;
	return {
		title: capability.title,
		schema: capability.input,
		description: capability.description,
		destructive: capability.hints.destructive,
		source:
			source.kind === "kernel"
				? "Ryot"
				: (catalog.find((entry) => entry.packageId === source.packageId)?.name ?? source.packageId),
	};
};

export const workedFor = (turn: Pick<AssistantTranscriptTurn, "createdAt" | "completedAt">) => {
	if (turn.completedAt === null) {
		return null;
	}
	const seconds = Math.max(
		1,
		Math.round((Date.parse(turn.completedAt) - Date.parse(turn.createdAt)) / 1000),
	);
	return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
};

export const turnFailureText = (failure: null | AssistantTurnFailure) =>
	failure?.code === "provider-unavailable"
		? `Your provider is unavailable. Check Settings → ${ASSISTANT_NAME}.`
		: `${ASSISTANT_NAME} could not finish this reply. You can try again.`;

export const assistantStarters = (catalog: PluginClientCatalog) => [
	...catalog.flatMap((entry) =>
		entry.isHidden
			? []
			: (entry.assistantStarters ?? []).map((text) => ({ text, source: entry.name })),
	),
	{ source: "Pages", text: "Build a page that summarizes my recent activity" },
];
