import { BunServices } from "@effect/platform-bun";
import { expect, it, layer } from "@effect/vitest";
import { Effect, Path } from "effect";

import { roleLogPath, servedLanes } from "./server-role";

layer(BunServices.layer)((test) => {
	test.effect("places a role log beside the configured file", () =>
		Effect.gen(function* () {
			const path = yield* Path.Path;

			expect(roleLogPath(path, "/var/log/ryot.log", "all")).toBe("/var/log/ryot.log");
			expect(roleLogPath(path, "/var/log/ryot.log", "interactive")).toBe(
				"/var/log/ryot.interactive.log",
			);
			expect(roleLogPath(path, "logs/ryot.log", "background")).toBe("logs/ryot.background.log");
			expect(roleLogPath(path, "ryot", "background")).toBe("ryot.background");
		}),
	);
});

it("serves both lanes only in a process running everything", () => {
	expect(servedLanes("all")).toEqual(["interactive", "background"]);
	expect(servedLanes("interactive")).toEqual(["interactive"]);
	expect(servedLanes("background")).toEqual(["background"]);
});
