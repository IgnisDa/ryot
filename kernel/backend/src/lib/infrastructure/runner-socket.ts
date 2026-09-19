import { BunSocket, BunSocketServer } from "@effect/platform-bun";
import { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { Runners } from "effect/cluster";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket, SocketServer } from "effect/socket";

const isRunnerRole = Schema.is(ExecutionLane);

export class RunnerSocketError extends Schema.TaggedError<RunnerSocketError>()(
	"RunnerSocketError",
	{ message: Schema.String },
) {}

const socketPath = (path: Path.Path, directory: string, role: ExecutionLane) =>
	path.join(directory, `${role}.sock`);

export const prepareRunnerSocketDirectory = Effect.fn("prepareRunnerSocketDirectory")(function* (
	directory: string,
	role: ExecutionLane,
) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const resolved = path.resolve(directory);
	const fail = (message: string) =>
		new RunnerSocketError({ message: `RYOT_RUNNER_SOCKET_DIR '${resolved}' ${message}` });
	const parent = yield* fs.realPath(path.dirname(resolved));
	if ((yield* fs.realPath(resolved)) !== path.join(parent, path.basename(resolved))) {
		return yield* fail("must not be a symbolic link");
	}
	const info = yield* fs.stat(resolved);
	if (info.type !== "Directory") {
		return yield* fail("must be a directory");
	}
	const uid = process.getuid?.();
	if (uid === undefined || Option.getOrUndefined(info.uid) !== uid) {
		return yield* fail("must be owned by the server's user");
	}
	if ((info.mode & 0o077) !== 0) {
		return yield* fail("must not grant group or other permissions");
	}
	const socket = socketPath(path, resolved, role);
	if (yield* fs.exists(socket)) {
		return yield* new RunnerSocketError({
			message: `Runner socket path '${socket}' already exists`,
		});
	}
	return socket;
});

export const runnerSocketServerLayer = (directory: string, role: ExecutionLane) =>
	Layer.effect(
		SocketServer.SocketServer,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* prepareRunnerSocketDirectory(directory, role);
			const server = yield* BunSocketServer.make({ path });
			yield* fs.chmod(path, 0o600);
			return server;
		}),
	);

export const runnerSocketClientProtocolLayer = (directory: string) =>
	Layer.effect(
		Runners.RpcClientProtocol,
		Effect.gen(function* () {
			const path = yield* Path.Path;
			const serialization = yield* RpcSerialization.RpcSerialization;
			const resolved = path.resolve(directory);
			return Runners.RpcClientProtocol.of({
				codecFor: serialization.codecFor,
				make: Effect.fnUntraced(function* (address) {
					if (!isRunnerRole(address.host)) {
						return yield* Effect.die(
							new RunnerSocketError({
								message: `Runner address '${address.host}' is not a lane role`,
							}),
						);
					}
					const socket = yield* BunSocket.makeNet({
						timeout: 5500,
						openTimeout: 1000,
						path: socketPath(path, resolved, address.host),
					});
					return yield* RpcClient.makeProtocolSocket().pipe(
						Effect.provideService(Socket.Socket, socket),
						Effect.provideService(RpcSerialization.RpcSerialization, serialization),
					);
				}),
			});
		}),
	);
