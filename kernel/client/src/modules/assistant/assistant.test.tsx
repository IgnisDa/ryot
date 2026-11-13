import { expect } from "bun:test";

import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import type {
	AnswerAssistantQuestionBody,
	AssistantToolCall,
	DecideAssistantToolCallBody,
	InterruptAssistantTurnBody,
	SaveAssistantPageBody,
	SubmitAssistantTurnBody,
} from "@ryot-app/contract/modules/assistant/schemas";
import { AssistantError } from "@ryot-app/contract/modules/assistant/schemas";
import {
	AssistantConversationId,
	AssistantToolCallId,
	AssistantTurnId,
	PluginId,
	PluginPackageId,
	SavedViewId,
} from "@ryot-app/contract/schema/brands";
import { CapabilityId } from "@ryot-app/contract/schema/capability";
import type {
	AssistantCallRecord,
	AssistantTranscriptTurn,
} from "@ryot-app/ryotql-recipes/assistant";
import type { PluginClientCatalog } from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { makeAssistantApi } from "#/api/ports.test-layer";
import { mountHostedTestScreen } from "#/host-screen.test-support";

import { AssistantApproval } from "./approval";
import { AssistantComposer, useAssistantSubmit } from "./composer";
import { AssistantPageSave } from "./page-draft";
import { assistantStarters, stepDetail } from "./presentation";
import { AssistantProviderForm } from "./provider";
import { AssistantQuestion } from "./question";
import { assistantFailureText } from "./service";
import { AssistantTurn } from "./turn";

const conversationId = AssistantConversationId.make("conversation");
const turnId = AssistantTurnId.make("turn");
const empty = () => Effect.succeed({ data: {} });
const catalog: PluginClientCatalog = [
	{
		sortOrder: 0,
		isHidden: false,
		health: "ready",
		scope: "system",
		name: "Fitness",
		icon: "dumbbell",
		homeSavedView: null,
		clientApiVersion: 1,
		contentHash: "hash",
		clientEntities: null,
		installationId: "installation",
		pluginId: PluginId.make("fitness"),
		packageId: PluginPackageId.make("ryot/fitness"),
		assistantStarters: ["Summarize my workouts this week"],
	},
	{
		icon: "film",
		sortOrder: 1,
		name: "Media",
		isHidden: true,
		health: "ready",
		scope: "system",
		homeSavedView: null,
		clientApiVersion: 1,
		contentHash: "hash",
		clientEntities: null,
		installationId: "hidden",
		pluginId: PluginId.make("media"),
		assistantStarters: ["Hidden starter"],
		packageId: PluginPackageId.make("ryot/media"),
	},
];
const write: AssistantToolCall = {
	hostCallIndex: 0,
	kind: "capability",
	requiresApproval: true,
	parentId: AssistantToolCallId.make("execute"),
	id: AssistantToolCallId.make("execute:write:0"),
	arguments: { occurredAt: "2026-11-13T08:10:00Z", values: [{ value: 78.4, metricId: "weight" }] },
	capability: {
		title: "Log measurement",
		output: { type: "object" },
		description: "Record measurement values at a supplied time.",
		hints: { readOnly: false, idempotent: false, destructive: false },
		id: CapabilityId.make("ryot/fitness:operations/measurement-reading-log"),
		input: {
			type: "object",
			properties: {
				occurredAt: { type: "string", title: "Taken" },
				values: { type: "array", items: { type: "object" } },
			},
		},
		source: {
			kind: "operation",
			contentHash: "hash",
			revisionId: "revision",
			configRevisionId: "config",
			installationId: "installation",
			operationSlug: "measurement-reading-log",
			packageId: PluginPackageId.make("ryot/fitness"),
		},
	},
};
const record: AssistantCallRecord = {
	turnId,
	call: write,
	revision: 4,
	result: null,
	id: write.id,
	decision: null,
};

for (const decision of ["approve", "decline"] as const) {
	it.live(
		`describes a plugin write and sends the canonical call revision when users ${decision}`,
		() =>
			Effect.gen(function* () {
				const decisions: DecideAssistantToolCallBody[] = [];
				const view = mountHostedTestScreen(
					<AssistantApproval
						call={record}
						state="pending"
						disabled={false}
						catalog={catalog}
						conversationId={conversationId}
					/>,
					{
						query: empty,
						layer: makeAssistantApi({
							decide: (_scope, request) =>
								Effect.sync(() => {
									decisions.push(request.payload);
									return { turnId, conversationId };
								}),
						}),
					},
				);
				try {
					const card = yield* Effect.promise(() =>
						screen.findByRole("region", { name: "Approve Log measurement" }),
					);
					expect(within(card).getByText(/^Fitness · /)).toBeDefined();
					expect(within(card).getByText("Taken")).toBeDefined();
					expect(within(card).getByText("2026-11-13T08:10:00Z")).toBeDefined();
					expect(within(card).queryByLabelText("Raw input")).toBeNull();
					fireEvent.click(within(card).getByRole("button", { name: "Show raw input" }));
					expect(within(card).getByLabelText("Raw input").textContent).toContain('"value": 78.4');
					fireEvent.click(
						within(card).getByRole("button", {
							name: decision === "approve" ? "Approve" : "Decline",
						}),
					);
					yield* Effect.promise(() =>
						waitFor(() =>
							expect(decisions).toEqual([
								{ turnId, decision, conversationId, expectedRevision: 4, toolCallId: write.id },
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
	"disables approval controls in demo sessions and shows settled decisions without controls",
	() =>
		Effect.gen(function* () {
			const view = mountHostedTestScreen(
				<>
					<AssistantApproval
						disabled
						call={record}
						state="pending"
						catalog={catalog}
						conversationId={conversationId}
					/>
					<AssistantApproval
						state="declined"
						disabled={false}
						catalog={catalog}
						conversationId={conversationId}
						call={{ ...record, decision: "decline" }}
					/>
				</>,
				{ query: empty, layer: makeAssistantApi() },
			);
			try {
				const approve = yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Approve" }),
				);
				expect(approve.hasAttribute("disabled")).toBe(true);
				expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
				expect(screen.getByText("Declined")).toBeDefined();
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);

it.live(
	"renders a finished turn as the prompt, a collapsed step trail and a formatted reply",
	() =>
		Effect.gen(function* () {
			const turn: AssistantTranscriptTurn = {
				id: turnId,
				failure: null,
				queued: [],
				partial: false,
				status: "completed",
				prompt: "How is my bench press?",
				createdAt: "2026-11-13T10:00:00.000Z",
				completedAt: "2026-11-13T10:00:12.000Z",
				entries: [
					{
						id: "steps",
						kind: "steps",
						steps: [
							{
								id: "search",
								kind: "tool",
								tool: "search",
								status: "done",
								arguments: { namespace: "ryot/fitness" },
							},
							{ id: "think", kind: "reasoning", text: "Compare monthly bests" },
						],
					},
					{ id: "reply", kind: "reply", text: "## Progress\n\nUp **7%** since August." },
				],
			};
			const view = mountHostedTestScreen(
				<AssistantTurn
					turn={turn}
					disabled={false}
					catalog={catalog}
					conversationId={conversationId}
				/>,
				{ query: empty, layer: makeAssistantApi() },
			);
			try {
				expect(
					yield* Effect.promise(() => screen.findByText("How is my bench press?")),
				).toBeDefined();
				expect(screen.getByRole("heading", { name: "Progress" })).toBeDefined();
				expect(screen.getByText("7%").tagName).toBe("STRONG");
				const trail = screen.getByRole("button", { name: /Worked for 12 s · 2 steps/ });
				expect(trail.getAttribute("aria-expanded")).toBe("false");
				expect(screen.queryByText("Searched capabilities")).toBeNull();
				fireEvent.click(trail);
				expect(
					yield* Effect.promise(() => screen.findByText("Searched capabilities")),
				).toBeDefined();
				expect(screen.getByText("Compare monthly bests")).toBeDefined();
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);

function NewChatComposer(props: { readonly onSubmitted: (id: string) => void }) {
	const submit = useAssistantSubmit({ onSubmitted: props.onSubmitted });
	return <AssistantComposer submit={submit} disabled={false} placeholder="Message Ryo" />;
}

it.live(
	"sends on Enter, keeps Shift+Enter for new lines and retries a failed message with its request",
	() =>
		Effect.gen(function* () {
			const submissions: SubmitAssistantTurnBody[] = [];
			const created: string[] = [];
			const view = mountHostedTestScreen(
				<NewChatComposer onSubmitted={(id) => created.push(id)} />,
				{
					query: empty,
					layer: makeAssistantApi({
						submit: (_scope, request) =>
							Effect.gen(function* () {
								submissions.push(request.payload);
								if (submissions.length === 1) {
									return yield* new AuthenticatedApiError({ cause: "connection lost" });
								}
								return { turnId, conversationId };
							}),
					}),
				},
			);
			try {
				const input = yield* Effect.promise(() =>
					screen.findByRole("textbox", { name: "Message Ryo" }),
				);
				fireEvent.change(input, { target: { value: "Summarize my week" } });
				fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
				expect(submissions).toEqual([]);
				fireEvent.keyDown(input, { key: "Enter" });
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: "Retry message" })),
				);
				yield* Effect.promise(() => waitFor(() => expect(created).toEqual([conversationId])));
				expect(submissions).toHaveLength(2);
				expect(submissions[1]).toEqual(submissions[0]);
				expect(submissions[0]).toMatchObject({ text: "Summarize my week" });
				expect(submissions[0]?.conversationId).toBeUndefined();
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);

it.live(
	"replaces Send with Stop while a turn is working",
	() =>
		Effect.gen(function* () {
			const stops: InterruptAssistantTurnBody[] = [];
			function Working() {
				const submit = useAssistantSubmit({ conversationId });
				return (
					<AssistantComposer
						submit={submit}
						disabled={false}
						placeholder="Reply"
						stop={{ pending: false, onStop: () => stops.push({ turnId, conversationId }) }}
					/>
				);
			}
			const view = mountHostedTestScreen(<Working />, { query: empty, layer: makeAssistantApi() });
			try {
				fireEvent.click(yield* Effect.promise(() => screen.findByRole("button", { name: "Stop" })));
				expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
				expect(stops).toEqual([{ turnId, conversationId }]);
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);

const identity = {
	draftRevision: 2,
	pageId: "draft-page",
	artifactHash: "artifact",
	definitionHash: "definition",
};

it.live(
	"derives the page address from its name and retries the identical save",
	() =>
		Effect.gen(function* () {
			const saves: SaveAssistantPageBody[] = [];
			const navigations: string[] = [];
			const view = mountHostedTestScreen(
				<AssistantPageSave
					turnId={turnId}
					disabled={false}
					identity={identity}
					name="Training volume"
					conversationId={conversationId}
					onNavigate={(href) => navigations.push(href)}
				/>,
				{
					query: empty,
					layer: makeAssistantApi({
						savePage: (_scope, request) =>
							Effect.gen(function* () {
								saves.push(request.payload);
								if (saves.length === 1) {
									return yield* new AuthenticatedApiError({ cause: "connection lost" });
								}
								return { pageId: "saved-page", savedViewId: SavedViewId.make("saved-view") };
							}),
					}),
				},
			);
			try {
				const address = yield* Effect.promise(() =>
					screen.findByRole("textbox", { name: "Page address" }),
				);
				expect(address).toHaveProperty("value", "training-volume");
				fireEvent.click(screen.getByRole("button", { name: "Save page" }));
				yield* Effect.promise(() =>
					screen.findByText("Ryo could not complete this request. Try again."),
				);
				expect(screen.getByRole("textbox", { name: "Page name" }).hasAttribute("disabled")).toBe(
					true,
				);
				fireEvent.click(screen.getByRole("button", { name: "Save page" }));
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: "Open page" })),
				);
				expect(navigations).toEqual(["/v/c/saved-view"]);
				expect(saves).toHaveLength(2);
				expect(saves[1]).toEqual(saves[0]);
				expect(saves[0]).toMatchObject({
					...identity,
					turnId,
					conversationId,
					name: "Training volume",
					slug: "training-volume",
				});
			} finally {
				yield* Effect.promise(view.dispose);
			}
		}),
	testTimeout,
);

it.live(
	"edits rejected page details with a new request",
	() =>
		Effect.gen(function* () {
			const saves: SaveAssistantPageBody[] = [];
			const view = mountHostedTestScreen(
				<AssistantPageSave
					name="Overview"
					turnId={turnId}
					disabled={false}
					identity={identity}
					onNavigate={() => undefined}
					conversationId={conversationId}
				/>,
				{
					query: empty,
					layer: makeAssistantApi({
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
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: "Save page" })),
				);
				fireEvent.click(
					yield* Effect.promise(() => screen.findByRole("button", { name: "Edit details" })),
				);
				fireEvent.change(screen.getByRole("textbox", { name: "Page address" }), {
					target: { value: "valid-overview" },
				});
				fireEvent.click(screen.getByRole("button", { name: "Save page" }));
				yield* Effect.promise(() => screen.findByRole("button", { name: "Open page" }));
				expect(saves).toHaveLength(2);
				expect(saves[0]).toMatchObject({ name: "Overview", slug: "overview" });
				expect(saves[1]).toMatchObject({ name: "Overview", slug: "valid-overview" });
				expect(saves[1]?.requestId).not.toBe(saves[0]?.requestId);
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
				query: empty,
				layer: makeAssistantApi({ providerMetadata: () => Effect.succeed(null) }),
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

it.live("offers starters from visible plugins and labels search steps by their target", () =>
	Effect.sync(() => {
		expect(assistantStarters(catalog)).toEqual([
			{ source: "Fitness", text: "Summarize my workouts this week" },
			{ source: "Pages", text: "Build a page that summarizes my recent activity" },
		]);
		expect(
			stepDetail({
				id: "search",
				kind: "tool",
				tool: "search",
				status: "done",
				arguments: { query: "", namespace: "ryot/media" },
			}),
		).toBe("ryot/media");
	}),
);

it.live(
	"answers a question with chosen options and its own words",
	() =>
		Effect.gen(function* () {
			const answers: AnswerAssistantQuestionBody[] = [];
			const asked: AssistantToolCall = {
				kind: "tool",
				tool: "question",
				modelCallId: "model",
				requiresApproval: false,
				id: AssistantToolCallId.make("ask"),
				arguments: {},
			};
			const view = mountHostedTestScreen(
				<AssistantQuestion
					disabled={false}
					conversationId={conversationId}
					entry={{
						id: "ask",
						answers: null,
						state: "pending",
						kind: "question",
						call: { ...record, call: asked, id: asked.id },
						questions: [
							{ question: "Which charts?", multiple: true, options: ["Weight", "Steps"] },
							{ question: "What title?" },
						],
					}}
				/>,
				{
					query: empty,
					layer: makeAssistantApi({
						answer: (_scope, request) =>
							Effect.sync(() => {
								answers.push(request.payload);
								return { turnId, conversationId };
							}),
					}),
				},
			);
			try {
				const send = yield* Effect.promise(() =>
					screen.findByRole("button", { name: "Send answers" }),
				);
				fireEvent.click(screen.getByLabelText("Weight"));
				fireEvent.click(screen.getByLabelText("Steps"));
				fireEvent.change(screen.getByRole("textbox", { name: "Which charts?" }), {
					target: { value: "and sleep" },
				});
				expect(send.hasAttribute("disabled")).toBe(true);
				fireEvent.change(screen.getByRole("textbox", { name: "What title?" }), {
					target: { value: "Health" },
				});
				fireEvent.click(send);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(answers).toEqual([
							{
								turnId,
								conversationId,
								toolCallId: asked.id,
								answers: ["Weight, Steps, and sleep", "Health"],
							},
						]),
					),
				);
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
		).toContain("Settings → Ryo");
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
