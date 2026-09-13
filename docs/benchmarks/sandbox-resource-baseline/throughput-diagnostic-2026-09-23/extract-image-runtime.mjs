import { writeFileSync } from "node:fs";
const map = JSON.parse(await Bun.file("/home/ryot/dist/main.js.map").text());
const generated = (name) => {
	const index = map.sources.findIndex((source) =>
		source.endsWith(`sandbox-runtime/${name}.generated.ts`),
	);
	if (index < 0) throw new Error(`Missing generated ${name}`);
	const source = map.sourcesContent[index];
	return JSON.parse(source.slice(source.indexOf("=") + 1).replace(/(?: as const)?;\s*$/, ""));
};
const payload = generated("runtime-payload");
for (const file of payload.files) writeFileSync(`/output/${file.path}`, file.contents);
writeFileSync("/output/runner.mjs", generated("runner"));
console.log(
	JSON.stringify({
		contentHash: payload.contentHash,
		effect: payload.metadata.dependencies.find((d) => d.name === "effect").version,
	}),
);
