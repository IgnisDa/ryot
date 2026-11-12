import { expect } from "bun:test";

import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import type {
	DecideAssistantToolCallBody,
	SaveAssistantPageBody,
} from "@ryot-app/contract/modules/assistant/schemas";
import { AssistantError } from "@ryot-app/contract/modules/assistant/schemas";
import {
	AssistantConversationId,
	AssistantToolCallId,
	AssistantTurnId,
	PublicationId,
	SavedViewId,
} from "@ryot-app/contract/schema/brands";
import { CapabilityId } from "@ryot-app/contract/schema/capability";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { assistantConversationRecipe } from "@ryot-app/ryotql-recipes/assistant";
import { pageRecipe } from "@ryot-app/ryotql-recipes/pages";
import { recipeResponse, rowsResult } from "@ryot-app/ryotql-recipes/test-utils";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect, Layer, Schema } from "effect";

import { AssistantApi } from "#/api/assistant";
import { AuthenticatedApiError } from "#/api/authenticated";
import { makePublicationsApi } from "#/api/ports.test-layer";
import { mountHostedTestScreen } from "#/host-screen.test-support";

import { AssistantApprovalCard, AssistantConversations } from "./conversation";
import { AssistantPageActions } from "./page-actions";
import { AssistantProviderForm } from "./provider";
import { assistantFailureText } from "./service";

const conversationId = AssistantConversationId.make("conversation");
const turnId = AssistantTurnId.make("turn");
const toolCallId = AssistantToolCallId.make("call");
const unused = () => Effect.die("Unexpected assistant API call");
const assistantLayer = (overrides: Partial<AssistantApi["Service"]>) =>
	Layer.succeed(AssistantApi, {
		submit: unused,
		decide: unused,
		savePage: unused,
		deleteProvider: unused,
		providerMetadata: unused,
		configureProvider: unused,
		createConversation: unused,
		deleteConversation: unused,
		...overrides,
	});
const call = {
	turnId,
	revision: 4,
	result: null,
	id: toolCallId,
	decision: null,
	call: {
		kind: "tool",
		arguments: {},
		id: toolCallId,
		tool: "page_write",
		requiresApproval: true,
		modelCallId: "model-call",
	},
} satisfies Parameters<typeof AssistantApprovalCard>[0]["call"];
const capabilityCall = {
	...call,
	call: {
		arguments: {},
		hostCallIndex: 0,
		kind: "capability",
		parentId: toolCallId,
		requiresApproval: true,
		id: AssistantToolCallId.make("write-call"),
		capability: {
			input: {},
			output: {},
			source: { kind: "kernel" },
			description: "Review the latest change",
			id: CapabilityId.make("kernel:saved-views.update"),
			hints: { readOnly: false, idempotent: false, destructive: false },
		},
	},
} satisfies Parameters<typeof AssistantApprovalCard>[0]["call"];

for (const decision of ["approve", "decline"] as const) {
	it.live(
		`sends the canonical call revision when users ${decision}`,
		() =>
			Effect.gen(function* () {
				const decisions: DecideAssistantToolCallBody[] = [];
				const view = mountHostedTestScreen(
					<AssistantApprovalCard
						turnActive
						call={call}
						disabled={false}
						conversationId={conversationId}
					/>,
					{
						query: () => Effect.succeed({ data: {} }),
						layer: assistantLayer({
							decide: (_scope, request) =>
								Effect.sync(() => {
									decisions.push(request.payload);
									return { turnId, conversationId };
								}),
						}),
					},
				);
				try {
					fireEvent.click(
						yield* Effect.promise(() =>
							screen.findByRole("button", { name: decision === "approve" ? "Approve" : "Decline" }),
						),
					);
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(decisions).toEqual([
								{ turnId, decision, toolCallId, conversationId, expectedRevision: 4 },
							]),
						),
					);
				} finally {
					yield* Effect.promise(view.dispose);
				}
			}),
		testTimeout,
	);
}

it.live(
	"disables approval controls in demo sessions",
	() =>
		Effect.gen(function* () {
			const decisions: unknown[] = [];
			const view = mountHostedTestScreen(
				<AssistantApprovalCard disabled turnActive call={call} conversationId={conversationId} />,
				{
					query: () => Effect.succeed({ data: {} }),
					layer: assistantLayer({
						decide: (_scope, request) =>
							Effect.sync(() => {
								decisions.push(request.payload);
								return { turnId, conversationId };
							}),
					}),
				},
			);
			try {
				const approve = yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Approve" }),
				);
				expect(approve.hasAttribute("disabled")).toBe(true);
				expect(screen.getByRole("button", { name: "Decline" }).hasAttribute("disabled")).toBe(true);
				fireEvent.click(approve);
				expect(decisions).toEqual([]);
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);

it.live(
	"directs users without a provider to setup and prevents starting a chat",
	() =>
		Effect.gen(function* () {
			const view = mountHostedTestScreen(
				<AssistantConversations selected={null} disabled={false} onSelect={() => undefined} />,
				{
					layer: assistantLayer({ providerMetadata: () => Effect.succeed(null) }),
					query: () =>
						Effect.succeed({
							data: {
								conversations: {
									items: [],
									type: "rows",
									pageInfo: { limit: 20, hasMore: false, nextCursor: null },
								},
							},
						}),
				},
			);
			try {
				const setup = yield* Effect.promise(() =>
					screen.findByRole("link", { name: "Settings → Ryobot" }),
				);
				expect(setup.getAttribute("href")).toBe("/settings/assistant");
				expect(
					screen.getByRole("button", { name: "New conversation" }).hasAttribute("disabled"),
				).toBe(true);
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);

it.live(
	"prevents provider changes in demo sessions",
	() =>
		Effect.gen(function* () {
			const view = mountHostedTestScreen(<AssistantProviderForm disabled />, {
				query: () => Effect.succeed({ data: {} }),
				layer: assistantLayer({ providerMetadata: () => Effect.succeed(null) }),
			});
			try {
				yield* Effect.promise(() => screen.findByText("No provider configured."));
				expect(
					screen.getByRole("textbox", { name: "Base URL" }).closest("fieldset")?.disabled,
				).toBe(true);
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);

it.live("names typed provider, stale approval and demo failures", () =>
	Effect.sync(() => {
		expect(
			assistantFailureText(
				new AuthenticatedApiError({
					cause: new AssistantError({ reason: { code: "provider-unavailable" } }),
				}),
			),
		).toContain("Settings → Ryobot");
		expect(
			assistantFailureText(
				new AuthenticatedApiError({
					cause: new AssistantError({ reason: { code: "revision-stale" } }),
				}),
			),
		).toContain("Refresh the conversation");
		expect(
			assistantFailureText(
				new AuthenticatedApiError({
					cause: new DemoOperationProtected({ reason: { code: "demo-operation-protected" } }),
				}),
			),
		).toContain("demo sessions");
	}),
);

it.live(
	"loads current messages and approval requests beyond the first hundred rows",
	() =>
		Effect.gen(function* () {
			const firstPage = { limit: 100, hasMore: true, nextCursor: "next" };
			const lastPage = { limit: 100, hasMore: false, nextCursor: null };
			const createdAt = "2026-11-01T00:00:00.000Z";
			const view = mountHostedTestScreen(
				<AssistantConversations
					disabled={false}
					selected={conversationId}
					onSelect={() => undefined}
				/>,
				{
					layer: assistantLayer({
						providerMetadata: () =>
							Effect.succeed({
								model: "test",
								hasApiKey: true,
								source: "instance",
								baseUrl: "https://provider.example/v1",
							}),
					}),
					query: (request) => {
						const after = (name: string) =>
							Object.entries(request.pages ?? {}).find(([key]) => key === name)?.[1].after;
						const messagesAfter = after("messages");
						const callsAfter = after("calls");
						const turnsAfter = after("turns");
						const messages = messagesAfter
							? [
									{
										turnId,
										createdAt,
										sequence: 101,
										role: "assistant",
										id: "last-message",
										parts: [{ kind: "text", text: "Latest reply" }],
									},
								]
							: Array.from({ length: 100 }, (_, i) => ({
									turnId,
									createdAt,
									sequence: i,
									role: "assistant",
									id: `message-${i}`,
									parts: [{ kind: "text", text: `Earlier reply ${i}` }],
								}));
						const calls = callsAfter
							? [capabilityCall]
							: Array.from({ length: 100 }, (_, i) => ({
									...call,
									id: `old-call-${i}`,
									decision: "decline",
								}));
						const turn = {
							round: 1,
							createdAt,
							id: turnId,
							revision: 4,
							failure: null,
							completedAt: null,
							requestId: "request",
							status: "awaiting-approval",
						};
						const turns = turnsAfter
							? [turn]
							: Array.from({ length: 100 }, (_, i) => ({
									...turn,
									id: `old-turn-${i}`,
									status: "completed",
									completedAt: createdAt,
								}));
						return Effect.succeed(
							recipeResponse(assistantConversationRecipe, {
								calls: rowsResult(calls, callsAfter ? lastPage : firstPage),
								turns: rowsResult(turns, turnsAfter ? lastPage : firstPage),
								messages: rowsResult(messages, messagesAfter ? lastPage : firstPage),
								conversation: rowsResult(
									[
										{
											createdAt,
											revision: 4,
											id: conversationId,
											updatedAt: createdAt,
											title: "Long conversation",
										},
									],
									lastPage,
								),
							}),
						);
					},
				},
			);
			try {
				yield* Effect.promise(() => screen.findByText("Latest reply"));
				yield* Effect.promise(() => screen.findByText("Review the latest change"));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(
							false,
						),
					),
				);
				expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);

it.live(
	"retries the identical atomic page save and shares its saved page as a snapshot",
	() =>
		Effect.gen(function* () {
			const saves: SaveAssistantPageBody[] = [];
			const publications: unknown[] = [];
			const identity = {
				draftRevision: 2,
				pageId: "draft-page",
				artifactHash: "artifact",
				definitionHash: "definition",
			};
			const now = "2026-11-01T00:00:00.000Z";
			const view = mountHostedTestScreen(
				<AssistantPageActions
					ready
					turnId={turnId}
					disabled={false}
					identity={identity}
					conversationId={conversationId}
				/>,
				{
					layer: Layer.mergeAll(
						assistantLayer({
							savePage: (_scope, request) =>
								Effect.gen(function* () {
									saves.push(request.payload);
									if (saves.length === 1) {
										return yield* new AuthenticatedApiError({ cause: "connection lost" });
									}
									return { pageId: "saved-page", savedViewId: SavedViewId.make("saved-view") };
								}),
						}),
						makePublicationsApi({
							create: (_scope, request) =>
								Effect.sync(() => {
									publications.push(request.payload);
									return { revision: 1, publicationId: PublicationId.make("publication") };
								}),
						}),
					),
					query: () =>
						Effect.succeed(
							recipeResponse(pageRecipe, {
								page: rowsResult(
									[
										{
											createdAt: now,
											updatedAt: now,
											id: "saved-page",
											name: "Overview",
											slug: "overview",
											draftRevision: 2,
											writeAccess: false,
											origin: "assistant",
											authorityRevision: 2,
											publishedRevision: 2,
											draftCompiledRevision: 2,
											draftArtifactHash: "artifact",
											draftDefinitionHash: "definition",
											publishedArtifactHash: "artifact",
											publishedDefinitionHash: "definition",
											draftDefinition: {
												files: [],
												entry: "index.tsx",
												pluginDependencies: {},
												queries: { queries: {} },
											},
											publishedDefinition: {
												files: [],
												entry: "index.tsx",
												pluginDependencies: {},
												queries: { queries: {} },
											},
										},
									],
									{ limit: 1, hasMore: false, nextCursor: null },
								),
							}),
						),
				},
			);
			try {
				fireEvent.change(
					yield* Effect.promise(() => screen.findByRole("textbox", { name: "Page name" })),
					{ target: { value: "Overview" } },
				);
				fireEvent.change(screen.getByRole("textbox", { name: "Page address" }), {
					target: { value: "overview" },
				});
				fireEvent.click(screen.getByRole("button", { name: "Save page and view" }));
				yield* Effect.promise(() =>
					screen.findByText("Ryobot could not complete this request. Try again."),
				);
				expect(screen.getByRole("textbox", { name: "Page name" }).hasAttribute("disabled")).toBe(
					true,
				);
				fireEvent.click(screen.getByRole("button", { name: "Save page and view" }));
				const share = yield* Effect.promise(() => screen.findByRole("button", { name: "Share" }));
				expect(saves).toHaveLength(2);
				expect(saves[1]).toEqual(saves[0]);
				expect(saves[0]).toMatchObject({
					...identity,
					turnId,
					conversationId,
					name: "Overview",
					slug: "overview",
				});
				expect(screen.getByRole("link", { name: "Open saved page" }).getAttribute("href")).toBe(
					"/v/c/saved-view",
				);
				fireEvent.click(share);
				fireEvent.change(
					yield* Effect.promise(() => screen.findByRole("textbox", { name: "Title" })),
					{ target: { value: "Shared overview" } },
				);
				fireEvent.click(screen.getByRole("button", { name: /^Mode:/ }));
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("radio", { name: "Snapshot" })),
				);
				fireEvent.click(screen.getByRole("button", { name: "Publish" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(publications).toEqual([
							{
								arguments: {},
								mode: "snapshot",
								description: null,
								icon: "file-text",
								showOwnerName: false,
								title: "Shared overview",
								page: { kind: "page", pageId: "saved-page" },
							},
						]),
					),
				);
				const manage = yield* Effect.promise(() =>
					screen.findByRole("link", { name: "Manage sharing links" }),
				);
				expect(manage.getAttribute("href")).toBe("/settings/publications#publication-publication");
				expect(screen.getByRole("link", { name: "Share" }).getAttribute("href")).toBe(
					manage.getAttribute("href"),
				);
				fireEvent.click(screen.getByRole("link", { name: "Share" }));
				fireEvent.click(screen.getByRole("link", { name: "Share" }));
				expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
				expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
				expect(publications).toHaveLength(1);
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);

for (const rejected of [
	{ name: "Overview", slug: "invalid address" },
	{ name: "   ", slug: "overview" },
]) {
	it.live(
		`edits rejected page details (${rejected.slug}, ${JSON.stringify(rejected.name)}) with a new request`,
		() =>
			Effect.gen(function* () {
				const saves: SaveAssistantPageBody[] = [];
				const view = mountHostedTestScreen(
					<AssistantPageActions
						ready
						turnId={turnId}
						disabled={false}
						conversationId={conversationId}
						identity={{
							pageId: "draft",
							draftRevision: 2,
							artifactHash: "artifact",
							definitionHash: "definition",
						}}
					/>,
					{
						query: () => Effect.succeed({ data: {} }),
						layer: assistantLayer({
							savePage: (_scope, request) =>
								Effect.gen(function* () {
									saves.push(request.payload);
									if (saves.length === 1) {
										return yield* new AuthenticatedApiError({
											cause: new AssistantError({ reason: { code: "page-save-failed" } }),
										});
									}
									return { pageId: "saved", savedViewId: SavedViewId.make("view") };
								}),
						}),
					},
				);
				try {
					fireEvent.change(
						yield* Effect.promise(() => screen.findByRole("textbox", { name: "Page name" })),
						{ target: { value: rejected.name } },
					);
					fireEvent.change(screen.getByRole("textbox", { name: "Page address" }), {
						target: { value: rejected.slug },
					});
					fireEvent.click(screen.getByRole("button", { name: "Save page and view" }));
					fireEvent.click(
						yield* Effect.promise(() => screen.findByRole("button", { name: "Edit details" })),
					);
					expect(screen.getByRole("textbox", { name: "Page name" }).hasAttribute("disabled")).toBe(
						false,
					);
					expect(
						screen.getByRole("textbox", { name: "Page address" }).hasAttribute("disabled"),
					).toBe(false);
					fireEvent.change(screen.getByRole("textbox", { name: "Page name" }), {
						target: { value: "Valid overview" },
					});
					fireEvent.change(screen.getByRole("textbox", { name: "Page address" }), {
						target: { value: "valid-overview" },
					});
					fireEvent.click(screen.getByRole("button", { name: "Save page and view" }));
					yield* Effect.promise(() => screen.findByRole("link", { name: "Open saved page" }));
					expect(saves).toHaveLength(2);
					expect(saves[0]).toMatchObject(rejected);
					expect(saves[1]).toMatchObject({ name: "Valid overview", slug: "valid-overview" });
					expect(saves[1]?.requestId).not.toBe(saves[0]?.requestId);
				} finally {
					yield* Effect.promise(view.dispose);
				}
			}),
		testTimeout,
	);
}

it.live(
	"shows the stored write intent and all long source text before approval",
	() =>
		Effect.gen(function* () {
			const source = `${"// source\n".repeat(1100)}ryot.call("remove", { id: "last-target" });`;
			const args = { code: source, readOnly: true, page: { content: btoa(source) } };
			const decisions: DecideAssistantToolCallBody[] = [];
			const view = mountHostedTestScreen(
				<AssistantApprovalCard
					turnActive
					disabled={false}
					conversationId={conversationId}
					call={{ ...call, call: { ...call.call, arguments: args } }}
				/>,
				{
					query: () => Effect.succeed({ data: {} }),
					layer: assistantLayer({
						decide: (_scope, request) =>
							Effect.sync(() => {
								decisions.push(request.payload);
								return { turnId, conversationId };
							}),
					}),
				},
			);
			try {
				expect(yield* Effect.promise(() => screen.findByText("page_write"))).toBeDefined();
				yield* Effect.promise(() => screen.findByLabelText("Exact call arguments"));
				expect(screen.getByText("readOnly")).toBeDefined();
				expect(screen.getByText("true")).toBeDefined();

				let inspected = screen.getByLabelText("Exact call arguments").textContent;
				while (!screen.getByRole("button", { name: "Next arguments" }).hasAttribute("disabled")) {
					fireEvent.click(screen.getByRole("button", { name: "Next arguments" }));
					inspected += screen.getByLabelText("Exact call arguments").textContent;
				}
				expect(yield* Schema.decodeEffect(Schema.fromJsonString(JsonValue))(inspected)).toEqual(
					args,
				);
				fireEvent.click(screen.getByRole("button", { name: "Decode base64 text" }));
				let decoded = screen.getByLabelText("Arguments with decoded text").textContent;
				while (!screen.getByRole("button", { name: "Next arguments" }).hasAttribute("disabled")) {
					fireEvent.click(screen.getByRole("button", { name: "Next arguments" }));
					decoded += screen.getByLabelText("Arguments with decoded text").textContent;
				}
				expect(decoded).toContain("last-target");
				expect(decoded).not.toContain(btoa(source));
				expect(decisions).toEqual([]);
				fireEvent.click(screen.getByRole("button", { name: "Approve" }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(decisions).toEqual([
							{ turnId, toolCallId, conversationId, decision: "approve", expectedRevision: 4 },
						]),
					),
				);
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);

it.live(
	"shows read-only arguments without approval controls",
	() =>
		Effect.gen(function* () {
			const view = mountHostedTestScreen(
				<AssistantApprovalCard
					turnActive
					disabled={false}
					conversationId={conversationId}
					call={{
						...call,
						call: {
							...call.call,
							requiresApproval: false,
							arguments: { query: "<script>do not execute</script>" },
						},
					}}
				/>,
				{ layer: assistantLayer({}), query: () => Effect.succeed({ data: {} }) },
			);
			try {
				yield* Effect.promise(() => screen.findByLabelText("Exact call arguments"));
				expect(screen.getByLabelText("Exact call arguments").textContent).toContain(
					"<script>do not execute</script>",
				);
				expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
				expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);
