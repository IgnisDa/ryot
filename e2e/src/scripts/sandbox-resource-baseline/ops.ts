import { Data, Effect, Schedule, Schema } from "effect";

import {
	decodeHostLines,
	HostMetadataLine,
	type HostSampleLine,
	JournalLine,
	type PeakResetLine,
	type WatchdogTriggerLine,
} from "./host/samples";

export class RemoteCommandError extends Data.TaggedError("RemoteCommandError")<{
	readonly command: string;
	readonly exitCode: number | null;
	readonly stderr: string;
}> {}

export const BENCHMARK_ENVIRONMENT = {
	fixtureDatabase: "ryot_fixture",
	applicationDatabase: "postgres",
	serviceUuid: "a2dt5g6dbmpwqwllnzsho8jc",
	toolsDirectory: "/root/ryot-benchmark-tools",
	containerProfileRoot: "/home/ryot/work/benchmark-profiles",
	serviceDirectory: "/data/coolify/services/a2dt5g6dbmpwqwllnzsho8jc",
} as const;

const tools = BENCHMARK_ENVIRONMENT.toolsDirectory;
const project = BENCHMARK_ENVIRONMENT.serviceUuid;
export const REMOTE_FILES = {
	appPid: `${tools}/app.pid`,
	hostPid: `${tools}/host.pid`,
	profiles: `${tools}/profiles`,
	appSamples: `${tools}/app.jsonl`,
	tokenFile: `${tools}/admin-token`,
	hostSamples: `${tools}/host.jsonl`,
	watchdogPid: `${tools}/watchdog.pid`,
	binary: `${tools}/ryot-benchmark-host`,
	watchdogTriggers: `${tools}/watchdog-triggers.jsonl`,
} as const;

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * A run issues tens of thousands of remote commands, sometimes several at once. Without a shared
 * connection each one is a new TCP and key exchange, and concurrent batches trip the server's
 * `MaxStartups` limit and fail as banner-exchange timeouts. One multiplexed connection removes both
 * the handshake cost and the limit; the socket lives under `~/.ssh` to stay inside the path length
 * a unix socket allows.
 */
export const SSH_OPTIONS = [
	"-o",
	"BatchMode=yes",
	"-o",
	"ConnectTimeout=15",
	"-o",
	"ControlMaster=auto",
	"-o",
	"ControlPath=~/.ssh/ryot-bm-%C",
	"-o",
	"ControlPersist=600",
	"-o",
	"ServerAliveInterval=30",
	"-o",
	"ServerAliveCountMax=6",
] as const;

/**
 * ssh reports its own transport failures as 255, which means the remote command never ran and the
 * attempt can be repeated without duplicating a side effect.
 */
const SSH_TRANSPORT_EXIT_CODE = 255;

export const makeRemote = (serverIp: string) => {
	const run = (command: string, options: { readonly stdin?: Uint8Array } = {}) =>
		Effect.tryPromise({
			catch: (cause) => new RemoteCommandError({ command, exitCode: null, stderr: String(cause) }),
			try: async () => {
				const child = Bun.spawn(["ssh", ...SSH_OPTIONS, `root@${serverIp}`, command], {
					stderr: "pipe",
					stdout: "pipe",
					stdin: options.stdin ?? "ignore",
				});
				const [stdout, stderr, exitCode] = await Promise.all([
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
					child.exited,
				]);
				return { stdout, stderr, exitCode };
			},
		}).pipe(
			Effect.flatMap((result) =>
				result.exitCode === 0
					? Effect.succeed(result.stdout)
					: Effect.fail(
							new RemoteCommandError({
								command,
								exitCode: result.exitCode,
								stderr: result.stderr.slice(0, 2_000),
							}),
						),
			),
			Effect.retry({
				times: 5,
				schedule: Schedule.spaced("10 seconds"),
				while: (error: RemoteCommandError) => error.exitCode === SSH_TRANSPORT_EXIT_CODE,
			}),
		);

	const binary = (args: string) => run(`${REMOTE_FILES.binary} ${args}`);

	const metadata = binary(`metadata --project ${project}`).pipe(
		Effect.flatMap((output) =>
			Schema.decodeEffect(Schema.fromJsonString(HostMetadataLine))(output.trim()),
		),
	);

	const containerId = (role: "ryot" | "postgres" | "redis" | "otel") =>
		Effect.flatMap(metadata, (line) => {
			const container = line.containers.find((candidate) => candidate.role === role);
			return container === undefined
				? Effect.fail(
						new RemoteCommandError({
							exitCode: null,
							command: "metadata",
							stderr: `${role} unresolved`,
						}),
					)
				: Effect.succeed(container.containerId);
		});

	const psql = (sql: string) =>
		Effect.flatMap(containerId("postgres"), (id) =>
			run(
				`docker exec ${id} psql -v ON_ERROR_STOP=1 -U postgres -d template1 -qAt -c ${shellQuote(sql)}`,
			),
		);

	const fileSize = (path: string) =>
		run(`stat -c %s ${path} 2>/dev/null || echo 0`).pipe(
			Effect.map((output) => Number(output.trim())),
		);

	/** Reads only the bytes appended since `fromOffset`, so large sample files are never rescanned. */
	const readAppended = (path: string, fromOffset: number) =>
		run(`tail -c +${fromOffset + 1} ${path}`);

	const startDetached = (pidFile: string, args: string) =>
		run(
			`cd ${tools} && if [ -f ${pidFile} ] && kill -0 "$(cat ${pidFile})" 2>/dev/null; then echo running; else setsid nohup ${REMOTE_FILES.binary} ${args} --pid-file ${pidFile} >/dev/null 2>&1 < /dev/null & echo started; fi`,
		);

	const stopDetached = (pidFile: string) =>
		run(
			`if [ -f ${pidFile} ]; then kill "$(cat ${pidFile})" 2>/dev/null || true; rm -f ${pidFile}; fi`,
		);

	const isRunning = (pidFile: string) =>
		run(`[ -f ${pidFile} ] && kill -0 "$(cat ${pidFile})" 2>/dev/null && echo yes || echo no`).pipe(
			Effect.map((output) => output.trim() === "yes"),
		);

	const removeSampleFiles = run(
		`rm -f ${REMOTE_FILES.hostSamples} ${REMOTE_FILES.appSamples} ${REMOTE_FILES.watchdogTriggers} ${tools}/watchdog-drill.jsonl && rm -rf ${REMOTE_FILES.profiles}`,
	);

	return {
		run,
		metadata,
		fileSize,
		isRunning,
		containerId,
		readAppended,
		stopHostSampler: stopDetached(REMOTE_FILES.hostPid),
		stopAppCollector: stopDetached(REMOTE_FILES.appPid),
		stopWatchdog: stopDetached(REMOTE_FILES.watchdogPid),
		stopRyot: Effect.flatMap(containerId("ryot"), (id) => run(`docker stop ${id}`)),
		startHostSampler: startDetached(
			REMOTE_FILES.hostPid,
			`sample --project ${project} --output ${REMOTE_FILES.hostSamples}`,
		),
		startWatchdog: startDetached(
			REMOTE_FILES.watchdogPid,
			`watchdog --project ${project} --trigger-file ${REMOTE_FILES.watchdogTriggers}`,
		),
		startAppCollector: startDetached(
			REMOTE_FILES.appPid,
			`app-sample --project ${project} --output ${REMOTE_FILES.appSamples} --token-file ${REMOTE_FILES.tokenFile}`,
		),
		/**
		 * The collector reads the admin token from a file so it never appears in the host's process
		 * list, and it is passed over stdin here for the same reason. Nothing else creates this file:
		 * before this existed, `startAppCollector` spawned a collector that exited immediately and
		 * preflight only noticed ten minutes later, when it read samples that were never written.
		 */
		writeTokenFile: (token: string) =>
			run(`umask 077 && cat > ${REMOTE_FILES.tokenFile} && chmod 600 ${REMOTE_FILES.tokenFile}`, {
				stdin: new TextEncoder().encode(token),
			}),
		removeSampleFiles,
		watchdogTriggers: run(`cat ${REMOTE_FILES.watchdogTriggers} 2>/dev/null || true`).pipe(
			Effect.map((output) =>
				decodeHostLines(output).lines.filter(
					(line): line is WatchdogTriggerLine => line.kind === "watchdog-trigger",
				),
			),
		),
		captureFixture: Effect.gen(function* () {
			yield* psql(`DROP DATABASE IF EXISTS ${BENCHMARK_ENVIRONMENT.fixtureDatabase}`);
			yield* psql(
				`CREATE DATABASE ${BENCHMARK_ENVIRONMENT.fixtureDatabase} TEMPLATE ${BENCHMARK_ENVIRONMENT.applicationDatabase}`,
			);
		}),
		journal: (sinceMs: number, untilMs: number) =>
			binary(
				`journal --since ${shellQuote(new Date(sinceMs).toISOString())} --until ${shellQuote(new Date(untilMs).toISOString())}`,
			).pipe(
				Effect.flatMap((output) =>
					Schema.decodeEffect(Schema.fromJsonString(JournalLine))(output.trim()),
				),
			),
		watchdogDrill: binary(
			`watchdog --project ${project} --trigger-file ${tools}/watchdog-drill.jsonl --drill`,
		).pipe(
			Effect.andThen(run(`cat ${tools}/watchdog-drill.jsonl`)),
			Effect.map((output) =>
				decodeHostLines(output).lines.filter(
					(line): line is WatchdogTriggerLine => line.kind === "watchdog-trigger",
				),
			),
		),
		/** Restores the fixture database and flushes Redis while Ryot is stopped. */
		restoreFixture: Effect.gen(function* () {
			const redis = yield* containerId("redis");
			yield* psql(
				`DROP DATABASE IF EXISTS ${BENCHMARK_ENVIRONMENT.applicationDatabase} WITH (FORCE)`,
			);
			yield* psql(
				`CREATE DATABASE ${BENCHMARK_ENVIRONMENT.applicationDatabase} TEMPLATE ${BENCHMARK_ENVIRONMENT.fixtureDatabase}`,
			);
			yield* run(`docker exec ${redis} redis-cli FLUSHALL`);
		}),
		decodeSamples: (output: string) => {
			const decoded = decodeHostLines(output);
			return {
				undecodable: decoded.undecodable,
				samples: decoded.lines.filter((line): line is HostSampleLine => line.kind === "sample"),
				metadata: decoded.lines.filter(
					(line): line is HostMetadataLine => line.kind === "metadata",
				),
				peakResets: decoded.lines.filter(
					(line): line is PeakResetLine => line.kind === "peak-reset",
				),
			};
		},
		/**
		 * Takes `removeSampleFiles` rather than leaving the caller to remove the samples afterwards,
		 * because the listing has to describe the state the run is actually left in. Removing them
		 * after this returned is how the teardown of run `2026-09-19T09-33-37Z` came to record a
		 * directory listing of files it had already deleted.
		 */
		teardown: (options: { readonly removeSampleFiles: boolean }) =>
			Effect.gen(function* () {
				yield* stopDetached(REMOTE_FILES.watchdogPid);
				yield* stopDetached(REMOTE_FILES.appPid);
				yield* stopDetached(REMOTE_FILES.hostPid);
				yield* run(`rm -f ${REMOTE_FILES.tokenFile}`);
				if (options.removeSampleFiles) yield* removeSampleFiles;
				const remaining = yield* run(`ls -A ${tools} 2>/dev/null | tr '\n' ' '`);
				/**
				 * The first character is bracketed so the pattern cannot match the `bash -c` wrapper
				 * this very command runs inside. Without it the probe reports `running` whether or not
				 * a sampler exists, and `pgrep -x` is no substitute because the kernel truncates the
				 * process name to fifteen characters.
				 */
				const processes = yield* run(
					`pgrep -f ${tools}/'[r]'yot-benchmark-host >/dev/null 2>&1 && echo running || echo none`,
				);
				return {
					processes: processes.trim(),
					remaining: remaining.trim(),
					removedSampleFiles: options.removeSampleFiles,
				};
			}),
		/**
		 * File-exporter sizes for the benchmark collector; a shrinking file means rotation loss. The
		 * collector image is distroless, so the sizes are read from the host side of its output mount.
		 */
		otlpOutputSizes: Effect.flatMap(containerId("otel"), (id) =>
			run(
				`stat -c '%n %s' "$(docker inspect ${id} --format '{{range .Mounts}}{{if eq .Destination "/output"}}{{.Source}}{{end}}{{end}}')"/*.json`,
			).pipe(
				Effect.map((output) =>
					Object.fromEntries(
						output
							.split("\n")
							.filter((line) => line.trim() !== "")
							.map((line) => {
								const [path, size] = line.trim().split(/\s+/);
								return [path ?? "", Number(size ?? 0)];
							}),
					),
				),
			),
		),
		resetPeak: Effect.gen(function* () {
			const offset = yield* fileSize(REMOTE_FILES.hostSamples);
			yield* run(`kill -USR1 "$(cat ${REMOTE_FILES.hostPid})"`);
			for (let attempt = 0; attempt < 20; attempt += 1) {
				yield* Effect.sleep("250 millis");
				const appended = yield* readAppended(REMOTE_FILES.hostSamples, offset);
				const reset = decodeHostLines(appended).lines.find(
					(line): line is PeakResetLine => line.kind === "peak-reset",
				);
				if (reset !== undefined) {
					return reset;
				}
			}
			return null;
		}),
		/** Recreates only the Ryot container with the given settings and never pulls a new image. */
		recreateRyot: (settings: {
			readonly workerConcurrency: number;
			readonly schedulerDispatchersDisabled: boolean;
		}) =>
			run(
				[
					`cd ${BENCHMARK_ENVIRONMENT.serviceDirectory}`,
					`sed -i -E 's/^SANDBOX_WORKER_CONCURRENCY=.*/SANDBOX_WORKER_CONCURRENCY=${settings.workerConcurrency}/; s/^SCHEDULER_DISABLE_DISPATCHERS=.*/SCHEDULER_DISABLE_DISPATCHERS=${settings.schedulerDispatchersDisabled}/' .env`,
					`grep -q '^SANDBOX_WORKER_CONCURRENCY=${settings.workerConcurrency}$' .env`,
					`grep -q '^SCHEDULER_DISABLE_DISPATCHERS=${settings.schedulerDispatchersDisabled}$' .env`,
					`docker compose --project-name ${project} --project-directory . -f docker-compose.yml up -d --no-deps --force-recreate --pull never ryot`,
				].join(" && "),
			),
		/** Copies one token's raw profiles off the container and host, deleting both remote copies. */
		fetchProfiles: (token: string, localDirectory: string) =>
			Effect.gen(function* () {
				const ryot = yield* containerId("ryot");
				const remoteDirectory = `${REMOTE_FILES.profiles}/${token}`;
				yield* run(
					`mkdir -p -m 700 ${REMOTE_FILES.profiles} && rm -rf ${remoteDirectory} && docker cp ${ryot}:${BENCHMARK_ENVIRONMENT.containerProfileRoot}/${token} ${remoteDirectory} && chmod -R go-rwx ${remoteDirectory}`,
				);
				yield* Effect.tryPromise(async () => {
					const child = Bun.spawn(
						[
							"sh",
							"-c",
							`umask 077 && mkdir -p ${shellQuote(localDirectory)} && ssh ${SSH_OPTIONS.join(" ")} root@${serverIp} "tar -C ${REMOTE_FILES.profiles} -czf - ${token}" | tar -C ${shellQuote(localDirectory)} -xzf -`,
						],
						{ stderr: "pipe", stdout: "ignore" },
					);
					if ((await child.exited) !== 0) {
						throw new Error(await new Response(child.stderr).text());
					}
				});
				yield* run(
					`rm -rf ${remoteDirectory} && docker exec ${ryot} rm -rf ${BENCHMARK_ENVIRONMENT.containerProfileRoot}/${token}`,
				);
			}),
		/**
		 * Reads what the deployment actually is, rather than what it was asked to be: the image the
		 * Ryot container was created from, its digest and architecture, the collector image, the
		 * enforced limits, and a hash of the generated compose with every secret value removed.
		 */
		deploymentProvenance: Effect.gen(function* () {
			const [ryot, otel] = yield* Effect.all([containerId("ryot"), containerId("otel")]);
			const read = (command: string) => Effect.map(run(command), (output) => output.trim());
			const inspect = (id: string, template: string) =>
				read(`docker inspect ${id} --format ${shellQuote(template)}`);
			const imageId = yield* inspect(ryot, "{{.Image}}");
			const [tag, repoDigests, architecture, revision, source, created] = yield* Effect.all([
				inspect(ryot, "{{.Config.Image}}"),
				read(`docker image inspect ${imageId} --format '{{join .RepoDigests ","}}'`),
				read(`docker image inspect ${imageId} --format '{{.Os}}/{{.Architecture}}'`),
				read(
					`docker image inspect ${imageId} --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'`,
				),
				read(
					`docker image inspect ${imageId} --format '{{index .Config.Labels "org.opencontainers.image.source"}}'`,
				),
				read(`docker image inspect ${imageId} --format '{{.Created}}'`),
			]);
			const [otelImage, ryotMemory, otelMemory, ryotCpus, ryotPids] = yield* Effect.all([
				inspect(otel, "{{.Config.Image}}"),
				inspect(ryot, "{{.HostConfig.Memory}}"),
				inspect(otel, "{{.HostConfig.Memory}}"),
				inspect(ryot, "{{.HostConfig.NanoCpus}}"),
				inspect(ryot, "{{.HostConfig.PidsLimit}}"),
			]);
			const [cpuCount, memTotal, kernel] = yield* Effect.all([
				read("nproc"),
				read("awk '/MemTotal/ {print $2 * 1024}' /proc/meminfo"),
				read("uname -r"),
			]);
			const composeSha256 = yield* read(
				`sed -E 's/(PASSWORD|TOKEN|SECRET|KEY)([A-Za-z_]*)(: | - |=)\\S+/\\1\\2\\3REDACTED/gI; s#://[^@/]*@#://REDACTED@#g' ${BENCHMARK_ENVIRONMENT.serviceDirectory}/docker-compose.yml | sha256sum | cut -d' ' -f1`,
			);
			const digest = repoDigests.split(",").find((entry) => entry.includes("@")) ?? null;
			return {
				composeSha256,
				otelCollectorImage: otelImage,
				image: {
					architecture,
					tag: tag === "" ? null : tag,
					ociRevision: revision === "" ? null : revision,
					digest: digest === null ? null : (digest.split("@")[1] ?? null),
				},
				resourceSettings: {
					kernel,
					imageId,
					imageCreated: created,
					hostCpuCount: cpuCount,
					ryotNanoCpus: ryotCpus,
					ryotPidsLimit: ryotPids,
					hostMemTotalBytes: memTotal,
					ryotMemoryLimitBytes: ryotMemory,
					otelMemoryLimitBytes: otelMemory,
					imageSource: source === "" ? "unknown" : source,
				} satisfies Record<string, string>,
			};
		}),
	};
};

export type Remote = ReturnType<typeof makeRemote>;
