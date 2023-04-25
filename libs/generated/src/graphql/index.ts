import { join, resolve } from "node:path";

export const definitionsLibraryPath = join(
	resolve(__dirname, "../../../"),
	"graphql",
	"src",
);
