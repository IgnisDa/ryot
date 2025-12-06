import { expect, it } from "@effect/vitest";
import { SandboxRunError } from "@ryot/contract/errors";
import type { SandboxCompletedResult } from "@ryot/contract/modules/sandbox/schemas";
import { Effect, Exit, Layer } from "effect";

import { type MockOverrides, dbRunnerLayer } from "#lib/test-support/effect";

import { resolveProviderSandboxArtifact } from "./provider-artifacts";
import { SandboxRepository } from "./repository";

const mockSandboxRepository = Layer.mock(SandboxRepository);

const makeSandboxRepository = (overrides: MockOverrides<typeof mockSandboxRepository> = {}) =>
	mockSandboxRepository({ _tag: "SandboxRepository", ...overrides });

const artifactResult: SandboxCompletedResult = {
	logs: [],
	error: null,
	status: "completed",
	value: { kind: "provider_artifact", id: "artifact-1" },
};

it.effect("rehydrates provider values from a durable artifact reference", () =>
	Effect.gen(function* () {
		const result = yield* resolveProviderSandboxArtifact({
			result: artifactResult,
			executionId: "provider-execution-1",
		});

		expect(result.value).toEqual({ rows: [1, 2, 3] });
	}).pipe(
		Effect.provide(
			Layer.merge(
				dbRunnerLayer,
				makeSandboxRepository({
					getProviderArtifact: () => Effect.succeed({ value: { rows: [1, 2, 3] } }),
				}),
			),
		),
	),
);

it.effect("fails when a provider artifact is missing", () =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(
			resolveProviderSandboxArtifact({
				result: artifactResult,
				executionId: "provider-execution-1",
			}),
		);

		expect(exit).toEqual(
			Exit.fail(
				new SandboxRunError({ message: "Sandbox provider artifact 'artifact-1' was not found" }),
			),
		);
	}).pipe(
		Effect.provide(
			Layer.merge(
				dbRunnerLayer,
				makeSandboxRepository({ getProviderArtifact: () => Effect.succeed(null) }),
			),
		),
	),
);

it.effect("does not inspect raw provider values for artifact references", () =>
	Effect.gen(function* () {
		const rawValue = { kind: "durable_artifact", id: "artifact-1", source: "provider" };
		const result = yield* resolveProviderSandboxArtifact({
			executionId: "provider-execution-1",
			result: { ...artifactResult, value: { kind: "provider_value", value: rawValue } },
		});

		expect(result.value).toEqual(rawValue);
	}).pipe(
		Effect.provide(
			Layer.merge(
				dbRunnerLayer,
				makeSandboxRepository({
					getProviderArtifact: () =>
						Effect.die("raw provider values must not be resolved as artifacts"),
				}),
			),
		),
	),
);
