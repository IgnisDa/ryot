import type { ContractPayload, ContractSuccess } from "@ryot-app/contract/client";
import { AssistantError } from "@ryot-app/contract/modules/assistant/schemas";
import type { Message } from "@ryot-app/i18n/message";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
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
import {
	AuthenticatedApiError,
	isDemoOperationProtectedError,
	isEntitlementRequiredError,
} from "#/api/authenticated";
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
export const assistantFailureMessage = (error: unknown): Message => {
	if (isDemoOperationProtectedError(error)) {
		return kernelMessage("client.assistant.error.demo");
	}
	if (isEntitlementRequiredError(error)) {
		return kernelMessage("client.assistant.pro-required", { name: ASSISTANT_NAME });
	}
	const reason =
		error instanceof AuthenticatedApiError && Schema.is(AssistantError)(error.cause)
			? error.cause.reason.code
			: null;
	if (reason === "provider-unavailable") {
		return kernelMessage("client.assistant.error.provider-unavailable", { name: ASSISTANT_NAME });
	}
	if (
		reason === "revision-stale" ||
		reason === "turn-not-active" ||
		reason === "decision-conflict"
	) {
		return kernelMessage("client.assistant.error.stale");
	}
	if (reason === "answer-invalid") {
		return kernelMessage("client.assistant.error.answer-invalid");
	}
	if (reason === "conversation-active") {
		return kernelMessage("client.assistant.error.conversation-active", { name: ASSISTANT_NAME });
	}
	if (reason === "conversation-not-found") {
		return kernelMessage("client.assistant.error.conversation-not-found");
	}
	if (reason === "page-preview-not-found") {
		return kernelMessage("client.assistant.error.preview-changed", { name: ASSISTANT_NAME });
	}
	return kernelMessage("client.assistant.error.failed", { name: ASSISTANT_NAME });
};
