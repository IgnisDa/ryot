import { spawnSync } from "node:child_process";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import sharp from "sharp";

const BRAND = "#fd7e14";
const DEBUG = "#4dabf7";
const ICON = "AppIcon-512@2x.png";

const CLIENT = new URL("..", import.meta.url).pathname;
const WEB = join(CLIENT, "public");
const SOURCE = join(CLIENT, "assets/icon-only.png");
const RESOURCES = join(CLIENT, "android/app/src/main/res");
const CATALOG = join(CLIENT, "ios/App/App/Assets.xcassets");
const BIN = join(CLIENT, "node_modules/.bin/capacitor-assets");

const generate = (background: string, ...args: string[]) => {
	const { status } = spawnSync(
		BIN,
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
		{ cwd: CLIENT, stdio: "inherit" },
	);

	if (status !== 0) {
		throw new Error(`capacitor-assets exited with ${String(status)}`);
	}
};

// `icon-only.png` bakes the brand orange into its pixels, so no background colour can move the iOS
// icon off brand. The debug icon comes from `assets/dev`, where the transparent mark is the only
// source and the colour does apply. That pass writes the production set, so the icon is claimed
// into the set the Xcode target selects for Debug before the production pass restores it.
generate(DEBUG, "--ios", "--assetPath", "assets/dev");

const debugIcon = join(CATALOG, "AppIconDev.appiconset");

await mkdir(debugIcon, { recursive: true });
await rename(join(CATALOG, "AppIcon.appiconset", ICON), join(debugIcon, ICON));
await writeFile(
	join(debugIcon, "Contents.json"),
	`{
  "images": [
    {
      "idiom": "universal",
      "size": "1024x1024",
      "filename": "${ICON}",
      "platform": "ios"
    }
  ],
  "info": {
    "author": "xcode",
    "version": 1
  }
}
`,
);

// `capacitor-assets` scales the iOS splash logo relative to the source image but the Android one
// relative to the target canvas, so each platform needs its own size for the mark to land at
// roughly the 100pt the retired Expo client used.
generate(BRAND, "--ios", "--logoSplashTargetWidth", "512");
generate(BRAND, "--android", "--logoSplashScale", "0.4");

// `capacitor-assets` insets both adaptive-icon layers into the 72dp safe zone and emits a solid
// colour background bitmap per density. An adaptive background must be full-bleed, or launcher
// parallax reveals transparent edges, so the layers are rewritten to reference the brand colour
// directly and the redundant bitmaps are dropped. Referencing the colour is also what lets the
// debug resource overlay give the debug variant its own launcher icon.
await Promise.all(
	["ic_launcher.xml", "ic_launcher_round.xml"].map((name) =>
		writeFile(
			join(RESOURCES, "mipmap-anydpi-v26", name),
			`<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`,
		),
	),
);

const directories = await readdir(RESOURCES);

await Promise.all(
	directories
		.filter((directory) => directory.startsWith("mipmap-"))
		.map((directory) =>
			rm(join(RESOURCES, directory, "ic_launcher_background.png"), { force: true }),
		),
);

// `index.html` links these two directly. `capacitor-assets` only writes into the native projects,
// and its `--pwa` mode emits a whole Apple splash set under names of its own, so the web icons are
// resized here from the same source the iOS icon uses.
await sharp(SOURCE).resize(64).png().toFile(join(WEB, "favicon.png"));
await sharp(SOURCE).resize(180).png().toFile(join(WEB, "apple-touch-icon.png"));
