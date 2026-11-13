import type {
	AssistantToolName,
	AssistantTurnFailure,
} from "@ryot-app/contract/modules/assistant/schemas";
import type {
	AssistantTranscriptStep,
	AssistantTranscriptTurn,
} from "@ryot-app/ryotql-recipes/assistant";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";

export const ASSISTANT_NAME = "Ryo";

const toolLabels = {
	read_docs: { detail: "topic", done: "Read docs", running: "Reading docs" },
	execute: { detail: null, done: "Ran a script", running: "Running a script" },
	page_publish: { detail: null, done: "Published a page", running: "Publishing a page" },
	page_read: { detail: "path", done: "Read a page draft", running: "Reading a page draft" },
	page_edit: { detail: null, done: "Edited a page draft", running: "Editing a page draft" },
	page_write: { detail: "name", done: "Wrote a page draft", running: "Writing a page draft" },
	search: { detail: "query", done: "Searched capabilities", running: "Searching capabilities" },
	read_result: { detail: "pattern", done: "Read stored output", running: "Reading stored output" },
} as const satisfies Record<
	AssistantToolName,
	{ readonly done: string; readonly running: string; readonly detail: null | string }
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

export const catalogSourceName = (catalog: PluginClientCatalog) => (packageId: string) =>
	catalog.find((entry) => entry.packageId === packageId)?.name ?? packageId;

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

const retryText = `${ASSISTANT_NAME} could not finish this reply. You can try again.`;

const turnFailureTexts: Record<AssistantTurnFailure["code"], string> = {
	"tool-failed": retryText,
	"provider-failed": retryText,
	"execution-failed": retryText,
	"request-limit": "This conversation is too long to continue. Start a new conversation.",
	"provider-unavailable": `Your provider is unavailable. Check Settings → ${ASSISTANT_NAME}.`,
};

export const turnFailureText = (failure: null | AssistantTurnFailure) =>
	failure === null ? retryText : turnFailureTexts[failure.code];

export const assistantStarters = (catalog: PluginClientCatalog) => [
	...catalog.flatMap((entry) =>
		entry.isHidden
			? []
			: (entry.assistantStarters ?? []).map((text) => ({ text, source: entry.name })),
	),
	{ source: "Pages", text: "Build a page that summarizes my recent activity" },
];
