import type { ContractPayload } from "@ryot-app/contract/client";
import { kernelCapabilityId } from "@ryot-app/contract/schema/capability";
import {
	type AssistantConversationDetail,
	assistantConversationRecipe,
	assistantConversationsRecipe,
} from "@ryot-app/ryotql-recipes/assistant";
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
const scripted = <E = never, R = never>(
	replies: readonly (AssistantProviderReply | Effect.Effect<AssistantProviderReply, E, R>)[],
) => {
	let round = 0;
	return () => {
		const reply = replies[round++] ?? { text: "Done." };
		return Effect.isEffect(reply) ? reply : Effect.succeed(reply);
	};
};
const calls = (detail: AssistantConversationDetail) =>
	detail.turns.items.flatMap((turn) => turn.calls.items);
const pendingCall = (detail: AssistantConversationDetail) =>
	calls(detail).find(
		(call) => call.call.requiresApproval && call.decision === null && call.result === null,
	) ?? null;

it.live(
	"creates titled conversations, drafts pages freely, fences publish and write decisions, and stops turns",
	() =>
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
			const first = yield* client.call((api) =>
				api.assistant.submit({
					payload: { text: "List   my pages", requestId: crypto.randomUUID() },
				}),
			);
			const { conversationId } = first;
			const detail = executeRyotQLRecipe(client, assistantConversationRecipe, { conversationId });
			const submit = (text: string) =>
				client.call((api) =>
					api.assistant.submit({
						payload: { text, conversationId, requestId: crypto.randomUUID() },
					}),
				);
			const finished = () =>
				pollUntil(
					"settled assistant turn",
					detail.pipe(
						Effect.map((value) =>
							value.turns.items.every(
								(turn) => turn.status === "completed" || turn.status === "interrupted",
							)
								? value
								: null,
						),
					),
				);
			const read = yield* finished();
			expect(read.conversation).toMatchObject({ status: "idle", title: "List my pages" });
			expect(
				calls(read).map(({ call, decision }) => ({
					decision,
					kind: call.kind,
					approval: call.requiresApproval,
				})),
			).toEqual([{ kind: "tool", decision: null, approval: false }]);
			expect(calls(read)[0]?.result).toMatchObject({ truncated: false, value: { error: null } });
			expect(stableStringify(read.turns.items[0]?.messages.items)).toContain("No pages yet.");
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
			const publish = executeRyotQLRecipe(client, pagesRecipe, {}).pipe(
				Effect.map((pages) => ({
					name: "page_publish",
					arguments: { expectedDraftRevision: 1, pageId: pages.items[0]?.id ?? "missing" },
				})),
			);
			const user = yield* startAssistantProvider(
				scripted([
					{ arguments: payload, name: "page_write" },
					{ text: "Draft ready." },
					publish,
					{ text: "Decision handled." },
					publish,
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
					publish,
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
			yield* submit("Draft a page");
			const drafted = yield* finished();
			expect(pendingCall(drafted)).toBeNull();
			expect(
				(yield* executeRyotQLRecipe(client, pagesRecipe, {})).items.map((page) => ({
					name: page.name,
					publishedRevision: page.publishedRevision,
				})),
			).toEqual([{ name: "Approved draft", publishedRevision: null }]);
			for (const decision of ["decline", "approve"] as const) {
				yield* submit(`Publish the draft: ${decision}`);
				const pending = yield* pollUntil("stored approval", detail.pipe(Effect.map(pendingCall)));
				assert(pending.call.kind === "tool", "Publishing is a model tool call");
				expect(pending.call.tool).toBe("page_publish");
				expect(
					(yield* executeRyotQLRecipe(client, assistantConversationsRecipe, {})).items.find(
						(item) => item.id === conversationId,
					)?.status,
				).toBe("awaiting-approval");
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
					(yield* executeRyotQLRecipe(client, pagesRecipe, {})).items.map(
						(page) => page.publishedRevision,
					),
				).toEqual([decision === "decline" ? null : 1]);
			}
			yield* submit("Delete the page");
			const write = yield* pollUntil(
				"pending capability write",
				detail.pipe(
					Effect.map(
						(value) =>
							calls(value).find(
								(call) => call.call.kind === "capability" && call.decision === null,
							) ?? null,
					),
				),
			);
			assert(write.call.kind === "capability", "The pending write is a capability call");
			expect(write.call.capability).toMatchObject({
				title: "Delete page",
				id: kernelCapabilityId("pages.delete"),
			});
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
			const stopped = yield* submit("Publish it again");
			const waiting = yield* pollUntil("approval to stop", detail.pipe(Effect.map(pendingCall)));
			yield* client.call((api) =>
				api.assistant.interrupt({ payload: { conversationId, turnId: stopped.turnId } }),
			);
			const settled = yield* finished();
			const interrupted = settled.turns.items.find((turn) => turn.id === stopped.turnId);
			expect(interrupted?.status).toBe("interrupted");
			expect(interrupted?.calls.items.find((call) => call.id === waiting.id)?.result).toEqual({
				truncated: false,
				value: { interrupted: true },
			});
			yield* client.call((api) =>
				api.assistant.renameConversation({ payload: { conversationId, title: "Page chores" } }),
			);
			expect((yield* detail).conversation).toMatchObject({ status: "idle", title: "Page chores" });
			expect(instance.requests).toHaveLength(2);
			expect(user.requests).toHaveLength(9);
			expect(user.requests[0]?.headers.authorization).toBe("Bearer user-test-key");
			expect(stableStringify(user.requests[0]?.body)).toContain('"model":"user-model"');
			yield* client.call((api) => api.assistant.deleteProvider());
			expect(yield* client.call((api) => api.assistant.providerMetadata())).toMatchObject({
				source: "instance",
			});
		}),
);
