/* oxlint-disable perfectionist/sort-objects, eslint/no-await-in-loop -- Compilation timing must be sequential. */
type Variant = "stylex" | "tailwind";

const processStarted = Bun.nanoseconds();

const variantArgument = process.argv[2];
const mode = process.argv[3];
if (
	(variantArgument !== "stylex" && variantArgument !== "tailwind") ||
	!["cold", "instrumented"].includes(mode)
) {
	throw new Error("Usage: bun worker.ts <stylex|tailwind> <cold|instrumented>");
}
const variant: Variant = variantArgument;

try {
	const importStarted = Bun.nanoseconds();
	const { compileVariant } = await import("./benchmark");
	const importAndFingerprintMs = (Bun.nanoseconds() - importStarted) / 1_000_000;
	console.log(
		JSON.stringify({
			variant,
			mode,
			processToCompileReadyMs: (Bun.nanoseconds() - processStarted) / 1_000_000,
			importAndFingerprintMs,
			result: await compileVariant(
				variant,
				mode === "instrumented" ? `direct-${variant}` : undefined,
			),
		}),
	);
} catch (error) {
	console.error(
		JSON.stringify(
			error instanceof Error ? { name: error.name, message: error.message } : { error },
			null,
			2,
		),
	);
	process.exitCode = 1;
}
