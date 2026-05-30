import { Effect, Layer } from "effect";
import { HttpClient } from "effect/unstable/http";
import { describe, expect, it } from "vitest";

import {
	adminTokenRequestLayer,
	authenticatedExpoRequestLayer,
	authenticatedRequestLayer,
	publicRequestLayer,
	TransportEnvironment,
} from "./request-layer";

type FetchCall = {
	readonly options?: RequestInit;
	readonly input: RequestInfo | URL;
};

const recordFetch = (calls: FetchCall[]): typeof globalThis.fetch =>
	Object.assign(
		(input: RequestInfo | URL, options?: RequestInit) => {
			calls.push({ input, options });
			return Promise.resolve(new Response(null, { status: 204 }));
		},
		{ preconnect: () => undefined },
	);

const makeTransportHarness = () => {
	const fetchCalls: FetchCall[] = [];
	const expoFetchCalls: FetchCall[] = [];
	const authCookieServerUrls: string[] = [];
	const environment = Layer.succeed(TransportEnvironment, {
		fetch: recordFetch(fetchCalls),
		expoFetch: recordFetch(expoFetchCalls),
		getAuthCookie: (serverUrl) => {
			authCookieServerUrls.push(serverUrl);
			return Promise.resolve(`session=${new URL(serverUrl).hostname}`);
		},
	});
	const request = (layer: ReturnType<typeof publicRequestLayer>) =>
		Effect.runPromise(
			HttpClient.get("/probe").pipe(
				Effect.provide(layer),
				Effect.provide(environment),
				Effect.asVoid,
			),
		);
	return { authCookieServerUrls, expoFetchCalls, fetchCalls, request };
};

const requestDetails = (call: FetchCall) => ({
	url: call.input instanceof Request ? call.input.url : call.input.toString(),
	options: call.options,
});

describe("server-bound transport", () => {
	it("uses the normalized explicit origin for public requests", async () => {
		const harness = makeTransportHarness();
		await harness.request(publicRequestLayer(" https://one.test/// "));

		expect(requestDetails(harness.fetchCalls[0])).toMatchObject({
			options: { headers: {} },
			url: "https://one.test/api/probe",
		});
		expect(harness.authCookieServerUrls).toEqual([]);
	});

	it("reads authentication cookies for the bound regular and Expo origins", async () => {
		const harness = makeTransportHarness();
		await harness.request(authenticatedRequestLayer(" https://one.test/// "));
		await harness.request(authenticatedExpoRequestLayer("https://expo.test/"));

		expect(harness.authCookieServerUrls).toEqual(["https://one.test", "https://expo.test"]);
		expect(requestDetails(harness.fetchCalls[0])).toMatchObject({
			url: "https://one.test/api/probe",
			options: { credentials: "include", headers: { cookie: "session=one.test" } },
		});
		expect(requestDetails(harness.expoFetchCalls[0])).toMatchObject({
			url: "https://expo.test/api/probe",
			options: { credentials: "include", headers: { cookie: "session=expo.test" } },
		});
	});

	it("keeps admin headers local to each request layer", async () => {
		const harness = makeTransportHarness();
		await harness.request(adminTokenRequestLayer("https://one.test", () => "admin-one"));
		await harness.request(authenticatedRequestLayer("https://one.test"));
		await harness.request(adminTokenRequestLayer("https://one.test", () => "admin-two"));

		expect(requestDetails(harness.fetchCalls[0]).options?.headers).toMatchObject({
			"admin-access-token": "admin-one",
		});
		expect(requestDetails(harness.fetchCalls[1]).options?.headers).not.toHaveProperty(
			"admin-access-token",
		);
		expect(requestDetails(harness.fetchCalls[2]).options?.headers).toMatchObject({
			"admin-access-token": "admin-two",
		});
	});

	it("does not cross destinations when clients use two server URLs", async () => {
		const harness = makeTransportHarness();
		await Promise.all([
			harness.request(authenticatedRequestLayer("https://one.test/")),
			harness.request(authenticatedRequestLayer("https://two.test///")),
		]);

		expect(
			harness.fetchCalls
				.map(requestDetails)
				.map(({ url }) => url)
				.sort(),
		).toEqual(["https://one.test/api/probe", "https://two.test/api/probe"]);
		expect(harness.authCookieServerUrls.sort()).toEqual(["https://one.test", "https://two.test"]);
	});
});
