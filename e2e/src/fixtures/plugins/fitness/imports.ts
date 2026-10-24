import type { ContractPayload } from "@ryot-app/contract/client";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { PluginId } from "@ryot-app/contract/schema/brands";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { pollImportRunUntilTerminal, uploadImportFile } from "~/fixtures/kernel/imports";
import { requirePresent } from "~/support/assertions";

import { findFitnessEntitySchema } from "./exercises";

type ImportRunFixtureBody = Omit<ContractPayload<"imports", "createRun">, "source"> & {
	source: string;
};

export const createFitnessImportRun = (
	client: Client,
	pluginId: PluginId,
	body: ImportRunFixtureBody,
) =>
	client.call((contract) =>
		contract.imports.createRun({
			payload: { ...body, source: { slug: body.source, owner: definitionOwner(pluginId) } },
		}),
	);

const OPENSCALE_SAMPLE_CSV = `dateTime,weight,bmi,fat,water,muscle,comment
2026-04-01 08:00:00,75.0,22.5,15.0,60.0,40.0,Morning weight
2026-04-02 08:00:00,74.8,22.4,14.9,60.2,40.1,
2026-04-03 08:00:00,75.2,22.6,15.1,60.0,40.0,After lunch
`;

export const startOpenScaleImport = (
	client: Client,
	pluginId: PluginId,
	body: { uploadToken: string; timezone: string },
) =>
	Effect.gen(function* () {
		const result = yield* createFitnessImportRun(client, pluginId, {
			...body,
			source: "open_scale",
		});
		return requirePresent(result.id, "Import run id is missing");
	});

export const runOpenScaleImportFixture = (client: Client) =>
	Effect.gen(function* () {
		const uploadToken = yield* uploadImportFile(
			client,
			OPENSCALE_SAMPLE_CSV,
			"openscale-export.csv",
			"text/csv",
		);

		const { pluginId } = yield* findFitnessEntitySchema(client, "exercise");
		const runId = yield* startOpenScaleImport(client, pluginId, { uploadToken, timezone: "UTC" });
		const completedRun = yield* pollImportRunUntilTerminal(client, runId);
		return { runId, completedRun };
	});

const HEVY_SAMPLE_CSV = `title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_order,weight_kg,reps,set_type,distance_m,duration_seconds
Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Good session,Bench Press,,Felt strong,1,100,5,normal,,
Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Good session,Bench Press,,,2,100,5,normal,,
Push Day,2026-01-01T10:00:00,2026-01-01T11:00:00,Good session,Squat,,,1,140,3,normal,,
`;

export const runHevyImportFixture = (client: Client) =>
	Effect.gen(function* () {
		const uploadToken = yield* uploadImportFile(
			client,
			HEVY_SAMPLE_CSV,
			"hevy-export.csv",
			"text/csv",
		);

		const { pluginId } = yield* findFitnessEntitySchema(client, "exercise");
		const result = yield* createFitnessImportRun(client, pluginId, {
			uploadToken,
			source: "hevy",
			timezone: "UTC",
		});
		const runId = requirePresent(result.id, "Import run id is missing");

		const completedRun = yield* pollImportRunUntilTerminal(client, runId);
		return { runId, completedRun };
	});
