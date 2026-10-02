import { execFileSync } from "node:child_process";

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function executeTestDatabaseSql(sql: string) {
	const containerId = process.env.TEST_DATABASE_CONTAINER_ID;
	if (!containerId) {
		throw new Error("TEST_DATABASE_CONTAINER_ID is not set");
	}
	return execFileSync(
		"docker",
		[
			"exec",
			containerId,
			"psql",
			"-U",
			"test-user",
			"-d",
			"test-db",
			"-v",
			"ON_ERROR_STOP=1",
			"-c",
			sql,
		],
		{ encoding: "utf8" },
	);
}

function updateCacheRow(key: Record<string, string>, update: string) {
	const output = executeTestDatabaseSql(
		`UPDATE application_cache SET ${update} WHERE key = ${sqlString(JSON.stringify(key))}`,
	);
	if (!/\bUPDATE 1\s*$/.test(output)) {
		throw new Error(
			"Expected to update exactly one matching application cache row",
		);
	}
}

export function agePasswordChangeSession(token: string) {
	updateCacheRow(
		{ UserPasswordChangeSession: token },
		"created_at = now() - interval '31 minutes', expires_at = now() + interval '1 hour'",
	);
}

export function expirePasswordChangeSession(token: string) {
	updateCacheRow(
		{ UserPasswordChangeSession: token },
		"expires_at = now() - interval '1 minute'",
	);
}

export function expireOidcAuthorizationSession(state: string) {
	updateCacheRow(
		{ OidcAuthorizationSession: state },
		"expires_at = now() - interval '1 minute'",
	);
}
