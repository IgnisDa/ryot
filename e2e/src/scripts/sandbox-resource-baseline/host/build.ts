import { join } from "node:path";

const outfile = process.argv[2];
if (outfile === undefined) {
	console.error("usage: bun run host/build.ts <outfile>");
	process.exit(64);
}

const child = Bun.spawn(
	[
		process.execPath,
		"build",
		"--compile",
		"--target=bun-linux-x64",
		join(import.meta.dir, "main.ts"),
		"--outfile",
		outfile,
	],
	{ stdout: "inherit", stderr: "inherit" },
);
process.exit(await child.exited);
