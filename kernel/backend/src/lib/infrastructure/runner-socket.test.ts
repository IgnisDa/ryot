import { BunServices, BunSocket } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import { Cause, Context, Effect, Exit, FileSystem, Layer, Path, Schema } from "effect";
import { RunnerAddress, Runners } from "effect/cluster";
import { Rpc, RpcClient, RpcGroup, RpcSerialization, RpcServer } from "effect/rpc";

import { assertExitFails } from "#lib/test-utils/assertions";

import {
	prepareRunnerSocketDirectory,
	RunnerSocketError,
	runnerSocketClientProtocolLayer,
	runnerSocketServerLayer,
} from "./runner-socket";

const socketDirectory = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-rs-" });
	return { fs, path, root, directory: path.join(root, "s") };
});

const PingRpcs = RpcGroup.make(Rpc.make("Ping", { success: Schema.String }));

const directoryError = (directory: string, message: string) =>
	new RunnerSocketError({ message: `SERVER_RUNNER_SOCKET_DIR '${directory}' ${message}` });

layer(BunServices.layer)((test) => {
	test.effect("creates a missing directory as owner-only and names the role socket", () =>
		Effect.gen(function* () {
			const { fs, path, directory } = yield* socketDirectory;
			const socket = yield* prepareRunnerSocketDirectory(directory, "interactive");
			const info = yield* fs.stat(directory);

			expect(socket).toBe(path.join(directory, "interactive.sock"));
			expect(info.type).toBe("Directory");
			expect(info.mode & 0o777).toBe(0o700);
		}),
	);

	test.effect("rejects a directory that grants group or other permissions", () =>
		Effect.gen(function* () {
			const { fs, directory } = yield* socketDirectory;
			yield* fs.makeDirectory(directory, { mode: 0o700 });
			yield* fs.chmod(directory, 0o750);

			assertExitFails(
				yield* Effect.exit(prepareRunnerSocketDirectory(directory, "background")),
				directoryError(directory, "must not grant group or other permissions"),
			);
		}),
	);

	test.effect("rejects a symbolic link to an owner-only directory", () =>
		Effect.gen(function* () {
			const { fs, path, root, directory } = yield* socketDirectory;
			const target = path.join(root, "t");
			yield* fs.makeDirectory(target, { mode: 0o700 });
			yield* fs.symlink(target, directory);

			assertExitFails(
				yield* Effect.exit(prepareRunnerSocketDirectory(directory, "background")),
				directoryError(directory, "must not be a symbolic link"),
			);
		}),
	);

	test.effect("rejects a path that is not a directory", () =>
		Effect.gen(function* () {
			const { fs, directory } = yield* socketDirectory;
			yield* fs.writeFileString(directory, "");

			assertExitFails(
				yield* Effect.exit(prepareRunnerSocketDirectory(directory, "background")),
				directoryError(directory, "must be a directory"),
			);
		}),
	);

	test.effect("refuses to replace a role path that is not a socket", () =>
		Effect.gen(function* () {
			const { fs, path, directory } = yield* socketDirectory;
			yield* fs.makeDirectory(directory, { mode: 0o700 });
			const socket = path.join(directory, "background.sock");
			yield* fs.writeFileString(socket, "");

			assertExitFails(
				yield* Effect.exit(prepareRunnerSocketDirectory(directory, "background")),
				new RunnerSocketError({
					message: `Runner socket path '${socket}' exists and is not a socket`,
				}),
			);
			expect(yield* fs.exists(socket)).toBe(true);
		}),
	);

	test.effect("listens on an owner-only socket and removes a leftover socket at boot", () =>
		Effect.gen(function* () {
			const { fs, directory } = yield* socketDirectory;
			yield* Layer.build(runnerSocketServerLayer(directory, "interactive"));
			const socket = yield* prepareRunnerSocketDirectory(directory, "interactive");
			expect(yield* fs.exists(socket)).toBe(false);

			yield* Layer.build(runnerSocketServerLayer(directory, "interactive"));
			const info = yield* fs.stat(socket);
			expect(info.type).toBe("Socket");
			expect(info.mode & 0o777).toBe(0o600);
		}),
	);

	test.effect("dies for a runner address that is not a lane role", () =>
		Effect.gen(function* () {
			const { directory } = yield* socketDirectory;
			const protocol = Context.get(
				yield* Layer.build(
					runnerSocketClientProtocolLayer(directory).pipe(
						Layer.provide(RpcSerialization.layerNdjson),
					),
				),
				Runners.RpcClientProtocol,
			);
			const exit = yield* Effect.exit(
				Effect.scoped(protocol.make(RunnerAddress.make("localhost", 34431))),
			);

			assert(Exit.isFailure(exit));
			expect(Cause.pretty(exit.cause)).toContain("Runner address 'localhost' is not a lane role");
		}),
	);

	test.effect("closes a connection whose frame exceeds the bound and keeps serving new ones", () =>
		Effect.gen(function* () {
			const { path, directory } = yield* socketDirectory;
			yield* Layer.build(
				RpcServer.layer(PingRpcs).pipe(
					Layer.provide(PingRpcs.toLayer({ Ping: () => Effect.succeed("pong") })),
					Layer.provide(RpcServer.layerProtocolSocketServer),
					Layer.provide(runnerSocketServerLayer(directory, "interactive")),
					Layer.provide(RpcSerialization.layerNdjson),
				),
			);
			const ping = Effect.gen(function* () {
				const clientProtocol = Context.get(
					yield* Layer.build(
						runnerSocketClientProtocolLayer(directory).pipe(
							Layer.provide(RpcSerialization.layerNdjson),
						),
					),
					Runners.RpcClientProtocol,
				);
				const protocol = yield* clientProtocol.make(RunnerAddress.make("interactive", 0));
				const client = yield* RpcClient.make(PingRpcs).pipe(
					Effect.provideService(RpcClient.Protocol, protocol),
				);
				return yield* client.Ping();
			}).pipe(Effect.scoped);

			expect(yield* ping).toBe("pong");

			const oversized = yield* Effect.scoped(
				Effect.gen(function* () {
					const socket = yield* BunSocket.makeNet({
						path: path.join(directory, "interactive.sock"),
					});
					const reader = yield* socket.reader;
					const writer = yield* socket.writer;
					yield* writer.write(new Uint8Array(16 * 1024 * 1024 + 1).fill(97));
					return yield* Effect.exit(Effect.forever(reader.pull));
				}),
			).pipe(Effect.timeout("10 seconds"));

			assert(Exit.isFailure(oversized));
			expect(yield* ping).toBe("pong");
		}),
	);
});
