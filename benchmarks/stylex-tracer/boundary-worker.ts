import { ClientPluginCompiler } from "../../kernel/backend/src/modules/plugins/client-plugin-compiler";
/* oxlint-disable perfectionist/sort-objects, oxc/no-map-spread -- Result keys follow the benchmark report. */
import { Effect } from "../../packages/client-plugin-compiler/node_modules/effect/dist/index.js";
import { variantInput, type Variant } from "./benchmark";

const variantArgument = process.argv[2];
const mode = process.argv[3];
if (variantArgument !== "stylex" && variantArgument !== "tailwind") {
	throw new Error("Usage: bun boundary-worker.ts <stylex|tailwind> <single|pair>");
}
const variant: Variant = variantArgument;
if (mode !== "single" && mode !== "pair") {
	throw new Error("Boundary mode must be single or pair");
}

const colors = ["#123456", "#654321"] as const;
const inputs = await Promise.all(
	colors
		.slice(0, mode === "single" ? 1 : 2)
		.map((color, index) =>
			variantInput(
				variant,
				{ color, id: `pair-${index + 1}` },
				`boundary-${variant}-${mode}-${index + 1}`,
			),
		),
);
const started = Bun.nanoseconds();
const records = await Effect.runPromise(
	Effect.gen(function* () {
		const compiler = yield* ClientPluginCompiler;
		return yield* Effect.forEach(
			inputs,
			(input, index) => {
				const compileStarted = Bun.nanoseconds();
				return compiler
					.compile(input)
					.pipe(
						Effect.map((artifact) => ({
							index,
							startedMs: (compileStarted - started) / 1_000_000,
							finishedMs: (Bun.nanoseconds() - started) / 1_000_000,
							css: new TextDecoder().decode(
								artifact.files.find(({ name }) => name === "plugin.css")?.contents,
							),
						})),
					);
			},
			{ concurrency: "unbounded" },
		);
	}).pipe(Effect.provide(ClientPluginCompiler.layer)),
);

console.log(
	JSON.stringify({
		variant,
		pairWallMs: (Bun.nanoseconds() - started) / 1_000_000,
		builds: records.map(({ css, ...record }, index) => ({
			...record,
			cssIsolation:
				css.includes(colors[index] ?? "") && !css.includes(colors[index === 0 ? 1 : 0] ?? ""),
		})),
	}),
);
