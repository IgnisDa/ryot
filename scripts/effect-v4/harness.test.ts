import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { formatViolation, scanSource } from "./guard";
import { buildJscodeshiftCommand, parseRunnerArgs, prepareRunner } from "./run";
import { discoverSourceFiles, SCOPE_ROOTS, toRepositoryPath } from "./scope";

const temporaryRoots: string[] = [];

const createRoot = async () => {
	const root = await mkdtemp(join(tmpdir(), "ryot-effect-v4-"));
	temporaryRoots.push(root);
	return root;
};

const writeFixture = async (root: string, path: string, source = "export {};\n") => {
	const file = join(root, path);
	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, source);
	return file;
};

afterAll(async () => {
	for (const root of temporaryRoots) await rm(root, { recursive: true, force: true });
});

describe("runner arguments", () => {
	test("requires one mode and a registered transform", () => {
		expect(() => parseRunnerArgs(["noop"])).toThrow("Exactly one mode is required");
		expect(() => parseRunnerArgs(["--dry-run"])).toThrow("A registered transform name is required");
		expect(() => parseRunnerArgs(["noop", "--dry-run", "--write"])).toThrow(
			"modes cannot be combined or repeated",
		);
		expect(() => parseRunnerArgs(["missing", "--dry-run"])).toThrow('Unknown transform "missing"');
		expect(parseRunnerArgs(["--dry-run", "noop", "apps/app-backend/src"])).toMatchObject({
			mode: "dry-run",
			paths: ["apps/app-backend/src"],
			transform: { name: "noop" },
		});
		expect(parseRunnerArgs(["core-renames", "--dry-run"])).toMatchObject({
			mode: "dry-run",
			paths: [],
			transform: { name: "core-renames" },
		});
		expect(parseRunnerArgs(["core-structural", "--dry-run"])).toMatchObject({
			mode: "dry-run",
			paths: [],
			transform: { name: "core-structural" },
		});
		expect(parseRunnerArgs(["runtime-context", "--dry-run"])).toMatchObject({
			mode: "dry-run",
			paths: [],
			transform: { name: "runtime-context" },
		});
	});

	test("rejects zero discovered files before command construction", async () => {
		const root = await createRoot();
		await expect(prepareRunner(["noop", "--dry-run"], root)).rejects.toThrow(
			"No in-scope TypeScript source files discovered",
		);
	});
});

describe("source scope", () => {
	test("discovers only TypeScript sources under exact roots", async () => {
		const root = await createRoot();
		const included = SCOPE_ROOTS.map((scope) => `${scope}/src/index.ts`);
		included.push(
			"apps/app-backend/src/component.tsx",
			"apps/app-backend/src/module.mts",
			"apps/app-backend/src/module.cts",
			"apps/app-backend/src/builders/kept.ts",
		);
		for (const path of included) await writeFixture(root, path);

		const excluded = [
			"apps/app-backend/node_modules/package/index.ts",
			"apps/app-backend/.turbo/cache/index.ts",
			"apps/app-backend/dist/index.ts",
			"apps/app-backend/build/index.ts",
			"apps/app-backend/coverage/index.ts",
			"apps/app-backend/src/runner.generated.ts",
			"apps/app-backend/src/config.js",
			"apps/app-backend/src/data.json",
			"apps/app-client-backup/src/index.ts",
			"apps/frontend/src/index.ts",
			"libs/graphql/src/index.ts",
			"scripts/outside.ts",
		];
		for (const path of excluded) await writeFixture(root, path);

		const discovered = await discoverSourceFiles(root);
		expect(discovered.map((path) => toRepositoryPath(root, path))).toEqual(included.sort());
	});

	test("rejects explicit excluded and out-of-scope paths", async () => {
		const root = await createRoot();
		for (const path of [
			"apps/frontend/src/index.ts",
			"apps/app-backend/dist/index.ts",
			"scripts/outside.ts",
		]) {
			await writeFixture(root, path);
			await expect(discoverSourceFiles(root, [path])).rejects.toThrow(
				"Explicit path is outside Effect v4 scope",
			);
		}
	});

	test("rejects an explicit file reached through an escaping ancestor symlink", async () => {
		const root = await createRoot();
		const outside = await createRoot();
		await writeFixture(outside, "app-backend/index.ts");
		await symlink(outside, join(root, "apps"), "dir");

		await expect(discoverSourceFiles(root, ["apps/app-backend/index.ts"])).rejects.toThrow(
			"Explicit path is outside Effect v4 scope",
		);
		expect(await discoverSourceFiles(root)).toEqual([]);
	});

	test("rejects an explicit directory reached through an escaping ancestor symlink", async () => {
		const root = await createRoot();
		const outside = await createRoot();
		await writeFixture(root, "apps/app-backend/src/index.ts");
		await writeFixture(outside, "nested/index.ts");
		await symlink(outside, join(root, "apps/app-backend/src/escape"), "dir");

		await expect(discoverSourceFiles(root, ["apps/app-backend/src/escape/nested"])).rejects.toThrow(
			"Explicit path is outside Effect v4 scope",
		);
	});

	test("rejects an internal ancestor symlink targeting an excluded directory", async () => {
		const root = await createRoot();
		await writeFixture(root, "apps/app-backend/dist/file.ts");
		await mkdir(join(root, "apps/app-backend/src"), { recursive: true });
		await symlink(
			join(root, "apps/app-backend/dist"),
			join(root, "apps/app-backend/src/alias"),
			"dir",
		);

		await expect(discoverSourceFiles(root, ["apps/app-backend/src/alias/file.ts"])).rejects.toThrow(
			"Explicit path is outside Effect v4 scope",
		);
		expect(await discoverSourceFiles(root)).toEqual([]);
	});

	test("keeps ordinary explicit and discovered files inside scope", async () => {
		const root = await createRoot();
		const outside = await createRoot();
		const file = await writeFixture(root, "apps/app-backend/src/index.ts");
		await writeFixture(outside, "outside.ts");
		await symlink(outside, join(root, "apps/app-backend/src/escape"), "dir");

		expect(await discoverSourceFiles(root, ["apps/app-backend/src/index.ts"])).toEqual([file]);
		expect(await discoverSourceFiles(root, ["apps/app-backend/src"])).toEqual([file]);
		expect(await discoverSourceFiles(root)).toEqual([file]);
	});
});

test("guard reports explicit rules by file and line without scanning strings", async () => {
	const source = [
		'import { Platform } from "@effect/platform";',
		'import { Workflow } from "@effect/workflow/Workflow";',
		'import { Cluster } from "@effect/cluster";',
		'import { Queue } from "@effect/experimental/PersistedQueue";',
		'import { Atom } from "@effect-atom/atom-react";',
		'import { ParseResult as Result } from "effect";',
		'export { ParseResult } from "@ryot/sandbox-sdk/effect";',
		"const service = Effect.Service;",
		"const either = Effect.either;",
		'it.scoped("scope", () => undefined);',
		'it.scopedLive("live", () => undefined);',
		"const catchAll = Effect.catchAll;",
		"const catchAllCause = Effect.catchAllCause;",
		"const zipRight = Effect.zipRight;",
		"const fork = Effect.fork;",
		"const tapErrorCause = Effect.tapErrorCause;",
		"const failureOption = Cause.failureOption;",
		"const interrupted = Cause.isInterrupted;",
		"const interruptedOnly = Cause.isInterruptedOnly;",
		"const exitInterrupted = Exit.isInterrupted;",
		"const unsafeMake = Context.unsafeMake;",
		"const extend = Scope.extend;",
		"const scopedDiscard = Layer.scopedDiscard;",
		"const unwrapEffect = Layer.unwrapEffect;",
		"const scoped = Layer.scoped;",
		"type LegacyServices = Layer.Layer.Context<unknown>;",
		"const dieMessage = Effect.dieMessage;",
		"const ignoreLogged = Effect.ignoreLogged;",
		"const timeoutFail = Effect.timeoutFail;",
		"const orElse = Effect.orElse;",
		"const makeSemaphore = Effect.makeSemaphore;",
		"type LegacySemaphore = Effect.Semaphore;",
		"const optionFromOptional = Effect.optionFromOptional;",
		"const unsandbox = Effect.unsandbox;",
		"const runtime = Effect.runtime;",
		"type LegacyRuntime = Runtime.Runtime<never>;",
		"const runPromise = Runtime.runPromise;",
		"const runPromiseExit = Runtime.runPromiseExit;",
		"const runFork = Runtime.runFork;",
		"const interruptFork = Fiber.interruptFork;",
		"const mapInputContext = Effect.mapInputContext;",
		"const dateLessThan = DateTime.lessThan;",
		"const dateFromDate = DateTime.unsafeFromDate;",
		"const dateMake = DateTime.unsafeMake;",
		"const dateNow = DateTime.unsafeNow;",
		"const deferredDone = Deferred.unsafeDone;",
		"const optionFromNullable = Option.fromNullable;",
		"const streamAs = Stream.as;",
		"const retained = [Effect.as, Effect.orElseSucceed, Match.orElse, Config.orElse, Effect.async, Stream.asyncPush, Stream.map, Layer.effect, Layer.toRuntime, ManagedRuntime.make, BunRuntime.runMain, Atom.runtime, FiberSet.makeRuntime, HttpApi.make, Tracer.make];",
		'const embedded = `import { Workflow } from "@effect/workflow"; Effect.Service; Effect.catchAll; Effect.dieMessage; Effect.timeoutFail; Effect.mapInputContext; Effect.runtime; Runtime.Runtime; Runtime.runPromise; Runtime.runPromiseExit; Runtime.runFork; Fiber.interruptFork; Stream.as; Layer.Layer.Context; DateTime.lessThan; DateTime.unsafeFromDate; DateTime.unsafeMake; DateTime.unsafeNow; Deferred.unsafeDone; Option.fromNullable;`;',
		'import type { ParseResult } from "@ryot/sandbox-sdk/papaparse";',
		'import { TestClock as LegacyTestClock } from "effect";',
		'import { TestClock } from "other-testing";',
		"type LegacySuccess = Effect.Effect.Success<unknown>;",
		"type LegacyError = Effect.Effect.Error<unknown>;",
		"type CurrentEffect = Effect.Effect<unknown>;",
		"type SchemaType = Schema.Schema.Type<unknown>;",
	].join("\n");

	expect((await scanSource("fixture.ts", source)).map(formatViolation)).toEqual([
		"fixture.ts:1: @effect/platform",
		"fixture.ts:2: @effect/workflow",
		"fixture.ts:3: @effect/cluster",
		"fixture.ts:4: @effect/experimental",
		"fixture.ts:5: @effect-atom/atom-react",
		"fixture.ts:6: ParseResult import",
		"fixture.ts:7: ParseResult import",
		"fixture.ts:8: Effect.Service",
		"fixture.ts:9: Effect.either",
		"fixture.ts:10: it.scoped",
		"fixture.ts:11: it.scopedLive",
		"fixture.ts:12: Effect.catchAll",
		"fixture.ts:13: Effect.catchAllCause",
		"fixture.ts:14: Effect.zipRight",
		"fixture.ts:15: Effect.fork",
		"fixture.ts:16: Effect.tapErrorCause",
		"fixture.ts:17: Cause.failureOption",
		"fixture.ts:18: Cause.isInterrupted",
		"fixture.ts:19: Cause.isInterruptedOnly",
		"fixture.ts:20: Exit.isInterrupted",
		"fixture.ts:21: Context.unsafeMake",
		"fixture.ts:22: Scope.extend",
		"fixture.ts:23: Layer.scopedDiscard",
		"fixture.ts:24: Layer.unwrapEffect",
		"fixture.ts:25: Layer.scoped",
		"fixture.ts:26: Layer.Layer.Context",
		"fixture.ts:27: Effect.dieMessage",
		"fixture.ts:28: Effect.ignoreLogged",
		"fixture.ts:29: Effect.timeoutFail",
		"fixture.ts:30: Effect.orElse",
		"fixture.ts:31: Effect.makeSemaphore",
		"fixture.ts:32: Effect.Semaphore",
		"fixture.ts:33: Effect.optionFromOptional",
		"fixture.ts:34: Effect.unsandbox",
		"fixture.ts:35: Effect.runtime",
		"fixture.ts:36: Runtime.Runtime",
		"fixture.ts:37: Runtime.runPromise",
		"fixture.ts:38: Runtime.runPromiseExit",
		"fixture.ts:39: Runtime.runFork",
		"fixture.ts:40: Fiber.interruptFork",
		"fixture.ts:41: Effect.mapInputContext",
		"fixture.ts:42: DateTime.lessThan",
		"fixture.ts:43: DateTime.unsafeFromDate",
		"fixture.ts:44: DateTime.unsafeMake",
		"fixture.ts:45: DateTime.unsafeNow",
		"fixture.ts:46: Deferred.unsafeDone",
		"fixture.ts:47: Option.fromNullable",
		"fixture.ts:48: Stream.as",
		"fixture.ts:52: TestClock import",
		"fixture.ts:54: Effect.Effect.Success",
		"fixture.ts:55: Effect.Effect.Error",
	]);
});

test("guard reports legacy Schema constructor shapes through owned aliases only", async () => {
	const source = [
		'import { Schema as S } from "effect";',
		'import { Schema as SdkSchema } from "@ryot/sandbox-sdk/effect";',
		'import { Schema as WorkflowSchema } from "@ryot/sandbox-sdk/workflow";',
		"const literal = S.Literal(\"a\", \"b\");",
		"const spread = S.Literal(...values);",
		"const union = SdkSchema.Union(SdkSchema.String);",
		"const emptyUnion = S.Union();",
		"const record = WorkflowSchema.Record({ key, value });",
		"const tuple = S.Tuple(S.String, S.Number);",
		"const emptyTuple = WorkflowSchema.Tuple();",
		"const currentLiteral = S.Literal(\"a\");",
		"const currentLiterals = S.Literals([\"a\", \"b\"]);",
		"const currentUnion = S.Union([S.String, S.Number]);",
		"const currentUnionOptions = S.Union([S.String, S.Number], { mode: \"oneOf\" });",
		"const currentRecord = S.Record(S.String, S.Number);",
		"const currentTuple = S.Tuple([S.String, S.Number]);",
		"const raw = `S.Literal(\"a\", \"b\"); S.Union(S.String);`;",
		"const shadowed = (S: any) => S.Union(S.String);",
		"for (const S of schemas) { S.Union(S.String); }",
		"for (const S in schemas) { S.Literal(\"a\", \"b\"); }",
	].join("\n");

	expect((await scanSource("schema.ts", source)).map(formatViolation)).toEqual([
		"schema.ts:4: Schema.Literal legacy arguments",
		"schema.ts:5: Schema.Literal legacy arguments",
		"schema.ts:6: Schema.Union legacy arguments",
		"schema.ts:7: Schema.Union legacy arguments",
		"schema.ts:8: Schema.Record legacy arguments",
		"schema.ts:9: Schema.Tuple legacy arguments",
		"schema.ts:10: Schema.Tuple legacy arguments",
	]);
});

test("guard ignores Schema aliases shadowed by ForStatement initializer bindings", async () => {
	const source = [
		'import { Schema as S } from "effect";',
		"for (let S = local; condition; update()) { S.Union(S.String); }",
		"for (const S = local; condition; update()) { S.Literal(\"a\", \"b\"); }",
		"for (let { S } = local; condition; update()) { S.Record({ key, value }); }",
		"for (const [S] = local; condition; update()) { S.Union(); }",
		"function probe() {",
		"\tfor (var S = local; condition; update()) { S.Union(S.String); }",
		"\tfor (var { S } = local; condition; update()) { S.Literal(\"a\", \"b\"); }",
		"}",
	].join("\n");

	expect(await scanSource("for-statement.ts", source)).toEqual([]);
});

test("guard reports exact logger migration rules without scanning raw text", async () => {
	const source = [
		"const all = LogLevel.All;",
		"const debug = LogLevel.Debug;",
		"const error = LogLevel.Error;",
		"const fatal = LogLevel.Fatal;",
		"const info = LogLevel.Info;",
		"const none = LogLevel.None;",
		"const trace = LogLevel.Trace;",
		"const warning = LogLevel.Warning;",
		"const compared = LogLevel.lessThanEqual(left, right);",
		"const logfmt = Logger.logfmtLogger;",
		"const minimum = Logger.minimumLogLevel(level);",
		"const pretty = Logger.prettyLogger();",
		"const replaced = Logger.replace(Logger.defaultLogger, logger);",
		"const scoped = Logger.replaceScoped(Logger.defaultLogger, loggerEffect);",
		"const zipped = Logger.zip(leftLogger, rightLogger);",
		"const retained = [LogLevel.LogLevel, Logger.tracerLogger, Layer.setTracer];",
		"const raw = String.raw`LogLevel.Info; Logger.replace(Logger.defaultLogger, logger);`;",
	].join("\n");

	expect((await scanSource("logger.ts", source)).map(formatViolation)).toEqual([
		"logger.ts:1: LogLevel.All",
		"logger.ts:2: LogLevel.Debug",
		"logger.ts:3: LogLevel.Error",
		"logger.ts:4: LogLevel.Fatal",
		"logger.ts:5: LogLevel.Info",
		"logger.ts:6: LogLevel.None",
		"logger.ts:7: LogLevel.Trace",
		"logger.ts:8: LogLevel.Warning",
		"logger.ts:9: LogLevel.lessThanEqual",
		"logger.ts:10: Logger.logfmtLogger",
		"logger.ts:11: Logger.minimumLogLevel",
		"logger.ts:12: Logger.prettyLogger",
		"logger.ts:13: Logger.replace",
		"logger.ts:14: Logger.replaceScoped",
		"logger.ts:15: Logger.zip",
	]);
});

test("constructs dry-run and write commands without spawning jscodeshift", async () => {
	const root = await createRoot();
	const target = await writeFixture(root, "apps/app-backend/src/index.ts");
	const dryRun = parseRunnerArgs(["noop", "--dry-run"]);
	const write = parseRunnerArgs(["noop", "--write"]);

	expect(buildJscodeshiftCommand(dryRun, [target], root)).toEqual([
		join(root, "node_modules", ".bin", "jscodeshift"),
		`--transform=${dryRun.transform.path}`,
		"--parser=tsx",
		"--extensions=ts,tsx,mts,cts",
		"--fail-on-error",
		"--dry",
		"apps/app-backend/src/index.ts",
	]);
	expect(buildJscodeshiftCommand(write, [target], root)).toEqual([
		join(root, "node_modules", ".bin", "jscodeshift"),
		`--transform=${write.transform.path}`,
		"--parser=tsx",
		"--extensions=ts,tsx,mts,cts",
		"--fail-on-error",
		"apps/app-backend/src/index.ts",
	]);
});
