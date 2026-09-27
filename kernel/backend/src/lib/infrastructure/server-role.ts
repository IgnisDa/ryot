import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import { Effect, type Path } from "effect";

import type { AppConfigValue } from "./config/service";

export type ServerRole = AppConfigValue["server"]["processRole"];

export const serverRole = (
	server: Pick<AppConfigValue["server"], "lanes" | "processRole">,
): Effect.Effect<ServerRole> =>
	server.lanes === "split"
		? Effect.die(new Error("SERVER_LANES=split supervises the roles and serves no work itself"))
		: Effect.succeed(server.processRole);

export const servedLanes = (role: ServerRole): ReadonlyArray<ExecutionLane> =>
	role === "all" ? ["interactive", "background"] : [role];

export const roleLogPath = (path: Path.Path, logPath: string, role: ServerRole) => {
	if (role === "all") {
		return logPath;
	}
	const { dir, ext, name } = path.parse(logPath);
	return path.join(dir, `${name}.${role}${ext}`);
};
