import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { AssistantError } from "@ryot-app/contract/modules/assistant/schemas";
import {
	createRyotHostMutation,
	createRyotHostQuery,
	createRyotQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	assistantActivityRecipe,
	type AssistantConversationDetail,
	type AssistantConversationList,
	assistantConversationRecipe,
	assistantConversationsRecipe,
} from "@ryot-app/ryotql-recipes/assistant";
import { Effect, Schema } from "effect";

import { AssistantApi } from "#/api/assistant";
import { AuthenticatedApiError, isDemoOperationProtectedError } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";
import { KernelHostServices } from "#/host-services";

import { ASSISTANT_NAME } from "./presentation";

export const conversationsQuery = createRyotQuery<
	{ readonly after?: string | undefined },
	AssistantConversationList
>(({ input, client }) =>
	client.data.query(
		assistantConversationsRecipe,
		{},
		{ pages: { conversations: { limit: 30, after: input.after } } },
	),
);
export const activityQuery = createRyotQuery(assistantActivityRecipe);
export const transcriptQuery = createRyotQuery<
	{ readonly conversationId: string; readonly after?: string | undefined },
	AssistantConversationDetail
>(({ input, client }) =>
	client.data.query(
		assistantConversationRecipe,
		{ conversationId: input.conversationId },
		{ pages: { turns: { limit: 10, after: input.after } } },
	),
);
export const providerQuery = createRyotHostQuery<
	Record<string, never>,
	ContractSuccess<"assistant", "providerMetadata">,
	KernelHostServices,
	AuthenticatedApiError
>(
	({ hostServices }) =>
		hostServices.runtime.runSync(AssistantApi).providerMetadata(hostServices.scope, {}),
	{ hostServices: KernelHostServices },
);

const assistantMutation = <Payload, Success>(
	run: (
		api: AssistantApi["Service"],
		scope: ApiScope,
		payload: Payload,
	) => Effect.Effect<Success, AuthenticatedApiError>,
) =>
	createRyotHostMutation<Payload, Success, KernelHostServices, AuthenticatedApiError>(
		({ input, client, hostServices }) =>
			run(hostServices.runtime.runSync(AssistantApi), hostServices.scope, input).pipe(
				Effect.tap(() => Effect.sync(client.mutationCompleted.hint)),
			),
		{ hostServices: KernelHostServices },
	);
type AssistantPayload<Name extends keyof AssistantApi["Service"]> = ContractPayload<
	"assistant",
	Name
>;

export const submitMutation = assistantMutation((api, scope, payload: AssistantPayload<"submit">) =>
	api.submit(scope, { payload }),
);
export const decideMutation = assistantMutation((api, scope, payload: AssistantPayload<"decide">) =>
	api.decide(scope, { payload }),
);
export const answerMutation = assistantMutation((api, scope, payload: AssistantPayload<"answer">) =>
	api.answer(scope, { payload }),
);
export const interruptMutation = assistantMutation(
	(api, scope, payload: AssistantPayload<"interrupt">) => api.interrupt(scope, { payload }),
);
export const savePageMutation = assistantMutation(
	(api, scope, payload: AssistantPayload<"savePage">) => api.savePage(scope, { payload }),
);
export const configureProviderMutation = assistantMutation(
	(api, scope, payload: AssistantPayload<"configureProvider">) =>
		api.configureProvider(scope, { payload }),
);
export const renameConversationMutation = assistantMutation(
	(api, scope, payload: AssistantPayload<"renameConversation">) =>
		api.renameConversation(scope, { payload }),
);
export const deleteConversationMutation = assistantMutation(
	(api, scope, payload: AssistantPayload<"deleteConversation">) =>
		api.deleteConversation(scope, { payload }),
);
export const deleteProviderMutation = assistantMutation((api, scope, _payload: undefined) =>
	api.deleteProvider(scope, {}),
);
export const assistantFailureText = (error: unknown): string => {
	if (isDemoOperationProtectedError(error)) {
		return "This change is unavailable in demo sessions.";
	}
	const reason =
		error instanceof AuthenticatedApiError && Schema.is(AssistantError)(error.cause)
			? error.cause.reason.code
			: null;
	if (reason === "provider-unavailable") {
		return `Set up a provider in Settings → ${ASSISTANT_NAME} to start chatting.`;
	}
	if (
		reason === "revision-stale" ||
		reason === "turn-not-active" ||
		reason === "decision-conflict"
	) {
		return "This request changed. Refresh the conversation and try again.";
	}
	if (reason === "answer-invalid") {
		return "Answer every question to continue.";
	}
	if (reason === "conversation-active") {
		return `Wait for ${ASSISTANT_NAME} to finish or review its pending requests.`;
	}
	if (reason === "conversation-not-found") {
		return "This conversation is no longer available.";
	}
	if (reason === "page-preview-not-found") {
		return `This preview has changed. Ask ${ASSISTANT_NAME} for a new preview.`;
	}
	return `${ASSISTANT_NAME} could not complete this request. Try again.`;
};
