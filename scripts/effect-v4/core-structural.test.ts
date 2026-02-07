import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import jscodeshift from "jscodeshift";

import transform from "./transforms/core-structural";

const fixtures = join(import.meta.dir, "fixtures/core-structural");
const j = jscodeshift.withParser("tsx");

const readFixture = (name: string) => Bun.file(join(fixtures, name)).text();

const runTransform = (source: string, path = "apps/app-backend/src/fixture.ts") => {
	const reports: string[] = [];
	const output = transform(
		{ path, source },
		{ jscodeshift: j, report: (message: string) => reports.push(message) },
	);
	return { output, reports };
};

describe("core structural", () => {
	for (const name of ["direct", "aliases", "stream-as"]) {
		test(`${name} fixture and idempotency`, async () => {
			const input = await readFixture(`${name}.input.ts`);
			const expected = await readFixture(`${name}.output.ts`);
			const first = runTransform(input);

			expect(first.output).toBe(expected);
			expect(first.reports).toEqual([
				"[core-structural] transformed apps/app-backend/src/fixture.ts",
			]);

			const second = runTransform(first.output ?? input);
			expect(second.output).toBeUndefined();
			expect(second.reports).toEqual([]);
		});
	}

	test("withoutWorkflowParent emits mapUnsafe and setContext, not unsafeMap or /tmp/effect-migration's coarse provide", async () => {
		const input = await readFixture("map-input-context-removes-workflow-parent.input.ts");
		const expected = await readFixture("map-input-context-removes-workflow-parent.output.ts");
		const first = runTransform(input);

		expect(first.output).toBe(expected);
		expect(first.output).toContain("new Map(context.mapUnsafe)");
		expect(first.output).toContain(
			"Effect.setContext(effect, omitWorkflowParent(context))",
		);
		expect(first.output).not.toContain(".unsafeMap");
		expect(first.output).not.toContain("Effect.provide(");
		expect(first.reports).toEqual([
			"[core-structural] transformed apps/app-backend/src/fixture.ts",
		]);

		const second = runTransform(first.output ?? input);
		expect(second.output).toBeUndefined();
		expect(second.reports).toEqual([]);
	});

	test("ignores shadowed, unrelated, retained, and raw embedded forms", async () => {
		const input = await readFixture("negative.input.ts");
		const expected = await readFixture("negative.output.ts");
		const result = runTransform(input);

		expect(input).toBe(expected);
		expect(result.output).toBeUndefined();
		expect(result.reports).toEqual([]);
	});

	test("warns atomically and leaves an unsupported owned shape unchanged", async () => {
		const input = await readFixture("unsupported.input.ts");
		const expected = await readFixture("unsupported.output.ts");
		const first = runTransform(input);

		expect(first.output).toBe(expected);
		expect(first.reports).toEqual([
			"[core-structural] warning: skipped apps/app-backend/src/fixture.ts: unsupported member syntax Effect.orElse",
		]);

		const second = runTransform(first.output ?? input);
		expect(second.output).toBe(expected);
		expect(second.reports).toEqual(first.reports);
	});

	for (const [name, usage] of [
		["zero arguments", "source.pipe(Streams.as())"],
		["multiple arguments", "source.pipe(Streams.as(PING, PING))"],
		["non-identifier argument", "source.pipe(Streams.as(makePing()))"],
		["computed member", "source.pipe(Streams[\"as\"](PING))"],
		["optional member", "source.pipe(Streams?.as(PING))"],
		["optional call", "source.pipe(Streams.as?.(PING))"],
		["non-pipe call", "Streams.as(PING)"],
	] as const) {
		test(`warns atomically for unsupported Stream.as ${name}`, () => {
			const input = `${[
				'import { Stream as Streams } from "effect";',
				"",
				"declare const source: Streams.Stream<number>;",
				"declare const makePing: () => Uint8Array;",
				"const PING = new Uint8Array();",
				"",
				"const supported = source.pipe(Streams.as(PING));",
				`const unsupported = ${usage};`,
				"",
				"void [supported, unsupported];",
			].join("\n")}\n`;
			const first = runTransform(input);

			expect(first.output).toBe(input);
			expect(first.reports).toEqual([
				"[core-structural] warning: skipped apps/app-backend/src/fixture.ts: unsupported Stream.as usage",
			]);

			const second = runTransform(first.output ?? input);
			expect(second.output).toBe(input);
			expect(second.reports).toEqual(first.reports);
		});
	}

	test("warns atomically for unsupported owned unsafeMap syntax with a mapInputContext plan", async () => {
		const input = await readFixture("context-unsafe-map-unsupported.input.ts");
		const expected = await readFixture("context-unsafe-map-unsupported.output.ts");
		const first = runTransform(input);

		expect(first.output).toBe(expected);
		expect(first.reports).toEqual([
			"[core-structural] warning: skipped apps/app-backend/src/fixture.ts: unsupported Context.Context unsafeMap usage",
		]);

		const second = runTransform(first.output ?? input);
		expect(second.output).toBe(expected);
		expect(second.reports).toEqual(first.reports);
	});

	test("warns atomically for unsupported mapInputContext shapes", async () => {
		const input = await readFixture("map-input-context-unsupported.input.ts");
		const expected = await readFixture("map-input-context-unsupported.output.ts");
		const first = runTransform(input);

		expect(first.output).toBe(expected);
		expect(first.reports).toEqual([
			"[core-structural] warning: skipped apps/app-backend/src/fixture.ts: unsupported Effect.mapInputContext usage",
		]);

		const second = runTransform(first.output ?? input);
		expect(second.output).toBe(expected);
		expect(second.reports).toEqual(first.reports);
	});

	test("reports and ignores paths outside lexical scope", async () => {
		const input = await readFixture("direct.input.ts");

		for (const path of [
			"scripts/outside.ts",
			"apps/app-backend/dist/fixture.ts",
			"apps/app-backend/src/runner.generated.ts",
		]) {
			const result = runTransform(input, path);

			expect(result.output).toBeUndefined();
			expect(result.reports).toEqual([
				`[core-structural] warning: skipped ${path}: outside lexical scope`,
			]);
		}
	});
});
