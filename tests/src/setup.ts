import { afterAll, beforeAll } from "bun:test";
import type { ChildProcess } from "node:child_process";

import type { paths } from "@ryot/generated/openapi/app-backend";
import { config } from "dotenv";
import getPort from "get-port";
import createClient from "openapi-fetch";
import { Client as PgClient } from "pg";

import { requirePresent } from "./test-support/assertions";
import {
	attachProcessLogs,
	buildBackendEnv,
	startCoreTestInfrastructure,
	spawnBackendProcess,
	stopBackendProcess,
	stopCoreTestInfrastructure,
	waitForHealthCheck,
} from "./test-support/provisioning";

config({ path: ".env" });

const S3_BUCKET_NAME = "ryot-test";
const exerciseScriptSlug = "exercise.free-exercise-db";
const seededExerciseImageUrl =
	"https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/3_4_Sit-Up/0.jpg";
const seededExercises = [
	{
		name: "3/4 Sit-Up",
		externalId: "test-exercise-3-4-sit-up",
		image: { type: "remote", url: seededExerciseImageUrl },
		properties: {
			force: "pull",
			level: "beginner",
			mechanic: "isolation",
			equipment: "body_only",
			kind: "reps_and_weight",
			muscles: ["abdominals", "lower_back"],
			images: [{ type: "remote", url: seededExerciseImageUrl }],
			instructions: ["Lie on your back.", "Raise your torso partway toward your knees."],
		},
	},
	{
		image: null,
		name: "Bench Press",
		externalId: "test-exercise-bench-press",
		properties: {
			images: [],
			force: "push",
			mechanic: "compound",
			equipment: "barbell",
			level: "intermediate",
			kind: "reps_and_weight",
			muscles: ["chest", "triceps"],
			instructions: ["Lie on the bench.", "Press the barbell upward until your arms extend."],
		},
	},
] as const;

let coreInfrastructure: Awaited<ReturnType<typeof startCoreTestInfrastructure>> | undefined;
let pgClient: PgClient | undefined;
let backendPort: number;
let backendProcess: ChildProcess | undefined;

function requireCoreInfrastructure() {
	return requirePresent(coreInfrastructure, "Test infrastructure is not initialised");
}

function requirePgClient() {
	return requirePresent(pgClient, "PG client is not initialised");
}

async function seedBuiltinExercisesForTests(pg: PgClient) {
	const idsResult = await pg.query<{ entitySchemaId: string; scriptId: string }>(
		`select es.id as "entitySchemaId", ss.id as "scriptId"
		 from entity_schema es
		 inner join sandbox_script ss on ss.slug = $2
		 where es.slug = $1
		   and es.user_id is null
		   and ss.user_id is null
		 limit 1`,
		["exercise", exerciseScriptSlug],
	);
	const ids = requirePresent(idsResult.rows[0], "Missing built-in exercise schema or provider");

	for (const exercise of seededExercises) {
		// oxlint-disable-next-line no-await-in-loop
		await pg.query(
			`insert into entity (
				id,
				name,
				image,
				user_id,
				properties,
				external_id,
				entity_schema_id,
				sandbox_script_id
			)
			select $1, $2, $3::jsonb, null, $4::jsonb, $5, $6, $7
			where not exists (
				select 1
				from entity
				where user_id is null
				  and external_id = $5
				  and entity_schema_id = $6
			)`,
			[
				crypto.randomUUID(),
				exercise.name,
				JSON.stringify(exercise.image),
				JSON.stringify(exercise.properties),
				exercise.externalId,
				ids.entitySchemaId,
				ids.scriptId,
			],
		);
	}
}

beforeAll(async () => {
	coreInfrastructure = await startCoreTestInfrastructure({
		bucketName: S3_BUCKET_NAME,
	});

	const frontendPort = await getPort();

	backendPort = await getPort();
	const infrastructure = requireCoreInfrastructure();

	backendProcess = spawnBackendProcess(
		buildBackendEnv({
			dbUrl: infrastructure.dbUrl,
			frontendUrl: `http://127.0.0.1:${frontendPort}`,
			port: backendPort,
			redisUrl: infrastructure.redisUrl,
			s3BucketName: S3_BUCKET_NAME,
			s3Endpoint: infrastructure.s3Endpoint,
			extraEnv: {
				SERVER_OIDC_CLIENT_ID: "",
				SERVER_OIDC_ISSUER_URL: "",
				SERVER_OIDC_CLIENT_SECRET: "",
			},
		}),
	);
	attachProcessLogs(backendProcess, "Backend");

	const healthCheckUrl = `http://127.0.0.1:${backendPort}/api/system/health`;
	await waitForHealthCheck(healthCheckUrl, "E2E Setup");

	pgClient = new PgClient({ connectionString: infrastructure.dbUrl });
	await pgClient.connect();
	await seedBuiltinExercisesForTests(pgClient);
}, 120000);

afterAll(async () => {
	if (backendProcess) {
		await stopBackendProcess(backendProcess);
	}

	await Promise.all([pgClient?.end(), stopCoreTestInfrastructure(coreInfrastructure)]);
});

export function getS3Client() {
	return requireCoreInfrastructure().s3Client;
}

export function getS3BucketName() {
	return S3_BUCKET_NAME;
}

export function getBackendUrl() {
	return `http://127.0.0.1:${backendPort}/api`;
}

export function getBackendClient() {
	const client = createClient<paths>({ baseUrl: getBackendUrl() });
	return client;
}

export function getPgClient() {
	return requirePgClient();
}
