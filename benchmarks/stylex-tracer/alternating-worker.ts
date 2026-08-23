/* oxlint-disable perfectionist/sort-objects, eslint/no-await-in-loop -- Alternating sequential samples are the benchmark protocol. */
const processStarted = Bun.nanoseconds();
const importStarted = Bun.nanoseconds();
const { compileVariant } = await import("./benchmark");
const importAndFingerprintMs = (Bun.nanoseconds() - importStarted) / 1_000_000;

const warmups = {
	stylex: await compileVariant("stylex"),
	tailwind: await compileVariant("tailwind"),
};
const measured = [];
for (let round = 0; round < 5; round += 1) {
	const order =
		round % 2 === 0 ? (["stylex", "tailwind"] as const) : (["tailwind", "stylex"] as const);
	for (const variant of order) {
		measured.push({
			round: round + 1,
			order: [...order],
			variant,
			result: await compileVariant(variant),
		});
	}
}

console.log(
	JSON.stringify({
		processToCompileReadyMs: (Bun.nanoseconds() - processStarted) / 1_000_000,
		importAndFingerprintMs,
		warmups,
		measured,
	}),
);
