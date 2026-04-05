import { Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	adminTokenRequestLayer,
	authenticatedExpoRequestLayer,
	authenticatedRequestLayer,
	publicRequestLayer,
	TransportEnvironment,
} from "./request-layer";

const fetchMock = vi.fn();
const expoFetchMock = vi.fn();
const authCookieMock = vi.fn((serverUrl: string) =>
	Promise.resolve(`session=${new URL(serverUrl).hostname}`),
);

const response = () => Promise.resolve(new Response(null, { status: 204 }));

const request = (layer: ReturnType<typeof publicRequestLayer>) =>
	Effect.runPromise(
		HttpClient.get("/probe").pipe(
			Effect.provide(layer),
			Effect.provide(
				Layer.succeed(TransportEnvironment, {
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					fetch: fetchMock as unknown as typeof globalThis.fetch,
					// oxlint-disable-next-line typescript/no-unsafe-type-assertion
					expoFetch: expoFetchMock as unknown as typeof globalThis.fetch,
					getAuthCookie: authCookieMock,
				}),
			),
			Effect.asVoid,
		),
	);

const requestDetails = (mock: typeof fetchMock, index = 0) => {
	// Vitest keeps variadic mock arguments wider than the fetch signature.
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion
	const [url, options] = mock.mock.calls[index] as unknown as [URL, RequestInit];
	return { url: url.toString(), options };
};

describe("server-bound transport", () => {
	beforeEach(() => {
		fetchMock.mockReset().mockImplementation(response);
		expoFetchMock.mockReset().mockImplementation(response);
		authCookieMock.mockClear();
	});

	it("uses the normalized explicit origin for public requests", async () => {
		await request(publicRequestLayer(" https://one.test/// "));

		expect(requestDetails(fetchMock)).toMatchObject({
			url: "https://one.test/api/probe",
			options: { headers: {} },
		});
		expect(authCookieMock).not.toHaveBeenCalled();
	});

	it("reads authentication cookies for the bound regular and Expo origins", async () => {
		await request(authenticatedRequestLayer(" https://one.test/// "));
		await request(authenticatedExpoRequestLayer("https://expo.test/"));

		expect(authCookieMock.mock.calls).toEqual([["https://one.test"], ["https://expo.test"]]);
		expect(requestDetails(fetchMock)).toMatchObject({
			url: "https://one.test/api/probe",
			options: { credentials: "include", headers: { cookie: "session=one.test" } },
		});
		expect(requestDetails(expoFetchMock)).toMatchObject({
			url: "https://expo.test/api/probe",
			options: { credentials: "include", headers: { cookie: "session=expo.test" } },
		});
	});

	it("keeps admin headers local to each request layer", async () => {
		await request(adminTokenRequestLayer("https://one.test", "admin-one"));
		await request(authenticatedRequestLayer("https://one.test"));
		await request(adminTokenRequestLayer("https://one.test", "admin-two"));

		expect(requestDetails(fetchMock, 0).options.headers).toMatchObject({
			"admin-access-token": "admin-one",
		});
		expect(requestDetails(fetchMock, 1).options.headers).not.toHaveProperty("admin-access-token");
		expect(requestDetails(fetchMock, 2).options.headers).toMatchObject({
			"admin-access-token": "admin-two",
		});
	});

	it("does not cross destinations when clients use two server URLs", async () => {
		await Promise.all([
			request(authenticatedRequestLayer("https://one.test/")),
			request(authenticatedRequestLayer("https://two.test///")),
		]);

		expect(
			fetchMock.mock.calls.map((_, index) => requestDetails(fetchMock, index).url).sort(),
		).toEqual(["https://one.test/api/probe", "https://two.test/api/probe"]);
		expect(authCookieMock.mock.calls.map(([serverUrl]) => serverUrl).sort()).toEqual([
			"https://one.test",
			"https://two.test",
		]);
	});
});
