import type {
	AssistantToolName,
	AssistantTurnFailure,
} from "@ryot-app/contract/modules/assistant/schemas";
import type { Message } from "@ryot-app/i18n/message";
import { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import type {
	AssistantTranscriptStep,
	AssistantTranscriptTurn,
} from "@ryot-app/ryotql-recipes/assistant";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";

export const ASSISTANT_NAME = Text("Ryo");

const toolDetailKeys = {
	todo: null,
	execute: null,
	question: null,
	page_edit: null,
	search: "query",
	page_read: "path",
	page_publish: null,
	read_docs: "topic",
	page_write: "name",
	read_result: "pattern",
} as const satisfies Record<AssistantToolName, null | string>;

export const stepTitle = (step: AssistantTranscriptStep): Message => {
	if (step.kind === "reasoning") {
		return kernelMessage("client.assistant.step.reasoning");
	}
	return step.status === "running"
		? kernelMessage("client.assistant.step.running", { tool: step.tool })
		: kernelMessage("client.assistant.step.done", { tool: step.tool });
};

export const stepDetail = (step: AssistantTranscriptStep): string | undefined => {
	if (step.kind === "reasoning") {
		return undefined;
	}
	const key = toolDetailKeys[step.tool];
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

export const catalogSourceName =
	(catalog: PluginClientCatalog, t: (message: Message) => Text) => (packageId: string) => {
		const entry = catalog.find((candidate) => candidate.packageId === packageId);
		return entry === undefined ? packageId : t(entry.name);
	};

export const workedFor = (
	turn: Pick<AssistantTranscriptTurn, "createdAt" | "completedAt">,
): null | Message => {
	if (turn.completedAt === null) {
		return null;
	}
	const seconds = Math.max(
		1,
		Math.round((Date.parse(turn.completedAt) - Date.parse(turn.createdAt)) / 1000),
	);
	return seconds < 60
		? kernelMessage("client.assistant.turn.worked-seconds", { count: seconds })
		: kernelMessage("client.assistant.turn.worked-minutes", { count: Math.round(seconds / 60) });
};

const retryMessage = kernelMessage("client.assistant.turn.failure.retry", { name: ASSISTANT_NAME });

const turnFailureMessages: Record<AssistantTurnFailure["code"], Message> = {
	"tool-failed": retryMessage,
	"provider-failed": retryMessage,
	"execution-failed": retryMessage,
	"request-limit": kernelMessage("client.assistant.turn.failure.request-limit"),
	"provider-unavailable": kernelMessage("client.assistant.turn.failure.provider-unavailable", {
		name: ASSISTANT_NAME,
	}),
};

export const turnFailureMessage = (failure: null | AssistantTurnFailure) =>
	failure === null ? retryMessage : turnFailureMessages[failure.code];

export const assistantStarters = (
	catalog: PluginClientCatalog,
	t: (message: Message) => Text,
): ReadonlyArray<{ readonly text: string; readonly source: string }> => [
	...catalog.flatMap((entry) =>
		entry.isHidden
			? []
			: (entry.assistantStarters ?? []).map((starter) => ({
					text: t(starter),
					source: t(entry.name),
				})),
	),
	{
		source: t(kernelMessage("client.settings.section.pages")),
		text: t(kernelMessage("client.assistant.starter.build-page")),
	},
];
