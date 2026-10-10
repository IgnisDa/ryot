import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { Effect, type Path } from "effect";

import type { AppConfigValue } from "./config/service";

export type ServerLanes = AppConfigValue["server"]["lanes"];

/** What one server process runs; `split` is a supervisor and serves no work itself. */
export type ServerRole = Exclude<ServerLanes, "split">;

export const serverRole = (lanes: ServerLanes): Effect.Effect<ServerRole> =>
	lanes === "split"
		? Effect.die(new Error("SERVER_LANES=split supervises the roles and serves no work itself"))
		: Effect.succeed(lanes);

export const servedLanes = (role: ServerRole): ReadonlyArray<ExecutionLane> =>
	role === "all" ? ["interactive", "background"] : [role];

export const roleLogPath = (path: Path.Path, logPath: string, role: ServerRole) => {
	if (role === "all") {
		return logPath;
	}
	const { dir, ext, name } = path.parse(logPath);
	return path.join(dir, `${name}.${role}${ext}`);
};
