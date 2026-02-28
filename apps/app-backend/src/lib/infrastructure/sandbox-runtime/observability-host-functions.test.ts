import { expect, it } from "@effect/vitest";
import { UserId } from "@ryot/contract/schema/brands";
import { hostSuccess } from "@ryot/sandbox-sdk/wire";
import { Effect, Layer, Logger, Option, Tracer, type Exit, References } from "effect";
import type { Logger as LoggerType } from "effect/Logger";
import { describe } from "vitest";

import { SANDBOX_LIMITS } from "./limits";
import {
	makeObservabilitySandboxApiFunctions,
	makeSandboxObservabilityCollector,
	mergeSandboxExecutionLogs,
} from "./observability-host-functions";
import { runSandboxBridgeHostFunction } from "./runtime";
import { selectSandboxHostFunctions } from "./service";
import type { BoundHostFunction, SandboxRunInput } from "./shared";

type CapturedLog = {
	options: Parameters<LoggerType<unknown, unknown>["log"]>[0];
	annotations: Readonly<Record<string, unknown>>;
};
const selectedHostFunction: BoundHostFunction = () => Effect.succeed(null);

const input: SandboxRunInput = {
	context: {},
	metadata: {},
	contentHash: "",
	providerId: null,
	compiledCode: "",
	compiledFormat: 1,
	scriptId: "script-1",
	executionId: "execution-1",
	allowedHostFunctions: ["log", "span"],
	authority: { type: "user", userId: UserId.make("user-1") },
};

const makeTracer = (spans: Tracer.Span[]) =>
	Tracer.make({
		span: ({ name, parent, annotations, links, startTime, kind, sampled }) => {
			let status: Tracer.SpanStatus = { _tag: "Started", startTime };
			const attributes = new Map<string, unknown>();
			const span: Tracer.Span = {
				name,
				kind,
				links,
				parent,
				annotations,
				attributes,
				_tag: "Span",
				sampled,
				spanId: `span-${spans.length + 1}`,
				addLinks: () => undefined,
				attribute: (key, value) => attributes.set(key, value),
				event: () => undefined,
				get status() {
					return status;
				},
				end: (endTime, exit: Exit.Exit<unknown, unknown>) => {
					status = { _tag: "Ended", startTime, endTime, exit };
				},
				traceId: parent.pipe(
					Option.map((value) => value.traceId),
					Option.getOrElse(() => "trace-1"),
				),
			};
			spans.push(span);
			return span;
		},
	});

describe("sandbox observability host functions", () => {
	it("selects log and span only when explicitly allowed", () => {
		const bound = { log: selectedHostFunction, span: selectedHostFunction };

		expect(
			selectSandboxHostFunctions(bound, {
				metadata: {},
				allowedHostFunctions: [],
				authority: { type: "system" },
			}),
		).toEqual({});
		expect(
			selectSandboxHostFunctions(bound, {
				metadata: {},
				authority: { type: "system" },
				allowedHostFunctions: ["log", "unknown"],
			}),
		).toEqual({ log: selectedHostFunction });
	});

	it("serializes deterministically and merges entries after console logs", () => {
		const collector = makeSandboxObservabilityCollector();

		expect(
			collector.record("log", [
				{
					level: "info",
					message: "ready",
					attributes: { z: 1, a: { y: true, b: "value" } },
				},
			]),
		).toBeNull();
		expect(collector.record("span", [{ name: "provider.run" }])).toBeNull();
		expect(mergeSandboxExecutionLogs(["console"], collector)).toEqual([
			"console",
			'{"attributes":{"a":{"b":"value","y":true},"z":1},"kind":"log","level":"info","message":"ready"}',
			'{"kind":"span","name":"provider.run"}',
		]);
	});

	it("shares count limits across capabilities and repeated calls", () => {
		const collector = makeSandboxObservabilityCollector();
		const spans = Array.from({ length: SANDBOX_LIMITS.observability.entryCount - 1 }, () => ({
			name: "item",
		}));

		expect(collector.record("span", spans)).toBeNull();
		expect(collector.record("log", [{ level: "debug", message: "last" }])).toBeNull();
		const before = [...collector.logs];
		expect(collector.record("span", [{ name: "overflow" }])).toContain("500");
		expect(collector.logs).toEqual(before);
	});

	it("rejects per-entry and cumulative overflow atomically using UTF-8 bytes", () => {
		const entryCollector = makeSandboxObservabilityCollector();
		expect(
			entryCollector.record("log", [
				{ level: "info", message: "accepted" },
				{ level: "error", message: "🙂".repeat(SANDBOX_LIMITS.observability.entryBytes / 4) },
			]),
		).toContain("8192 UTF-8 bytes");
		expect(entryCollector.logs).toEqual([]);

		const totalCollector = makeSandboxObservabilityCollector();
		let error: string | null = null;
		for (let index = 0; error === null; index += 1) {
			error =
				index % 2 === 0
					? totalCollector.record("log", [
							{ level: "warning", message: "entry", attributes: { payload: "a".repeat(7_900) } },
						])
					: totalCollector.record("span", [
							{ name: "entry", attributes: { payload: "a".repeat(7_900) } },
						]);
		}
		const before = [...totalCollector.logs];
		expect(error).toContain("262144 UTF-8 bytes");
		expect(totalCollector.record("span", [])).toBeNull();
		expect(totalCollector.logs).toEqual(before);
	});

	it.effect(
		"emits correlated structured logs and completed child spans under the execution trace",
		() => {
			const spans: Tracer.Span[] = [];
			const logEntries: CapturedLog[] = [];
			const collector = makeSandboxObservabilityCollector();
			const host = makeObservabilitySandboxApiFunctions(collector);
			const logger = Logger.make<unknown, void>((options) =>
				logEntries.push({
					options,
					annotations: options.fiber.getRef(References.CurrentLogAnnotations),
				}),
			);
			const tracer = makeTracer(spans);

			return Effect.gen(function* () {
				const parentSpan = yield* Effect.currentSpan;
				const log: BoundHostFunction = () =>
					host
						.log(input, [
							{
								level: "warning",
								message: "plugin warning",
								attributes: { plugin: "media", executionId: "plugin-value" },
							},
						])
						.pipe(Effect.map(hostSuccess));
				const span: BoundHostFunction = () =>
					host
						.span(input, [
							{ name: "provider.run", attributes: { plugin: "media", scriptId: "plugin-value" } },
						])
						.pipe(Effect.map(hostSuccess));

				yield* runSandboxBridgeHostFunction(log, [], {
					parentSpan,
					fnName: "log",
					executionId: input.executionId,
				});
				yield* runSandboxBridgeHostFunction(span, [], {
					parentSpan,
					fnName: "span",
					executionId: input.executionId,
				});
			}).pipe(
				Effect.withSpan("sandbox.execution"),
				Effect.provide(
					Layer.mergeAll(
						Layer.succeed(Tracer.Tracer, tracer),
						Layer.succeed(References.MinimumLogLevel, "Debug"),
						Logger.layer([logger, Logger.tracerLogger]),
					),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						const warning = logEntries.find(
							({ options }) => String(options.message) === "plugin warning",
						);
						expect(warning?.options.logLevel).toBe("Warn");
						expect(warning?.annotations).toMatchObject({
							plugin: "media",
							scriptId: input.scriptId,
							executionId: input.executionId,
						});

						const execution = spans.find((span) => span.name === "sandbox.execution");
						const hostLog = spans.find((span) => span.name === "sandbox.host.log");
						const hostSpan = spans.find((span) => span.name === "sandbox.host.span");
						const pluginSpan = spans.find((span) => span.name === "provider.run");
						expect(hostLog?.parent.pipe(Option.getOrUndefined)).toBe(execution);
						expect(hostSpan?.parent.pipe(Option.getOrUndefined)).toBe(execution);
						expect(pluginSpan?.parent.pipe(Option.getOrUndefined)).toBe(hostSpan);
						expect(pluginSpan?.status._tag).toBe("Ended");
						expect(Object.fromEntries(pluginSpan?.attributes ?? [])).toMatchObject({
							plugin: "media",
							scriptId: input.scriptId,
							executionId: input.executionId,
						});
					}),
				),
			);
		},
	);
});
