import { expect, it } from "@effect/vitest";
import type { IngestionIssue } from "@ryot-app/contract/modules/imports/ingestion";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema, Stream } from "effect";

import { createIssuesExport } from "./issue-export";

const issue = (index: number): IngestionIssue => ({
	operationId: `play-${index}`,
	recordKind: "listening-event",
	id: `issue-${String(index).padStart(3, "0")}`,
	severity: index % 2 === 0 ? "warning" : "error",
	reason: { key: "spotify", code: "provider-unavailable" },
	attribution: { sourceLabel: "Song", recordId: `row-${index}`, sourceIdentifier: "track-1" },
});

it.effect("streams bounded issue pages with complete attribution and run failure detail", () =>
	Effect.gen(function* () {
		const issues = Array.from({ length: 201 }, (_, index) => ({ data: issue(index) }));
		const cursors: (string | undefined)[] = [];
		const report = createIssuesExport({
			source: "spotify",
			runId: ImportRunId.make("run"),
			failureReason: { code: "source-fetch-failed" },
			listPage: (after) => {
				cursors.push(after);
				const start =
					after === undefined ? 0 : issues.findIndex(({ data }) => data.id === after) + 1;
				return Effect.succeed(issues.slice(start, start + 100));
			},
		});
		expect(cursors).toEqual([]);
		const chunks = yield* Stream.runCollect(report.stream);
		const text = chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
		expect(yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text)).toEqual({
			runId: "run",
			source: "spotify",
			issues: issues.map(({ data }) => data),
			failureReason: { code: "source-fetch-failed" },
		});
		expect(cursors).toEqual([undefined, "issue-099", "issue-199"]);
		expect(report.fileName).toBe("ryot-import-issues-run.json");
	}),
);

it.effect("excludes internal payload and credential fields from exported diagnostics", () =>
	Effect.gen(function* () {
		const data = {
			...issue(0),
			secret: "credential",
			locator: "private-object-path",
			reason: { ...issue(0).reason, token: "oauth-token" },
			attribution: {
				...issue(0).attribution,
				recordId: "row-0",
				sourceLabel: "Song",
				locator: "capture-path",
				sourceIdentifier: "track-1",
			},
		};
		const report = createIssuesExport({
			source: "spotify",
			failureReason: null,
			runId: ImportRunId.make("run"),
			listPage: () => Effect.succeed([{ data }]),
		});
		const chunks = yield* Stream.runCollect(report.stream);
		const text = chunks.map((chunk) => new TextDecoder().decode(chunk)).join("");
		expect(yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text)).toEqual({
			runId: "run",
			source: "spotify",
			issues: [issue(0)],
			failureReason: null,
		});
	}),
);

it.effect("does not request another page after the download is interrupted", () =>
	Effect.gen(function* () {
		const cursors: (string | undefined)[] = [];
		const report = createIssuesExport({
			source: "spotify",
			failureReason: null,
			runId: ImportRunId.make("run"),
			listPage: (after) => {
				cursors.push(after);
				return Effect.succeed(Array.from({ length: 100 }, (_, index) => ({ data: issue(index) })));
			},
		});
		yield* Stream.runCollect(report.stream.pipe(Stream.take(2)));
		expect(cursors).toEqual([undefined]);
	}),
);
