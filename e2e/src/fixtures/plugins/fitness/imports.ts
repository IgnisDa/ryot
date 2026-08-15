import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { pollImportRunUntilTerminal, uploadImportFile } from "~/fixtures/kernel/imports";
import { requirePresent } from "~/support/assertions";

const OPENSCALE_SAMPLE_CSV = `dateTime,weight,bmi,fat,water,muscle,comment
2026-04-01 08:00:00,75.0,22.5,15.0,60.0,40.0,Morning weight
2026-04-02 08:00:00,74.8,22.4,14.9,60.2,40.1,
2026-04-03 08:00:00,75.2,22.6,15.1,60.0,40.0,After lunch
`;

export const startOpenScaleImport = (client: Client, uploadToken: string) =>
	Effect.gen(function* () {
		const result = yield* client.call((c) =>
			c.imports.createRun({ payload: { source: "open_scale", uploadToken } }),
		);

		return requirePresent(result.id, "Import run id is missing");
	});

export const runOpenScaleImportFixture = (client: Client, cookies: string) =>
	Effect.gen(function* () {
		const uploadToken = yield* uploadImportFile(
			cookies,
			OPENSCALE_SAMPLE_CSV,
			"openscale-export.csv",
			"text/csv",
		);

		const runId = yield* startOpenScaleImport(client, uploadToken);
		const completedRun = yield* pollImportRunUntilTerminal(client, runId);
		return { runId, completedRun };
	});

const HEVY_SAMPLE_CSV = `title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_order,weight_kg,reps,set_type,distance_m,duration_seconds
Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Good session,Bench Press,,Felt strong,1,100,5,normal,,
Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Good session,Bench Press,,,2,100,5,normal,,
Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Good session,Squat,,,1,140,3,normal,,
`;

export const runHevyImportFixture = (client: Client, cookies: string) =>
	Effect.gen(function* () {
		const uploadToken = yield* uploadImportFile(
			cookies,
			HEVY_SAMPLE_CSV,
			"hevy-export.csv",
			"text/csv",
		);

		const result = yield* client.call((c) =>
			c.imports.createRun({ payload: { source: "hevy", uploadToken } }),
		);
		const runId = requirePresent(result.id, "Import run id is missing");

		const completedRun = yield* pollImportRunUntilTerminal(client, runId);
		return { runId, completedRun };
	});
