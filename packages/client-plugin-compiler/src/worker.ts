/* oxlint-disable perfectionist/sort-objects -- Worker evidence fields follow timing chronology. */
import type { ClientCompilerResponse } from "./protocol";

const processStartedNs = Bun.nanoseconds();
const requestReadStartedNs = Bun.nanoseconds();
const input = await Bun.stdin.text();
const [{ Effect }, { compileClientPlugin }, diagnostics, protocol] = await Promise.all([
	import("effect"),
	import("./compile"),
	import("./diagnostics"),
	import("./protocol"),
]);
const importsReadyNs = Bun.nanoseconds();

const workerFailure = (message: string) =>
	diagnostics.clientPluginCompilationFailure([
		diagnostics.clientPluginCompilerDiagnostic("RYOT_CLIENT_COMPILER_PROCESS", "client", message),
	]);

const response = await Effect.runPromise(
	protocol.decodeClientCompilerWorkerRequest(input).pipe(
		Effect.mapError((error) =>
			workerFailure(`Client plugin compiler input could not be decoded: ${String(error)}`),
		),
		Effect.flatMap(compileClientPlugin),
		Effect.match({
			onFailure: protocol.clientCompilerWorkerFailure,
			onSuccess: protocol.clientCompilerWorkerSuccess,
		}),
	),
);
const artifactReadyNs = Bun.nanoseconds();
const instrumentedResponse: ClientCompilerResponse =
	response.success && response.value.benchmarkInstrumentation !== undefined
		? {
				success: true as const,
				value: {
					artifact: response.value.artifact,
					benchmarkInstrumentation: {
						...response.value.benchmarkInstrumentation,
						worker: { processStartedNs, importsReadyNs, requestReadStartedNs, artifactReadyNs },
					},
				},
			}
		: response;
const tracePath = process.env.RYOT_CLIENT_COMPILER_BENCHMARK_TRACE;
if (
	tracePath !== undefined &&
	instrumentedResponse.success &&
	instrumentedResponse.value.benchmarkInstrumentation !== undefined
) {
	const { appendFile } = await import("node:fs/promises");
	await appendFile(
		tracePath,
		`${JSON.stringify(instrumentedResponse.value.benchmarkInstrumentation)}\n`,
	);
}
process.stdout.write(`${protocol.encodeClientCompilerWorkerResponse(instrumentedResponse)}\n`);
