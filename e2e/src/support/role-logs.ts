import { Effect, Path } from "effect";

export type ServerRole = "all" | "background" | "interactive";

export const roleLogFile = (logFile: string, role: ServerRole) =>
	Effect.gen(function* () {
		if (role === "all") {
			return logFile;
		}
		const path = yield* Path.Path;
		const { dir, ext, name } = path.parse(logFile);
		return path.join(dir, `${name}.${role}${ext}`);
	});
