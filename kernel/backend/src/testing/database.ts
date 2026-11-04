import { assert } from "@ryot-app/testing/assert";

export const testDatabaseUrl = () => {
	const url = Bun.env["TEST_DATABASE_URL"];
	assert(url, "Run database tests through the package test script");
	return url;
};
