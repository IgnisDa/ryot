/* oxlint-disable perfectionist/sort-objects -- Evidence fields follow timing chronology. */
type ClientCompilerBenchmarkSpanName =
	| "assets"
	| "bundle"
	| "cleanup"
	| "compilation-total"
	| "css-emission"
	| "dependency-reads"
	| "hashing-artifact"
	| "input-validation"
	| "original-source-preflight"
	| "stylex-transform"
	| "trusted-reads-materialization"
	| "typescript-check";

type ClientCompilerBenchmarkSpan = {
	readonly name: ClientCompilerBenchmarkSpanName;
	readonly startedNs: number;
	readonly endedNs: number;
	readonly durationMs: number;
	readonly inclusive: boolean;
};

export type ClientCompilerBenchmarkEvidence = {
	readonly traceId: string;
	readonly pid: number;
	readonly spans: readonly ClientCompilerBenchmarkSpan[];
	readonly counters: Readonly<Record<string, number>>;
	readonly worker?: {
		readonly processStartedNs: number;
		readonly importsReadyNs: number;
		readonly requestReadStartedNs: number;
		readonly artifactReadyNs: number;
	};
};

export type ClientCompilerBenchmarkInstrumentation = ReturnType<
	typeof makeClientCompilerBenchmarkInstrumentation
>;

export const makeClientCompilerBenchmarkInstrumentation = (traceId: string) => {
	const spans: ClientCompilerBenchmarkSpan[] = [];
	const counters: Record<string, number> = {};
	const start = (name: ClientCompilerBenchmarkSpanName, inclusive = false) => {
		const startedNs = Bun.nanoseconds();
		return () => {
			const endedNs = Bun.nanoseconds();
			spans.push({
				name,
				startedNs,
				endedNs,
				durationMs: (endedNs - startedNs) / 1_000_000,
				inclusive,
			});
		};
	};
	return {
		start,
		count: (name: string, value: number) => {
			counters[name] = (counters[name] ?? 0) + value;
		},
		evidence: (): ClientCompilerBenchmarkEvidence => ({
			traceId,
			pid: process.pid,
			spans,
			counters,
		}),
	};
};
