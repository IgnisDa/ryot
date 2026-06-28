import type { SandboxHost } from "@ryot/sandbox-sdk";
import { defineSandboxTestHost, runSandboxTestDriver } from "@ryot/sandbox-sdk/testing";
import { describe, expect, it } from "vitest";

import { details, manifest, search } from "./metron.sandbox";

type MetronPersonHost = SandboxHost<typeof manifest.capabilities>;

const httpSuccess = (body: unknown) =>
	Promise.resolve({
		success: true as const,
		data: { status: 200, headers: {}, body: JSON.stringify(body) },
	});

const makeHost = (httpCall: MetronPersonHost["httpCall"]) =>
	defineSandboxTestHost(manifest, {
		httpCall,
		getAppConfigValue: (key) =>
			Promise.resolve({
				success: true as const,
				data: key === "providers.metronUsername" ? "user" : "pass",
			}),
	});

const execution = { metadata: {}, sandboxScriptId: "script_test" };

describe("person.metron sandbox script", () => {
	it("maps creator search hits and drops entries missing id or name", () => {
		const host = makeHost(() =>
			httpSuccess({
				count: 2,
				results: [
					{ id: 3, name: "Jane Doe", birth: "1980-05-01", image: "https://img/jane.jpg" },
					{ id: 4, name: "" },
				],
			}),
		);

		return runSandboxTestDriver(
			search,
			{ query: "jane", page: 1, pageSize: 20 },
			host,
			execution,
		).then((result) => {
			expect(result.items).toEqual([
				{
					externalId: "3",
					calloutProperty: { kind: "null", value: null },
					titleProperty: { kind: "text", value: "Jane Doe" },
					primarySubtitleProperty: { kind: "number", value: 1980 },
					secondarySubtitleProperty: { kind: "null", value: null },
					imageProperty: { kind: "image", value: { type: "remote", url: "https://img/jane.jpg" } },
				},
			]);
			expect(result.details).toEqual({ totalItems: 2, nextPage: null });
			return undefined;
		});
	});

	it("maps creator details into person properties", () => {
		const host = makeHost(() =>
			httpSuccess({
				name: "Jane Doe",
				death: null,
				birth: "1980-05-01",
				desc: "A creator.",
				image: "https://img/jane.jpg",
			}),
		);

		return runSandboxTestDriver(details, { externalId: "3" }, host, execution).then((result) => {
			expect(result.name).toBe("Jane Doe");
			expect(result.properties).toEqual({
				deathDate: null,
				alternateNames: [],
				birthDate: "1980-05-01",
				description: "A creator.",
				sourceUrl: "https://metron.cloud/creator/3",
				images: [{ type: "remote", url: "https://img/jane.jpg" }],
			});
			return undefined;
		});
	});
});
