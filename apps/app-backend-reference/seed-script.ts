import { FetchHttpClient, HttpApiClient, HttpClient, HttpClientRequest } from "@effect/platform";
import { Effect, Schedule } from "effect";

import { AppContract } from "./src/contract";

type SeedSummary = {
	readonly email: string;
	readonly uploadId: string | null;
	readonly queryRunId: string;
	readonly batchRunId: string;
	readonly sandboxRunId: string;
	readonly queryMatches: number;
	readonly batchMatches: number;
};

class SeedError {
	readonly _tag = "SeedError";
	constructor(readonly message: string) {}
}

const baseUrl = "http://localhost:3000";

const authFetch = async (path: string, body: unknown) => {
	const response = await fetch(`${baseUrl}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		throw new Error(`${path} failed with ${response.status}`);
	}
	return response;
};

const signUpAndIn = async () => {
	const email = `reference-${crypto.randomUUID()}@ryot-ref.dev`;
	const password = "reference-password-123";
	await authFetch("/api/auth/sign-up/email", { email, password, name: "Reference User" });
	const response = await authFetch("/api/auth/sign-in/email", { email, password });
	const cookie = response.headers
		.get("set-cookie")
		?.split(",")
		.map((part) => part.split(";")[0])
		.join("; ");
	if (!cookie) {
		throw new Error("Better Auth did not return a session cookie");
	}
	return { email, cookie };
};

const pollUntil = <A, E>(effect: Effect.Effect<A, E>, predicate: (value: A) => boolean) =>
	effect.pipe(
		Effect.filterOrFail(
			predicate,
			(last) => new SeedError(`Timed out while polling; last value: ${JSON.stringify(last)}`),
		),
		Effect.retry(Schedule.addDelay(Schedule.recurs(59), () => "500 millis")),
	);

export const runSeedProgram = Effect.gen(function* () {
	const { email, cookie } = yield* Effect.promise(signUpAndIn);
	const client = yield* HttpApiClient.make(AppContract, {
		baseUrl: `${baseUrl}/api`,
		transformClient: HttpClient.mapRequest(HttpClientRequest.setHeader("cookie", cookie)),
	});

	const formData = new FormData();
	formData.append("files", new Blob(["Project Hail Mary\n"]), "queries.txt");
	const uploads = yield* client.uploads.uploadTemporary({ payload: formData });
	const uploadId = uploads[0]?.id ?? null;

	const queryRun = yield* client.audible.create({
		payload: { query: "Project Hail Mary" },
	});
	const queryAwaitingConfirmation = yield* pollUntil(
		client.audible.get({ path: { runId: queryRun.run.id } }),
		(detail) =>
			detail.run.status === "awaiting_confirmation" ||
			detail.run.status === "expired" ||
			detail.run.status === "failed",
	);
	if (queryAwaitingConfirmation.run.status !== "awaiting_confirmation") {
		return yield* Effect.fail(
			new SeedError(
				`Audible query run did not await confirmation: ${JSON.stringify(queryAwaitingConfirmation)}`,
			),
		);
	}
	yield* client.audible.confirmImport({ path: { runId: queryRun.run.id } });
	const queryCompleted = yield* pollUntil(
		client.audible.get({ path: { runId: queryRun.run.id } }),
		(detail) => detail.run.status === "completed" || detail.run.status === "failed",
	);
	const queryMatches = queryCompleted.finalResult?.matchedItems ?? 0;
	if (queryCompleted.run.status !== "completed" || queryMatches === 0) {
		return yield* Effect.fail(
			new SeedError(`Audible query run did not match any items: ${JSON.stringify(queryCompleted)}`),
		);
	}

	if (!uploadId) {
		return yield* Effect.fail(new SeedError("Upload endpoint did not return an upload id"));
	}

	const batchRun = yield* client.audible.create({ payload: { uploadId } });
	const batchAwaitingConfirmation = yield* pollUntil(
		client.audible.get({ path: { runId: batchRun.run.id } }),
		(detail) =>
			detail.run.status === "awaiting_confirmation" ||
			detail.run.status === "expired" ||
			detail.run.status === "failed",
	);
	if (batchAwaitingConfirmation.run.status !== "awaiting_confirmation") {
		return yield* Effect.fail(
			new SeedError(
				`Audible batch run did not await confirmation: ${JSON.stringify(batchAwaitingConfirmation)}`,
			),
		);
	}
	yield* client.audible.confirmImport({ path: { runId: batchRun.run.id } });
	const batchCompleted = yield* pollUntil(
		client.audible.get({ path: { runId: batchRun.run.id } }),
		(detail) => detail.run.status === "completed" || detail.run.status === "failed",
	);
	const batchMatches = batchCompleted.finalResult?.matchedItems ?? 0;
	if (batchCompleted.run.status !== "completed" || batchMatches === 0) {
		return yield* Effect.fail(
			new SeedError(`Audible batch run did not match any items: ${JSON.stringify(batchCompleted)}`),
		);
	}

	const sandbox = yield* client.sandbox.run({
		payload: {
			context: { query: "Project Hail Mary", page: 1, pageSize: 2 },
			driverName: "search",
			scriptSlug: "audiobook.audible",
		},
	});
	const sandboxCompleted = yield* pollUntil(
		client.sandbox.get({ path: { runId: sandbox.id } }),
		(run) => run.status === "completed" || run.status === "failed",
	);
	if (sandboxCompleted.status !== "completed") {
		return yield* Effect.fail(
			new SeedError(
				`Sandbox run did not complete successfully: ${JSON.stringify(sandboxCompleted)}`,
			),
		);
	}

	// This is fully typed
	yield* client.patterns.filterCondition({
		payload: {
			filter: {
				kind: "and",
				conditions: [
					{ kind: "contains", value: "Hail" },
					{ kind: "not", condition: { kind: "equals", value: "Martian" } },
				],
			},
		},
	});

	return {
		email,
		uploadId,
		queryRunId: queryRun.run.id,
		batchRunId: batchRun.run.id,
		sandboxRunId: sandbox.id,
		queryMatches,
		batchMatches,
	} satisfies SeedSummary;
});

if (import.meta.main) {
	const summary = await Effect.runPromise(
		runSeedProgram.pipe(Effect.provide(FetchHttpClient.layer)),
	);
	console.log(JSON.stringify(summary, null, 2));
}
