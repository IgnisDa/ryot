import { afterAll } from "bun:test";

const noop = () => {};

console.log = noop;
console.info = noop;
console.warn = noop;
console.error = noop;

const originalCorsOrigins = process.env.SERVER_CORS_ORIGINS;
const testCorsOrigins = ["https://studio.example.com", "https://admin.example.com"];
const corsOrigins = new Set(
	(originalCorsOrigins ?? "")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean),
);

for (const origin of testCorsOrigins) {
	corsOrigins.add(origin);
}

process.env.SERVER_CORS_ORIGINS = Array.from(corsOrigins).join(", ");

afterAll(() => {
	if (originalCorsOrigins === undefined) {
		delete process.env.SERVER_CORS_ORIGINS;
		return;
	}

	process.env.SERVER_CORS_ORIGINS = originalCorsOrigins;
});
