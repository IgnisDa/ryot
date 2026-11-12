import type { ContractPayload } from "@ryot-app/contract/client";
import { kernelCapabilityId } from "@ryot-app/contract/schema/capability";
import { assistantConversationRecipe } from "@ryot-app/ryotql-recipes/assistant";
import { pagesRecipe } from "@ryot-app/ryotql-recipes/pages";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Schema } from "effect";

import {
	type AssistantProviderReply,
	startAssistantProvider,
} from "~/fixtures/kernel/assistant-provider";
import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { pollUntil } from "~/fixtures/kernel/polling";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { assert, expect, it } from "~/support/effect-test";
import { startIsolatedApiServer } from "~/support/isolated-harness";

const ProviderRequest = Schema.Struct({
	tools: Schema.Array(Schema.Struct({ function: Schema.Struct({ name: Schema.String }) })),
});
const scripted = (replies: readonly AssistantProviderReply[]) => {
	let round = 0;
	return () => Effect.sync(() => replies[round++] ?? { text: "Done." });
};

it.live("uses instance tools, overrides with a user provider, and fences write decisions", () =>
	Effect.gen(function* () {
		const instance = yield* startAssistantProvider(
			scripted([
				{
					name: "execute",
					arguments: { code: 'return await ryot.call("kernel:pages.list", {});' },
				},
				{ text: "No pages yet." },
			]),
		);
		const server = yield* startIsolatedApiServer({
			label: "assistant-provider-precedence",
			extraEnv: {
				SERVER_ASSISTANT_MODEL: "instance-model",
				SERVER_ASSISTANT_API_KEY: "instance-test-key",
				SERVER_EGRESS_ALLOWED_NETWORKS: "127.0.0.1/32",
				SERVER_ASSISTANT_BASE_URL: `${instance.url}/v1`,
			},
		});
		const { client } = yield* createAuthenticatedClient(server.target);
		expect(yield* client.call((api) => api.assistant.providerMetadata())).toMatchObject({
			source: "instance",
			model: "instance-model",
		});
		const { conversationId } = yield* client.call((api) =>
			api.assistant.createConversation({ payload: { title: "Acceptance" } }),
		);
		const detail = executeRyotQLRecipe(client, assistantConversationRecipe, { conversationId });
		const submit = (text: string) =>
			client.call((api) =>
				api.assistant.submit({ payload: { text, conversationId, requestId: crypto.randomUUID() } }),
			);
		const finished = () =>
			pollUntil(
				"completed assistant turn",
				detail.pipe(
					Effect.map((value) =>
						value.turns.items.every((turn) => turn.status === "completed") ? value : null,
					),
				),
			);
		yield* submit("List my pages");
		const read = yield* finished();
		expect(
			read.calls.items.map(({ call, decision }) => ({
				decision,
				kind: call.kind,
				approval: call.requiresApproval,
			})),
		).toEqual([{ kind: "tool", decision: null, approval: false }]);
		expect(read.calls.items[0]?.result).toMatchObject({ truncated: false, value: { error: null } });
		expect(stableStringify(read.messages.items)).toContain("No pages yet.");
		const advertised = yield* Schema.decodeUnknownEffect(ProviderRequest)(
			instance.requests[0]?.body,
		);
		expect(advertised.tools.map((tool) => tool.function.name)).toEqual([
			"search",
			"execute",
			"read_docs",
			"page_write",
			"page_publish",
		]);
		const payload = {
			name: "Approved draft",
			slug: "approved-draft",
			definition: {
				pluginDependencies: {},
				entry: "client/page.tsx",
				queries: { queries: {} },
				files: [
					{
						path: "client/page.tsx",
						content: Buffer.from(
							"export default function Page() { return <h2>Approved</h2>; }",
						).toString("base64"),
					},
				],
			},
		} satisfies ContractPayload<"pageAuthoring", "create">;
		const user = yield* startAssistantProvider(
			scripted([
				{ arguments: payload, name: "page_write" },
				{ text: "Decision handled." },
				{ arguments: payload, name: "page_write" },
				{ text: "Decision handled." },
				{
					name: "execute",
					arguments: {
						code: `const pages = await ryot.call("kernel:pages.list", {});
const pageId = String(pages.data["pages"]?.items[0]?.["id"]);
return await ryot.call("kernel:pages.delete", { pageId });`,
					},
				},
				{ text: "Deleted." },
			]),
		);
		yield* client.call((api) =>
			api.assistant.configureProvider({
				payload: { model: "user-model", apiKey: "user-test-key", baseUrl: `${user.url}/v1` },
			}),
		);
		expect(yield* client.call((api) => api.assistant.providerMetadata())).toMatchObject({
			source: "user",
			model: "user-model",
		});
		for (const decision of ["decline", "approve"] as const) {
			yield* submit(`Create the draft: ${decision}`);
			const pending = yield* pollUntil(
				"stored approval",
				detail.pipe(
					Effect.map(
						(value) =>
							value.calls.items.find(
								(call) =>
									call.call.requiresApproval && call.decision === null && call.result === null,
							) ?? null,
					),
				),
			);
			expect(pending.call.arguments).toEqual(payload);
			expect((yield* executeRyotQLRecipe(client, pagesRecipe, {})).items).toEqual([]);
			const stale = yield* client
				.call((api) =>
					api.assistant.decide({
						payload: {
							decision,
							conversationId,
							turnId: pending.turnId,
							toolCallId: pending.id,
							expectedRevision: pending.revision + 1,
						},
					}),
				)
				.pipe(Effect.flip);
			expect(stale).toMatchObject({ reason: { code: "revision-stale" } });
			expect((yield* executeRyotQLRecipe(client, pagesRecipe, {})).items).toEqual([]);
			yield* client.call((api) =>
				api.assistant.decide({
					payload: {
						decision,
						conversationId,
						turnId: pending.turnId,
						toolCallId: pending.id,
						expectedRevision: pending.revision,
					},
				}),
			);
			yield* finished();
			expect(
				(yield* executeRyotQLRecipe(client, pagesRecipe, {})).items.map((page) => ({
					name: page.name,
					writeAccess: page.writeAccess,
				})),
			).toEqual(decision === "decline" ? [] : [{ writeAccess: false, name: "Approved draft" }]);
		}
		yield* submit("Delete the draft");
		const write = yield* pollUntil(
			"pending capability write",
			detail.pipe(
				Effect.map(
					(value) =>
						value.calls.items.find(
							(call) => call.call.kind === "capability" && call.decision === null,
						) ?? null,
				),
			),
		);
		assert(write.call.kind === "capability", "The pending write is a capability call");
		expect(write.call.capability.id).toBe(kernelCapabilityId("pages.delete"));
		expect((yield* executeRyotQLRecipe(client, pagesRecipe, {})).items).toHaveLength(1);
		yield* client.call((api) =>
			api.assistant.decide({
				payload: {
					conversationId,
					decision: "approve",
					turnId: write.turnId,
					toolCallId: write.id,
					expectedRevision: write.revision,
				},
			}),
		);
		yield* finished();
		expect((yield* executeRyotQLRecipe(client, pagesRecipe, {})).items).toEqual([]);
		expect(instance.requests).toHaveLength(2);
		expect(user.requests).toHaveLength(6);
		expect(user.requests[0]?.headers.authorization).toBe("Bearer user-test-key");
		expect(stableStringify(user.requests[0]?.body)).toContain('"model":"user-model"');
		yield* client.call((api) => api.assistant.deleteProvider());
		expect(yield* client.call((api) => api.assistant.providerMetadata())).toMatchObject({
			source: "instance",
		});
	}),
);
