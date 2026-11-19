#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, Layer, Option, Schema } from "effect";
import { Command, Flag } from "effect/cli";

import { buildPluginMessages } from "./messages";

const loadBuild = Effect.promise(() => import("./build"));

const buildCommand = Command.make(
	"build",
	{
		watch: Flag.Boolean("watch").pipe(Flag.withDefault(false)),
		skipInitial: Flag.Boolean("skip-initial").pipe(Flag.withDefault(false)),
		output: Flag.String("output").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.optional),
	},
	Effect.fn("buildCommand")(function* ({ watch, output, skipInitial }) {
		const { runPluginBuild } = yield* loadBuild;
		return yield* runPluginBuild({
			watch,
			skipInitial,
			cwd: process.cwd(),
			output: Option.getOrUndefined(output),
		});
	}),
).pipe(
	Command.provide(Layer.unwrap(Effect.map(loadBuild, ({ pluginBuildLayer }) => pluginBuildLayer))),
);

const messagesCommand = Command.make(
	"messages",
	{},
	Effect.fn("messagesCommand")(function* () {
		yield* buildPluginMessages(process.cwd());
	}),
);

const pluginCommand = Command.make("plugin").pipe(
	Command.withSubcommands([buildCommand, messagesCommand]),
);

const cli = Command.make("ryot").pipe(Command.withSubcommands([pluginCommand]));

const program = Command.run(cli, { version: "0.0.0" });

if (import.meta.main) {
	BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
}
