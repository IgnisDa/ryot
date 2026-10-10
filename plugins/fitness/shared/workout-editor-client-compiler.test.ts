import { BunFileSystem, BunPath } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { PluginPackageId } from "@ryot-app/contract/schema/brands";
import { compileClientPluginModule } from "@ryot-app/plugin-client-compiler";
import { CLIENT_API_VERSION, clientDeclarationHash } from "@ryot-app/plugin-client-contract";
import { ViteBuildService } from "@ryot-app/vite-compiler";
import { Effect, FileSystem, Layer } from "effect";

const bytes = (contents: string) => new TextEncoder().encode(contents);
const sharedFiles = [
	"exercise-kinds.ts",
	"workout-editor-draft.ts",
	"workout-editor-operations.ts",
	"workout-editor-preferences.ts",
	"workout-editor-transformations.ts",
	"workout-records.ts",
	"workout-set.ts",
	"workout-units.ts",
] as const;

const compilerLayer = Layer.mergeAll(
	BunPath.layer,
	BunFileSystem.layer,
	Layer.succeed(
		ViteBuildService,
		ViteBuildService.of({
			build: () =>
				Effect.succeed({
					output: [
						{ type: "chunk", fileName: "module.js", code: "export default {};" },
						{ source: "", type: "asset", fileName: "module.css" },
					],
				}),
		}),
	),
);

const entry = `
import { WorkoutEditorDraftSchema } from "../shared/workout-editor-draft";
import { WorkoutEditorSaveInputSchema, WorkoutEditorSaveOutputSchema } from "../shared/workout-editor-operations";
import { buildWorkoutEditorSaveInput, cloneWorkoutForRepeat, validateWorkoutDraft } from "../shared/workout-editor-transformations";

export const contracts = [WorkoutEditorDraftSchema, WorkoutEditorSaveInputSchema, WorkoutEditorSaveOutputSchema, buildWorkoutEditorSaveInput, cloneWorkoutForRepeat, validateWorkoutDraft];
export default function WorkoutEditorContractPage() { return null; }
`;

layer(compilerLayer)((test) =>
	test.effect("compiles editor shared modules under the client shared-source policy", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const sharedSources = yield* Effect.forEach(sharedFiles, (file) =>
				fs
					.readFile(`shared/${file}`)
					.pipe(Effect.map((contents) => [`shared/${file}`, contents] as const)),
			);
			const input = {
				name: "Fitness",
				kind: "plugin" as const,
				apiVersion: CLIENT_API_VERSION,
				packageId: PluginPackageId.make("ryot/fitness"),
				files: Object.fromEntries([...sharedSources, ["client/contracts.ts", bytes(entry)]]),
				publicExports: { contracts: { kind: "component" as const, entry: "client/contracts.ts" } },
				clientDeclarationHash: clientDeclarationHash({
					homeView: null,
					apiVersion: CLIENT_API_VERSION,
				}),
			};
			const compiled = yield* compileClientPluginModule(input);
			expect(compiled.artifact.files.map(({ name }) => name)).toContain("module.js");
		}),
	),
);
