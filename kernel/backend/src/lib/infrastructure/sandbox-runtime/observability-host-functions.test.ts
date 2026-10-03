import { describe, expect, it, layer } from "@effect/vitest";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import { hostSuccess } from "@ryot-app/sandbox-sdk/wire";
import {
	Context,
	Effect,
	Layer,
	Logger,
	MutableRef,
	Option,
	Ref,
	References,
	Tracer,
} from "effect";
import type { Logger as LoggerType } from "effect/Logger";

import { makeRecordingTracer } from "#lib/test-utils/tracer";

import { hostCallArgs } from "./host-call-args.test-support";
import { SandboxHostCallGate } from "./host-call-gate";
import { SANDBOX_LIMITS } from "./limits";
import {
	makeObservabilitySandboxApiFunctions,
	makeSandboxObservabilityCollector,
	mergeSandboxExecutionLogs,
} from "./observability-host-functions";
import { selectSandboxHostFunctions } from "./service";
import type { BoundHostFunction, SandboxRunInput } from "./shared";

type CapturedLog = {
	options: Parameters<LoggerType<unknown, unknown>["log"]>[0];
	annotations: Readonly<Record<string, unknown>>;
};

class RecordedTelemetry extends Context.Service<
	RecordedTelemetry,
	{
		readonly spans: Effect.Effect<ReadonlyArray<Tracer.Span>>;
		readonly logs: Effect.Effect<ReadonlyArray<CapturedLog>>;
	}
>()("test/RecordedTelemetry") {}

const recordedTelemetryLayer = Layer.unwrap(
	Effect.gen(function* () {
		const spans: Tracer.Span[] = [];
		const logs = yield* Ref.make<ReadonlyArray<CapturedLog>>([]);
		const logger = Logger.make<unknown, void>((options) =>
			MutableRef.update(logs.ref, (all) => [
				...all,
				{ options, annotations: options.fiber.getRef(References.CurrentLogAnnotations) },
			]),
		);
		return Layer.mergeAll(
			Layer.succeed(RecordedTelemetry, {
				logs: Ref.get(logs),
				spans: Effect.sync(() => [...spans]),
			}),
			Layer.succeed(Tracer.Tracer, makeRecordingTracer(spans)),
			Layer.succeed(References.MinimumLogLevel, "Debug"),
			Logger.layer([logger, Logger.tracerLogger]),
		);
	}),
);

const selectedHostFunction: BoundHostFunction = () => Effect.succeed(null);

const input: SandboxRunInput = {
	context: {},
	compiledCode: "",
	compiledFormat: 1,
	lane: "interactive",
	executionId: "execution-1",
	principal: {
		contentHash: "",
		providerId: null,
		scriptSlug: "script",
		pluginRevision: null,
		scriptId: SandboxScriptId.make("script-1"),
		metadata: { runtimeImports: [], capabilities: ["log", "span"] },
		subject: {
			type: "user",
			userId: UserId.make("user-1"),
			accountGeneration: { userId: UserId.make("user-1"), token: "test-account-generation" },
		},
	},
};

const makeLogHostFunction =
	(host: ReturnType<typeof makeObservabilitySandboxApiFunctions>): BoundHostFunction =>
	() =>
		host
			.log(input, [
				{
					level: "warning",
					message: "plugin warning",
					attributes: { plugin: "example", executionId: "plugin-value" },
				},
			])
			.pipe(Effect.map(hostSuccess));

const makeSpanHostFunction =
	(host: ReturnType<typeof makeObservabilitySandboxApiFunctions>): BoundHostFunction =>
	() =>
		host
			.span(input, [
				{ name: "provider.run", attributes: { plugin: "example", scriptId: "plugin-value" } },
			])
			.pipe(Effect.map(hostSuccess));

describe("sandbox observability host functions", () => {
	it("selects log and span only when explicitly allowed", () => {
		const bound = { log: selectedHostFunction, span: selectedHostFunction };

		expect(
			selectSandboxHostFunctions(bound, {
				principal: {
					...input.principal,
					subject: { type: "system" },
					metadata: { runtimeImports: [] },
				},
			}),
		).toEqual({});
		expect(
			selectSandboxHostFunctions(bound, {
				principal: {
					...input.principal,
					subject: { type: "system" },
					metadata: { runtimeImports: [], capabilities: ["log", "unknown"] },
				},
			}),
		).toEqual({ log: selectedHostFunction });
	});

	it("serializes deterministically and merges entries after console logs", () => {
		const collector = makeSandboxObservabilityCollector();

		expect(
			collector.record("log", [
				{ level: "info", message: "ready", attributes: { z: 1, a: { y: true, b: "value" } } },
			]),
		).toBeNull();
		expect(collector.record("span", [{ name: "provider.run" }])).toBeNull();
		expect(mergeSandboxExecutionLogs(["console token=console-secret"], collector)).toEqual([
			"console token=[REDACTED]",
			'{"attributes":{"a":{"b":"value","y":true},"z":1},"kind":"log","level":"info","message":"ready"}',
			'{"kind":"span","name":"provider.run"}',
		]);
	});

	it("redacts credential-shaped attributes recursively", () => {
		const collector = makeSandboxObservabilityCollector();

		expect(
			collector.record("log", [
				{
					level: "info",
					message: "request complete authorization=Bearer message-secret",
					attributes: {
						apiKey: "api-secret",
						request: { status: 200, authorization: "Bearer secret" },
					},
				},
			]),
		).toBeNull();
		expect(collector.record("span", [{ name: "provider token=span-secret" }])).toBeNull();
		expect(collector.logs).toEqual([
			'{"attributes":{"apiKey":"[REDACTED]","request":{"authorization":"[REDACTED]","status":200}},"kind":"log","level":"info","message":"request complete authorization=[REDACTED]"}',
			'{"kind":"span","name":"provider token=[REDACTED]"}',
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

	layer(Layer.mergeAll(recordedTelemetryLayer, SandboxHostCallGate.layer))((test) => {
		test.effect(
			"emits correlated structured logs and completed child spans under the execution trace",
			() =>
				Effect.gen(function* () {
					const collector = makeSandboxObservabilityCollector();
					const host = makeObservabilitySandboxApiFunctions(collector);

					yield* Effect.gen(function* () {
						const parentSpan = yield* Effect.currentSpan;
						const log = makeLogHostFunction(host);
						const span = makeSpanHostFunction(host);

						yield* Effect.scoped(
							Effect.gen(function* () {
								const gate = yield* SandboxHostCallGate;
								const registration = yield* gate.register({
									input,
									parentSpan,
									generation: 1,
									handle: "telemetry",
									instance: "user/core",
									apiFunctions: { log, span },
									files: {
										harvest: () => Effect.succeed(null),
										scratchWrite: () => Effect.succeed(null),
										filesystem: { scratch: false, artifact: false, namedArtifacts: [] },
										artifactReadRange: (args) =>
											Effect.succeed({ size: 0, data: "", offset: args.offset }),
									},
								});
								yield* Effect.gen(function* () {
									for (const [seq, name] of ["log", "span"].entries()) {
										const result = yield* registration.dispatch({
											seq,
											name,
											generation: 1,
											type: "hostCall",
											handle: "telemetry",
											args: hostCallArgs([]),
										});
										expect(result.result).toMatchObject({
											status: "success",
											value: { success: true },
										});
									}
								}).pipe(Effect.withSpan("sidecar.transport"));
							}),
						);
					}).pipe(Effect.withSpan("sandbox.execution"));

					const telemetry = yield* RecordedTelemetry;
					const logEntries = yield* telemetry.logs;
					const spans = yield* telemetry.spans;
					const warning = logEntries.find(
						({ options }) => String(options.message) === "plugin warning",
					);
					expect(warning?.options.logLevel).toBe("Warn");
					expect(warning?.annotations).toMatchObject({
						plugin: "example",
						executionId: input.executionId,
						scriptId: input.principal.scriptId,
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
						plugin: "example",
						executionId: input.executionId,
						scriptId: input.principal.scriptId,
					});
				}),
		);
	});
});
