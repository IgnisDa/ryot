import type { ContractPayload } from "@ryot-app/contract/client";
import { PageWriteInput } from "@ryot-app/contract/schema/agent-tool";
import { assistantConversationRecipe } from "@ryot-app/ryotql-recipes/assistant";
import { pagesRecipe } from "@ryot-app/ryotql-recipes/pages";
import { publicationsRecipe } from "@ryot-app/ryotql-recipes/publications";
import { randomUuid } from "@ryot-app/testing/random";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, Schema } from "effect";
import { Playwright, PlaywrightSpawner } from "effect-playwright";

import { startAssistantProvider } from "~/fixtures/kernel/assistant-provider";
import { createAuthenticatedClient } from "~/fixtures/kernel/auth";
import { pollUntil } from "~/fixtures/kernel/polling";
import { executeRyotQLRecipe } from "~/fixtures/kernel/ryotql";
import { signInThroughHostedOAuth } from "~/support/browser";
import { assert, expect, it } from "~/support/effect-test";
import { getFrontendUrl } from "~/support/harness-target";

const definition = (source: string): ContractPayload<"pageAuthoring", "create">["definition"] => ({
	pluginDependencies: {},
	entry: "client/page.tsx",
	queries: { queries: {} },
	files: [{ path: "client/page.tsx", content: Buffer.from(source).toString("base64") }],
});

it.live(
	"repairs a generated page, previews it inline, saves and shares a snapshot, then reloads history",
	() =>
		Effect.gen(function* () {
			const { email, client, password } = yield* createAuthenticatedClient();
			const slug = `recap-${yield* randomUuid}`;
			const good = definition(
				"export default function Page() { return <h2>Acceptance recap</h2>; }",
			);
			const bad = definition("export default function Page() { return <h2>Broken; }");
			let round = 0;
			const provider = yield* startAssistantProvider(() =>
				Effect.gen(function* () {
					const step = round++;
					if (step === 0) {
						return {
							name: "page_write",
							arguments: yield* Schema.encodeEffect(Schema.toCodecJson(PageWriteInput))({
								slug,
								definition: bad,
								name: "Generated recap",
							}),
						};
					}
					if (step === 1) {
						const pages = yield* executeRyotQLRecipe(client, pagesRecipe, {});
						const page = pages.items.find((item) => item.slug === slug);
						assert(page !== undefined, "Approved draft should exist before the repair round");
						return {
							name: "page_write",
							arguments: yield* Schema.encodeEffect(Schema.toCodecJson(PageWriteInput))({
								pageId: page.id,
								definition: good,
								expectedDraftRevision: 1,
							}),
						};
					}
					return { text: "Your recap is ready to preview and save." };
				}),
			);
			yield* client.call((api) =>
				api.assistant.configureProvider({
					payload: { model: "local", baseUrl: `${provider.url}/v1` },
				}),
			);
			const { conversationId } = yield* client.call((api) =>
				api.assistant.createConversation({ payload: { title: "Recap acceptance" } }),
			);
			const detail = executeRyotQLRecipe(client, assistantConversationRecipe, { conversationId });
			const browser = yield* Playwright.Browser;
			const owner = yield* browser.newPage();
			yield* signInThroughHostedOAuth(owner, email, password);
			yield* owner.goto(`${getFrontendUrl()}/assistant?conversationId=${conversationId}`);
			yield* owner.getByRole("textbox", { name: "Message Ryobot" }).fill("Build my recap page");
			yield* owner.getByRole("button", { exact: true, name: "Send" }).click();
			for (const step of ["create", "repair"]) {
				const pending = yield* pollUntil(
					`approval for the ${step} page_write`,
					detail.pipe(
						Effect.map(
							(value) =>
								value.calls.items.find(
									(call) =>
										call.decision === null && call.result === null && call.call.requiresApproval,
								) ?? null,
						),
					),
				);
				assert(pending.call.kind === "tool", "Page writes are model tool calls");
				expect(pending.call.tool).toBe("page_write");
				if (step === "create") {
					expect((yield* executeRyotQLRecipe(client, pagesRecipe, {})).items).toEqual([]);
				}
				yield* owner.getByRole("button", { exact: true, name: "Approve" }).click();
				yield* pollUntil(
					"approval recorded",
					detail.pipe(
						Effect.map((value) =>
							value.calls.items.find((call) => call.id === pending.id)?.decision === "approve"
								? true
								: null,
						),
					),
				);
			}
			const complete = yield* pollUntil(
				"recap completion",
				detail.pipe(
					Effect.map((value) =>
						value.turns.items.every((turn) => turn.status === "completed") ? value : null,
					),
				),
			);
			expect(complete.calls.items).toHaveLength(2);
			expect(stableStringify(complete.calls.items[0]?.result)).toContain("build-failed");
			expect(stableStringify(provider.requests[1]?.body)).toContain("build-failed");
			yield* owner
				.locator("iframe")
				.contentFrame()
				.getByRole("heading", { name: "Acceptance recap" })
				.waitFor({ state: "visible" });
			yield* owner.getByRole("textbox", { exact: true, name: "Page name" }).fill("Saved recap");
			yield* owner.getByRole("textbox", { exact: true, name: "Page address" }).fill(slug);
			yield* owner.getByRole("button", { name: "Save page and view" }).click();
			yield* owner.getByRole("link", { name: "Open saved page" }).waitFor({ state: "visible" });
			expect(
				(yield* executeRyotQLRecipe(client, pagesRecipe, {})).items.map((page) => ({
					writeAccess: page.writeAccess,
					publishedRevision: page.publishedRevision,
				})),
			).toEqual([{ writeAccess: false, publishedRevision: 2 }]);
			yield* owner.getByRole("button", { exact: true, name: "Share" }).click();
			yield* owner.getByRole("textbox", { exact: true, name: "Title" }).fill("Snapshot recap");
			yield* owner.getByRole("button", { name: /^Mode:/ }).click();
			yield* owner.getByRole("radio", { exact: true, name: "Snapshot" }).click();
			yield* owner.getByRole("button", { exact: true, name: "Publish" }).click();
			const publication = yield* pollUntil(
				"snapshot publication",
				executeRyotQLRecipe(client, publicationsRecipe, {}).pipe(
					Effect.map(
						(value) => value.items.find((item) => item.title === "Snapshot recap") ?? null,
					),
				),
			);
			expect(publication.definition.mode).toBe("snapshot");
			const share = owner.getByRole("link", { exact: true, name: "Share" });
			expect(yield* share.getAttribute("href")).toBe(
				`/settings/publications#publication-${publication.id}`,
			);
			yield* share.click();
			const card = owner.locator(`#publication-${publication.id}`);
			yield* card.getByRole("button", { exact: true, name: "New link" }).click();
			yield* card.getByRole("textbox", { name: "Who is it for?" }).fill("Acceptance visitor");
			yield* card.getByRole("button", { exact: true, name: "Create link" }).click();
			const link = card.getByRole("textbox", { exact: true, name: "New link" });
			yield* link.waitFor({ state: "visible" });
			const visitorUrl = yield* link.inputValue();
			expect(visitorUrl).toContain(`/share/${publication.id}#`);
			expect((yield* executeRyotQLRecipe(client, publicationsRecipe, {})).items).toHaveLength(1);
			const visitor = yield* browser.newPage();
			yield* visitor.goto(visitorUrl);
			yield* visitor
				.locator("iframe")
				.contentFrame()
				.getByRole("heading", { name: "Acceptance recap" })
				.waitFor({ state: "visible" });
			yield* owner.goto(`${getFrontendUrl()}/assistant?conversationId=${conversationId}`);
			yield* owner.reload;
			yield* owner
				.getByText("Your recap is ready to preview and save.", { exact: true })
				.waitFor({ state: "visible" });
			yield* owner
				.locator("iframe")
				.contentFrame()
				.getByRole("heading", { name: "Acceptance recap" })
				.waitFor({ state: "visible" });
			expect((yield* detail).calls.items.map((call) => call.decision)).toEqual([
				"approve",
				"approve",
			]);
			expect(provider.requests).toHaveLength(3);
		}).pipe(PlaywrightSpawner.withBrowser),
);
