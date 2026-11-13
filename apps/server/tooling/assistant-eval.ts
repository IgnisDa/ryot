#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { type ContractProgram, makeContractClient } from "@ryot-app/contract/client";
import { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import type { AgentToolName } from "@ryot-app/contract/schema/agent-tool";
import { type CapabilityId, kernelCapabilityId } from "@ryot-app/contract/schema/capability";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import type { Recipe } from "@ryot-app/ryotql";
import {
	type AssistantConversationDetail,
	assistantConversationRecipe,
} from "@ryot-app/ryotql-recipes/assistant";
import { pagesRecipe } from "@ryot-app/ryotql-recipes/pages";
import {
	Clock,
	Config,
	DateTime,
	Duration,
	Effect,
	FileSystem,
	Layer,
	Option,
	Redacted,
	Schedule,
	Schema,
} from "effect";
import { FetchHttpClient } from "effect/http";

type EvalTask = Expectations & { readonly name: string; readonly prompt: string };
type Expectations = {
	readonly tools?: readonly AgentToolName[];
	readonly capabilities?: readonly CapabilityId[];
	readonly page?: { readonly slug: string; readonly state: "draft" | "absent" | "published" };
};

const tasks: readonly EvalTask[] = [
	{ name: "overview", tools: ["search"], prompt: "What kinds of my data can you work with?" },
	{
		name: "plugins",
		tools: ["search"],
		prompt: "Which plugins do I have installed, and what can each of them do?",
	},
	{
		name: "pages-list",
		tools: ["execute"],
		prompt: "List my pages.",
		capabilities: [kernelCapabilityId("pages.list")],
	},
	{
		tools: ["execute"],
		name: "collections",
		prompt: "How many collections do I have? Name them.",
		capabilities: [kernelCapabilityId("collections.list")],
	},
	{
		tools: ["execute"],
		name: "saved-views-list",
		prompt: "Show my saved views.",
		capabilities: [kernelCapabilityId("saved-views.list")],
	},
	{
		tools: ["execute"],
		name: "describe-data",
		capabilities: [kernelCapabilityId("data.describe")],
		prompt: "Which entity types do I have, and which properties does each one carry?",
	},
	{
		tools: ["execute"],
		name: "count-by-schema",
		capabilities: [kernelCapabilityId("query")],
		prompt: "How many entities of each type do I have?",
	},
	{
		tools: ["execute"],
		name: "recent-entities",
		prompt: "What are the three entities I updated most recently?",
	},
	{
		tools: ["execute"],
		name: "recent-events",
		prompt: "What are the five most recent events I logged, with their dates?",
	},
	{
		tools: ["execute"],
		name: "plugin-query",
		prompt: "Use one of my plugins' own queries to summarize something useful about my data.",
	},
	{
		name: "docs",
		tools: ["read_docs"],
		prompt: "How do I show a chart on a Ryot page? Answer from the documentation.",
	},
	{
		tools: ["execute"],
		name: "unknown-capability",
		prompt:
			"Call the capability kernel:does.not.exist with an empty input and report what happens.",
	},
	{
		tools: ["execute"],
		name: "saved-view-create",
		capabilities: [kernelCapabilityId("saved-views.create")],
		prompt: "Create a saved view named 'Eval recent' that lists my most recently updated entities.",
	},
	{
		tools: ["execute"],
		name: "saved-view-delete",
		prompt: "Delete the saved view named 'Eval recent'.",
		capabilities: [kernelCapabilityId("saved-views.delete")],
	},
	{
		name: "page-create",
		tools: ["page_write"],
		page: { state: "draft", slug: "eval-hello" },
		prompt:
			"Create a page named 'Eval hello' with slug 'eval-hello' that shows the heading 'Hello from Ryobot'.",
	},
	{
		name: "page-edit",
		tools: ["page_write"],
		page: { state: "draft", slug: "eval-hello" },
		prompt: "Change the 'Eval hello' page so it also shows today's date below the heading.",
	},
	{
		name: "page-publish",
		tools: ["page_publish"],
		prompt: "Publish the 'Eval hello' page.",
		page: { slug: "eval-hello", state: "published" },
	},
	{
		name: "page-data",
		tools: ["page_write"],
		page: { state: "draft", slug: "eval-stats" },
		prompt:
			"Create a page named 'Eval stats' with slug 'eval-stats' that shows a table of how many entities I have of each type.",
	},
	{
		tools: ["execute"],
		name: "page-delete",
		page: { state: "absent", slug: "eval-hello" },
		capabilities: [kernelCapabilityId("pages.delete")],
		prompt: "Delete my pages 'Eval hello' and 'Eval stats'.",
	},
	{
		tools: ["execute"],
		name: "unpublished-pages",
		prompt: "Which of my pages have draft changes that are not published yet?",
	},
];

const EvalConfig = Config.all({
	apiKey: Config.Redacted("RYOT_EVAL_API_KEY"),
	apiUrl: Config.NonEmptyString("RYOT_EVAL_API_URL"),
	only: Config.option(Config.NonEmptyString("RYOT_EVAL_ONLY")),
	provider: Config.option(
		Config.all({
			model: Config.NonEmptyString("SERVER_ASSISTANT_MODEL"),
			baseUrl: Config.NonEmptyString("SERVER_ASSISTANT_BASE_URL"),
			apiKey: Config.option(Config.NonEmptyString("SERVER_ASSISTANT_API_KEY")),
		}),
	),
});

const terminal = new Set(["failed", "completed", "interrupted"]);

const failedResult = (result: unknown) =>
	typeof result === "object" &&
	result !== null &&
	"value" in result &&
	typeof result.value === "object" &&
	result.value !== null &&
	"error" in result.value &&
	result.value.error !== null;

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const config = yield* EvalConfig;
	const call = <A, E>(contract: ContractProgram<A, E>) =>
		makeContractClient(config.apiUrl, { "x-api-key": Redacted.value(config.apiKey) }).pipe(
			Effect.flatMap(contract),
		);
	const recipe = <Success, const Parameters extends AppSchema>(
		definition: Recipe<Success, Parameters>,
		arguments_: NoInfer<Recipe.Arguments<Recipe<Success, Parameters>>>,
	) =>
		Effect.gen(function* () {
			const payload = yield* Schema.decodeEffect(ExecutionRequest)({
				arguments: arguments_,
				source: {
					kind: "inline",
					document: definition.document,
					...(definition.query === undefined ? {} : { query: definition.query }),
				},
			});
			const response = yield* call((api) => api.ryotql.execute({ payload }));
			return yield* Effect.fromResult(definition.decode(response));
		}).pipe(Effect.orDie);

	if (Option.isSome(config.provider)) {
		const { model, apiKey, baseUrl } = config.provider.value;
		yield* call((api) =>
			api.assistant.configureProvider({
				payload: {
					model,
					baseUrl,
					...Option.match(apiKey, { onNone: () => ({}), onSome: (key) => ({ apiKey: key }) }),
				},
			}),
		);
	}
	const metadata = yield* call((api) => api.assistant.providerMetadata());
	if (metadata === null) {
		yield* Effect.logError("The eval account has no assistant provider.");
		return;
	}
	const stale = yield* recipe(pagesRecipe, {});
	for (const page of stale.items.filter((item) => item.slug.startsWith("eval-"))) {
		yield* call((api) => api.pageAuthoring.delete({ payload: { pageId: page.id } }));
	}

	const selected = Option.match(config.only, {
		onNone: () => tasks,
		onSome: (names) => tasks.filter((task) => names.split(",").includes(task.name)),
	});
	const runTask = Effect.fn("assistantEval.runTask")(function* (task: EvalTask) {
		const started = yield* Clock.currentTimeMillis;
		const { conversationId } = yield* call((api) =>
			api.assistant.submit({ payload: { text: task.prompt, requestId: crypto.randomUUID() } }),
		);
		let approvals = 0;
		const polled: null | AssistantConversationDetail = yield* recipe(assistantConversationRecipe, {
			conversationId,
		}).pipe(
			Effect.flatMap((detail) => {
				const pending = detail.turns.items
					.flatMap((turn) => turn.calls.items)
					.find(
						(item) => item.call.requiresApproval && item.decision === null && item.result === null,
					);
				if (pending !== undefined) {
					approvals += 1;
					return call((api) =>
						api.assistant.decide({
							payload: {
								conversationId,
								decision: "approve",
								turnId: pending.turnId,
								toolCallId: pending.id,
								expectedRevision: pending.revision,
							},
						}),
					).pipe(Effect.as(null));
				}
				return Effect.succeed(
					detail.turns.items.every((turn) => terminal.has(turn.status)) ? detail : null,
				);
			}),
			Effect.repeat({
				until: (detail) => detail !== null,
				schedule: Schedule.spaced(Duration.seconds(1)),
			}),
			Effect.timeout(Duration.minutes(5)),
		);
		if (polled === null) {
			return yield* Effect.die(new Error("The turn did not settle"));
		}
		const settled = polled;
		const turn = settled.turns.items[0];
		const calls = turn?.calls.items ?? [];
		const used = new Set(
			calls.flatMap(({ call: item }) => (item.kind === "tool" ? [item.tool] : [])),
		);
		const succeeded = new Set(
			calls.flatMap(({ result, call: item }) =>
				item.kind === "capability" && result !== null && !failedResult(result)
					? [item.capability.id]
					: [],
			),
		);
		const misses = [
			...(turn?.status === "completed" ? [] : [`turn ${turn?.status ?? "missing"}`]),
			...(task.tools ?? []).filter((tool) => !used.has(tool)).map((tool) => `no ${tool}`),
			...(task.capabilities ?? [])
				.filter((id) => !succeeded.has(id))
				.map((id) => `no successful ${id}`),
		];
		if (task.page !== undefined) {
			const { slug, state } = task.page;
			const page = (yield* recipe(pagesRecipe, {})).items.find((item) => item.slug === slug);
			const compiled = page?.draftCompiledRevision === page?.draftRevision;
			const draft = compiled ? "draft" : "uncompiled";
			const published = page?.publishedRevision === null ? draft : "published";
			const actual = page === undefined ? "absent" : published;
			if (actual !== state) {
				misses.push(`page ${slug} ${actual}`);
			}
		}
		const answer = (turn?.messages.items ?? [])
			.filter((message) => message.role === "assistant")
			.flatMap((message) =>
				message.parts.flatMap((part) => (part.kind === "text" ? [part.text] : [])),
			)
			.join("\n");
		return {
			misses,
			answer,
			approvals,
			conversationId,
			name: task.name,
			passed: misses.length === 0,
			failure: turn?.failure?.code ?? null,
			seconds: Math.round(((yield* Clock.currentTimeMillis) - started) / 1000),
			toolCalls: calls.filter(({ call: item }) => item.kind === "tool").length,
			capabilityCalls: calls.filter(({ call: item }) => item.kind === "capability").length,
			failedCalls: calls.filter(({ result }) => result !== null && failedResult(result)).length,
		};
	});

	const results = [];
	for (const task of selected) {
		const result = yield* runTask(task).pipe(
			Effect.catchCause((cause) =>
				Effect.succeed({
					answer: "",
					seconds: 0,
					approvals: 0,
					toolCalls: 0,
					passed: false,
					failure: null,
					failedCalls: 0,
					name: task.name,
					capabilityCalls: 0,
					conversationId: null,
					misses: [`eval error: ${String(cause)}`],
				}),
			),
		);
		yield* Effect.log(
			`${result.passed ? "PASS" : "FAIL"} ${task.name} ${result.misses.join(", ")}`,
		);
		results.push(result);
	}
	const passed = results.filter((result) => result.passed).length;
	const report = {
		passed,
		results,
		model: metadata.model,
		total: results.length,
		source: metadata.source,
	};
	const now = DateTime.formatIso(yield* DateTime.now);
	const output = Bun.fileURLToPath(
		new URL(`../tmp/assistant-eval-${now.replaceAll(":", "-")}.json`, import.meta.url),
	);
	yield* fs.makeDirectory(Bun.fileURLToPath(new URL("../tmp", import.meta.url)), {
		recursive: true,
	});
	yield* fs.writeFileString(
		output,
		yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(report),
	);
	console.table(
		results.map(
			({
				name,
				misses,
				seconds,
				toolCalls,
				approvals,
				passed: ok,
				failedCalls,
				capabilityCalls,
			}) => ({
				ok,
				name,
				seconds,
				toolCalls,
				approvals,
				failedCalls,
				capabilityCalls,
				misses: misses.join(", "),
			}),
		),
	);
	yield* Effect.log(`${metadata.model}: ${passed}/${results.length} passed; report ${output}`);
});

BunRuntime.runMain(
	program.pipe(Effect.provide(Layer.mergeAll(FetchHttpClient.layer, BunServices.layer))),
);
