import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import * as S from "./schemas";

export const AssistantGroup = HttpApiGroup.make("assistant")
	.annotate(
		OpenApi.Description,
		"Conversations, durable assistant turns, approvals, provider settings and page saving.",
	)
	.add(
		HttpApiEndpoint.get("providerMetadata", "/assistant/provider", {
			success: Schema.NullOr(S.AssistantProviderMetadata),
		}).annotate(
			OpenApi.Description,
			"Read effective assistant provider metadata without exposing credentials.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.patch("demo-write")(
			"renameConversation",
			"/assistant/conversations",
			{
				success: S.AssistantConversationResult,
				payload: S.RenameAssistantConversationBody,
				error: [S.AssistantError.pipe(HttpApiSchema.status(400))],
			},
		).annotate(OpenApi.Description, "Rename an owned assistant conversation."),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("demo-write")(
			"deleteConversation",
			"/assistant/conversations",
			{
				payload: S.AssistantConversationResult,
				success: S.AssistantConversationResult,
				error: [S.AssistantError.pipe(HttpApiSchema.status(400))],
			},
		).annotate(OpenApi.Description, "Delete an idle assistant conversation and its history."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("demo-write")("submit", "/assistant/turns", {
			payload: S.SubmitAssistantTurnBody,
			success: S.SubmitAssistantTurnResult,
			error: [S.AssistantError.pipe(HttpApiSchema.status(400))],
		}).annotate(
			OpenApi.Description,
			"Admit or replay a durable assistant turn by request ID, creating the conversation when none is given.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.post("demo-write")("interrupt", "/assistant/interrupts", {
			success: S.SubmitAssistantTurnResult,
			payload: S.InterruptAssistantTurnBody,
			error: [S.AssistantError.pipe(HttpApiSchema.status(400))],
		}).annotate(
			OpenApi.Description,
			"Stop an active assistant turn and settle its unfinished calls as interrupted.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.post("write")("decide", "/assistant/decisions", {
			success: S.SubmitAssistantTurnResult,
			payload: S.DecideAssistantToolCallBody,
			error: [S.AssistantError.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Persist an approval decision and wake the waiting turn."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("demo-write")("answer", "/assistant/answers", {
			success: S.SubmitAssistantTurnResult,
			payload: S.AnswerAssistantQuestionBody,
			error: [S.AssistantError.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Answer the assistant's pending question and wake the turn."),
	)
	.add(
		AuthenticatedMutationEndpoint.put("write")("configureProvider", "/assistant/provider", {
			success: Schema.Void,
			payload: S.ConfigureAssistantProviderBody,
			error: [S.AssistantError.pipe(HttpApiSchema.status(400))],
		}).annotate(
			OpenApi.Description,
			"Configure the encrypted per-user assistant provider override.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("write")("deleteProvider", "/assistant/provider", {
			success: Schema.Void,
			error: [S.AssistantError.pipe(HttpApiSchema.status(400))],
		}).annotate(
			OpenApi.Description,
			"Remove the per-user provider override and use instance defaults.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.post("write")("savePage", "/assistant/pages/save", {
			payload: S.SaveAssistantPageBody,
			success: S.SaveAssistantPageResult,
			error: [S.AssistantError.pipe(HttpApiSchema.status(400))],
		}).annotate(
			OpenApi.Description,
			"Publish an exact persisted page preview and create a saved view with replay protection.",
		),
	)
	.middleware(AuthMiddleware);
