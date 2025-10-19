import { expect, it } from "@effect/vitest";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect, Exit, Layer } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import { ValidationError } from "../../lib/errors";
import { UploadsRepository } from "../uploads/repository";
import { AudibleRepository } from "./repository";
import type { AudibleRun, AudibleRunDetail } from "./schemas";
import { AudibleService } from "./service";

const user = {
	id: "user-id",
	name: "Test User",
	email: "user@ryot-ref.dev",
} satisfies CurrentUserValue;

const makeRun = (input: { readonly query?: string; readonly uploadId?: string }) =>
	({
		id: "run-id",
		userId: user.id,
		query: input.query ?? null,
		status: "queued",
		uploadId: input.uploadId ?? null,
		executionId: "run-id",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	}) satisfies AudibleRun;

const makeDetail = (run: AudibleRun, workflowPoll: string | null) =>
	({
		run,
		items: [],
		steps: [],
		workflowPoll,
		finalResult: null,
	}) satisfies AudibleRunDetail;

const TestAudibleService = AudibleService.Default.pipe(
	Layer.provide(
		Layer.mergeAll(
			Layer.mock(WorkflowEngine, {
				execute: () => Effect.succeed("run-id"),
			}),
			Layer.mock(AudibleRepository, {
				_tag: "AudibleRepository" as const,
				createRun: (_userId, input) => Effect.succeed(makeRun(input)),
				getConfirmationToken: () =>
					Effect.succeed({
						run: makeRun({ query: "Dune" }),
						token: null,
					}),
				getDetail: (_userId, _runId, workflowPoll) =>
					Effect.succeed(makeDetail(makeRun({ query: "Dune" }), workflowPoll ?? null)),
			}),
			Layer.mock(UploadsRepository, {
				_tag: "UploadsRepository" as const,
				getOwnedById: () =>
					Effect.succeed({
						id: "upload-id",
						size: 12,
						userId: user.id,
						contents: "Dune\n",
						fileName: "queries.txt",
						contentType: "text/plain",
						createdAt: "2026-01-01T00:00:00.000Z",
					}),
			}),
		),
	),
);

it.effect("creates an Audible run from a query with fake layers", () =>
	Effect.gen(function* () {
		const service = yield* AudibleService;
		const detail = yield* service.create(user, { query: "Dune" });

		expect(detail.workflowPoll).toBe("started");
		expect(detail.run.query).toBe("Dune");
	}).pipe(Effect.provide(TestAudibleService)),
);

it.effect("rejects invalid Audible run inputs", () =>
	Effect.gen(function* () {
		const service = yield* AudibleService;
		const exit = yield* Effect.exit(service.create(user, {}));

		expect(exit).toEqual(
			Exit.fail(new ValidationError({ message: "Provide exactly one of query or uploadId" })),
		);
	}).pipe(Effect.provide(TestAudibleService)),
);

it.effect("rejects import confirmation before the workflow is waiting", () =>
	Effect.gen(function* () {
		const service = yield* AudibleService;
		const exit = yield* Effect.exit(service.confirmImport(user, "run-id"));

		expect(exit).toEqual(
			Exit.fail(new ValidationError({ message: "Audible import is not awaiting confirmation" })),
		);
	}).pipe(Effect.provide(TestAudibleService)),
);
