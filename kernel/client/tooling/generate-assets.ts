import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess } from "effect/process";
import sharp from "sharp";

const BRAND = "#fd7e14";
const DEBUG = "#4dabf7";
const ICON = "AppIcon-512@2x.png";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const program = Effect.gen(function* () {
	const path = yield* Path.Path;
	const fs = yield* FileSystem.FileSystem;
	const client = yield* path.fromFileUrl(new URL("..", import.meta.url));
	const web = path.join(client, "public");
	const source = path.join(client, "assets/icon-only.png");
	const resources = path.join(client, "android/app/src/main/res");
	const catalog = path.join(client, "ios/App/App/Assets.xcassets");
	const bin = path.join(client, "node_modules/.bin/capacitor-assets");
	const generate = Effect.fn("generateNativeAssets")(function* (
		background: string,
		...args: string[]
	) {
		const child = yield* ChildProcess.make(
			bin,
			[
				"generate",
				...args,
				"--iconBackgroundColor",
				background,
				"--iconBackgroundColorDark",
				background,
				"--splashBackgroundColor",
				BRAND,
				"--splashBackgroundColorDark",
				BRAND,
			],
			{ cwd: client, stdout: "inherit", stderr: "inherit" },
		);
		const exitCode = yield* child.exitCode;
		if (Number(exitCode) !== 0) {
			return yield* Effect.die(new Error(`capacitor-assets exited with ${Number(exitCode)}`));
		}
		return undefined;
	});

	// `icon-only.png` bakes the brand orange into its pixels, so no background colour can move the iOS
	// icon off brand. The debug icon comes from `assets/dev`, where the transparent mark is the only
	// source and the colour does apply.
	yield* generate(DEBUG, "--ios", "--assetPath", "assets/dev");
	const debugIcon = path.join(catalog, "AppIconDev.appiconset");
	yield* fs.makeDirectory(debugIcon, { recursive: true });
	yield* fs.rename(path.join(catalog, "AppIcon.appiconset", ICON), path.join(debugIcon, ICON));
	yield* fs.writeFileString(
		path.join(debugIcon, "Contents.json"),
		encodeJson({
			info: { version: 1, author: "xcode" },
			images: [{ filename: ICON, platform: "ios", size: "1024x1024", idiom: "universal" }],
		}),
	);

	// `capacitor-assets` scales the iOS splash logo relative to the source image but the Android one
	// relative to the target canvas, so each platform needs its own size for the mark.
	yield* generate(BRAND, "--ios", "--logoSplashTargetWidth", "512");
	yield* generate(BRAND, "--android", "--logoSplashScale", "0.4");

	// `capacitor-assets` insets both adaptive-icon layers into the 72dp safe zone and emits a solid
	// colour background bitmap per density. An adaptive background must be full-bleed, or launcher
	// parallax reveals transparent edges, so the layers are rewritten to reference the brand colour.
	yield* Effect.forEach(
		["ic_launcher.xml", "ic_launcher_round.xml"],
		(name) =>
			fs.writeFileString(
				path.join(resources, "mipmap-anydpi-v26", name),
				`<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`,
			),
		{ discard: true, concurrency: "unbounded" },
	);
	const directories = yield* fs.readDirectory(resources);
	yield* Effect.forEach(
		directories.filter((directory) => directory.startsWith("mipmap-")),
		(directory) =>
			fs.remove(path.join(resources, directory, "ic_launcher_background.png"), { force: true }),
		{ discard: true, concurrency: "unbounded" },
	);

	// `index.html` links these two directly. `capacitor-assets` only writes into the native projects,
	// and its `--pwa` mode emits a whole Apple splash set under names of its own.
	yield* Effect.tryPromise(() =>
		sharp(source).resize(64).png().toFile(path.join(web, "favicon.png")),
	);
	yield* Effect.tryPromise(() =>
		sharp(source).resize(180).png().toFile(path.join(web, "apple-touch-icon.png")),
	);
});

BunRuntime.runMain(
	// oxlint-disable-next-line effecttsgo/strict-effect-provide -- Native asset generation is a command-line entrypoint
	program.pipe(Effect.scoped, Effect.provide(BunServices.layer)),
);
