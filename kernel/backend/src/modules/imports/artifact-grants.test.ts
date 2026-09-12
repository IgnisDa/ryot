import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { Effect, Layer } from "effect";

import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";
import { assertExitFails } from "#lib/test-utils/assertions";

import { ingestionArtifactGrants } from "./artifact-grants";
import { IngestionCaptures } from "./capture-service";
import { ingestionTestRun, ingestionTestScope } from "./ingestion.test-support";
import { ImportsRepository } from "./repository";

it.effect("grants a staged handle only to its pinned owner and account generation", () =>
	Effect.gen(function* () {
		const reads: unknown[] = [];
		const run = ingestionTestRun();
		const ownerExecutionId = run.pins?.executionId ?? "";
		const dependencies = Layer.mergeAll(
			Layer.mock(ImportsRepository)({
				getStagingOwner: (userId, generation, owner) =>
					Effect.succeed(
						userId === ingestionTestScope.userId &&
							generation.token === ingestionTestScope.accountGeneration.token &&
							owner === ownerExecutionId
							? run
							: null,
					),
			}),
			Layer.mock(IngestionCaptures)({
				resolveStaged: (scope, owner, handle) =>
					Effect.sync(() => {
						reads.push({ scope, owner, handle });
						return "/tmp/staged-input";
					}),
			}),
			Layer.mock(SandboxArtifactStore)({
				resolveOutputs: () => Effect.die("Staged handles must not use temporary outputs"),
			}),
		);
		yield* Effect.gen(function* () {
			const input = { artifactHandle: "staged-output" };
			const subject = {
				type: "user" as const,
				userId: ingestionTestScope.userId,
				accountGeneration: ingestionTestScope.accountGeneration,
			};
			const grants = {
				artifactOwnerExecutionId: ownerExecutionId,
				namedArtifactPaths: { original: "/tmp/original" },
			};
			expect(yield* ingestionArtifactGrants(input, subject, grants)).toEqual({
				...grants,
				artifactPath: "/tmp/staged-input",
			});
			expect(reads).toEqual([
				{ owner: ownerExecutionId, scope: ingestionTestScope, handle: input.artifactHandle },
			]);
			for (const [candidateSubject, candidateGrants] of [
				[subject, { ...grants, artifactOwnerExecutionId: "another-owner" }],
				[
					{ ...subject, accountGeneration: { ...subject.accountGeneration, token: "retired" } },
					grants,
				],
			] as const) {
				expect(
					(yield* Effect.exit(ingestionArtifactGrants(input, candidateSubject, candidateGrants)))
						._tag,
				).toBe("Failure");
			}
			expect(
				(yield* Effect.exit(ingestionArtifactGrants(input, { type: "system" }, grants)))._tag,
			).toBe("Failure");
			expect(reads).toHaveLength(1);
		}).pipe(Effect.provideContext(yield* Layer.build(dependencies)));
	}),
);

it.effect(
	"materializes one durable capture under its retained root owner on every activity activation",
	() =>
		Effect.gen(function* () {
			const reads: unknown[] = [];
			const dependencies = Layer.mergeAll(
				Layer.mock(ImportsRepository)({
					getIngestionRun: () => Effect.succeed(ingestionTestRun()),
					getCapture: () =>
						Effect.succeed({
							ordinal: 64,
							id: "page-1",
							state: "sealed",
							checkpoint: null,
							phase: "collection",
							payload: { byteSize: 10, locator: "owned", checksum: "checksum" },
						}),
				}),
				Layer.mock(IngestionCaptures)({
					materialize: (scope, id, maxBytes) =>
						Effect.sync(() => {
							reads.push({ id, scope, maxBytes });
							return "/tmp/materialized-capture";
						}),
				}),
				Layer.mock(SandboxArtifactStore)({}),
			);
			yield* Effect.gen(function* () {
				const input = {
					ingestionArtifact: { captureId: "page-1", runId: ingestionTestScope.runId },
				};
				const subject = {
					type: "user" as const,
					userId: ingestionTestScope.userId,
					accountGeneration: ingestionTestScope.accountGeneration,
				};
				const grants = { artifactOwnerExecutionId: "run-1-import" };
				expect(yield* ingestionArtifactGrants(input, subject, grants)).toEqual({
					...grants,
					artifactPath: "/tmp/materialized-capture",
				});
				yield* ingestionArtifactGrants(input, subject, grants);
				expect(reads).toEqual(
					Array.from({ length: 2 }, () => ({
						id: "page-1",
						scope: ingestionTestScope,
						maxBytes: 4 * 1024 * 1024,
					})),
				);
				assertExitFails(
					yield* ingestionArtifactGrants(input, subject, {
						artifactOwnerExecutionId: "another-root",
					}).pipe(Effect.exit),
					new SandboxRunError({
						kind: "invalid-input",
						message: "Ingestion artifact is not owned by this execution",
					}),
				);
				expect(reads).toHaveLength(2);
				const mergeInput = {
					ingestionArtifacts: {
						runId: ingestionTestScope.runId,
						captures: { left: "page-1", right: "page-2" },
					},
				};
				expect(yield* ingestionArtifactGrants(mergeInput, subject, grants)).toEqual({
					...grants,
					namedArtifactPaths: {
						left: "/tmp/materialized-capture",
						right: "/tmp/materialized-capture",
					},
				});
				yield* ingestionArtifactGrants(mergeInput, subject, grants);
				expect(reads.slice(2)).toEqual(
					Array.from({ length: 2 }, () =>
						["page-1", "page-2"].map((id) => ({
							id,
							scope: ingestionTestScope,
							maxBytes: 4 * 1024 * 1024,
						})),
					).flat(),
				);
				const beforeDenied = reads.length;
				expect(
					(yield* ingestionArtifactGrants(mergeInput, { type: "system" }, grants).pipe(Effect.exit))
						._tag,
				).toBe("Failure");
				expect(reads).toHaveLength(beforeDenied);
			}).pipe(Effect.provideContext(yield* Layer.build(dependencies)));
		}),
);

it.effect(
	"validates the entire capture selection before materializing and rejects admitted captures",
	() =>
		Effect.gen(function* () {
			const reads: string[] = [];
			const dependencies = Layer.mergeAll(
				Layer.mock(ImportsRepository)({
					getIngestionRun: (scope) =>
						Effect.succeed(
							scope.userId === ingestionTestScope.userId &&
								scope.accountGeneration.token === ingestionTestScope.accountGeneration.token
								? ingestionTestRun()
								: null,
						),
					getCapture: (_scope, id) =>
						Effect.succeed(
							id === "missing"
								? null
								: {
										id,
										state: "sealed",
										checkpoint: null,
										phase: "collection",
										ordinal: id === "admitted" ? 0 : 64,
										payload: { byteSize: 10, locator: "owned", checksum: "checksum" },
									},
						),
				}),
				Layer.mock(IngestionCaptures)({
					materialize: (_scope, id) =>
						Effect.sync(() => {
							reads.push(id);
							return `/tmp/${id}`;
						}),
				}),
				Layer.mock(SandboxArtifactStore)({}),
			);
			yield* Effect.gen(function* () {
				const subject = {
					type: "user" as const,
					userId: ingestionTestScope.userId,
					accountGeneration: ingestionTestScope.accountGeneration,
				};
				const grants = { artifactOwnerExecutionId: "run-1-import" };
				for (const id of ["missing", "admitted"]) {
					assertExitFails(
						yield* ingestionArtifactGrants(
							{
								ingestionArtifacts: {
									runId: ingestionTestScope.runId,
									captures: { right: id, left: "page-1" },
								},
							},
							subject,
							grants,
						).pipe(Effect.exit),
						new SandboxRunError({
							kind: "invalid-input",
							message: "Ingestion artifact is not owned by this execution",
						}),
					);
				}
				const foreignGeneration = {
					...subject,
					accountGeneration: { ...subject.accountGeneration, token: "another-generation" },
				};
				expect(
					(yield* ingestionArtifactGrants(
						{
							ingestionArtifacts: { captures: { left: "page-1" }, runId: ingestionTestScope.runId },
						},
						foreignGeneration,
						grants,
					).pipe(Effect.exit))._tag,
				).toBe("Failure");
				expect(reads).toEqual([]);
			}).pipe(Effect.provideContext(yield* Layer.build(dependencies)));
		}),
);
