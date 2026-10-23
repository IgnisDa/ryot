import { BunServices, BunSocketServer } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Predicate, Result } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { NetAddress } from "effect/net";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Socket } from "effect/socket";

import { parseEgressAllowedNetworks } from "./address-policy";
import { withEgressPolicy } from "./http-client";

const OPENSSL_CONFIG = `[req]
distinguished_name = dn
[dn]
[ca]
basicConstraints = critical, CA:true
keyUsage = critical, keyCertSign
[leaf]
subjectAltName = DNS:egress.test
`;

const EC_KEY = [
	"-newkey",
	"ec",
	"-pkeyopt",
	"ec_paramgen_curve:prime256v1",
	"-pkeyopt",
	"ec_param_enc:named_curve",
	"-nodes",
];

const testCertificates = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
	const dir = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-egress-tls-" });
	const openssl = (args: ReadonlyArray<string>) =>
		Effect.gen(function* () {
			const exitCode = yield* spawner.exitCode(
				ChildProcess.make("openssl", args, { cwd: dir, stdout: "ignore", stderr: "ignore" }),
			);
			expect(exitCode).toBe(0);
		});
	yield* fs.writeFileString(path.join(dir, "openssl.cnf"), OPENSSL_CONFIG);
	yield* openssl([
		"req",
		"-x509",
		"-config",
		"openssl.cnf",
		"-extensions",
		"ca",
		...EC_KEY,
		"-keyout",
		"ca-key.pem",
		"-out",
		"ca.pem",
		"-days",
		"1",
		"-subj",
		"/CN=egress-test-ca",
	]);
	yield* openssl([
		"req",
		"-new",
		"-config",
		"openssl.cnf",
		...EC_KEY,
		"-keyout",
		"key.pem",
		"-out",
		"leaf.csr",
		"-subj",
		"/CN=egress.test",
	]);
	yield* openssl([
		"x509",
		"-req",
		"-in",
		"leaf.csr",
		"-CA",
		"ca.pem",
		"-CAkey",
		"ca-key.pem",
		"-set_serial",
		"1",
		"-days",
		"1",
		"-extfile",
		"openssl.cnf",
		"-extensions",
		"leaf",
		"-out",
		"cert.pem",
	]);
	const read = (name: string) => fs.readFileString(path.join(dir, name));
	return { ca: yield* read("ca.pem"), key: yield* read("key.pem"), cert: yield* read("cert.pem") };
});

const serveOrigin = (tls?: Readonly<{ cert: string; key: string }>) =>
	Effect.gen(function* () {
		const hosts: Array<string | null> = [];
		const server = yield* Effect.acquireRelease(
			Effect.sync(() =>
				Bun.serve({
					port: 0,
					hostname: "127.0.0.1",
					...(tls && { tls }),
					fetch: (request) => {
						hosts.push(request.headers.get("host"));
						return new Response("origin");
					},
				}),
			),
			(running) => Effect.promise(() => running.stop(true)),
		);
		return { hosts, port: server.url.port };
	});

const recordingProxy = Effect.gen(function* () {
	const requestLines: Array<string> = [];
	const server = yield* BunSocketServer.make({ port: 0, host: "127.0.0.1" });
	yield* server
		.run((socket) =>
			Effect.scoped(
				Effect.gen(function* () {
					const reader = yield* socket.reader;
					const { write } = yield* socket.writer;
					const [chunk] = yield* reader.pull;
					const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
					requestLines.push(text.split("\r\n")[0] ?? "");
					yield* write("HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n");
					yield* write(new Socket.CloseEvent());
				}),
			).pipe(Effect.ignore),
		)
		.pipe(Effect.forkScoped);
	const port = NetAddress.isInetAddress(server.address) ? server.address.port : 0;
	return { requestLines, url: `http://127.0.0.1:${port}` };
});

const PROXY_VARIABLES = [
	"ALL_PROXY",
	"all_proxy",
	"HTTP_PROXY",
	"http_proxy",
	"HTTPS_PROXY",
	"https_proxy",
];

// Bun reads proxy settings from the process environment on every fetch.
const setProxyEnvironment = (proxyUrl: string) => {
	const names = [...PROXY_VARIABLES, "NO_PROXY", "no_proxy"];
	const previous = names.map((name) => [name, process.env[name]] as const);
	for (const name of names) {
		if (PROXY_VARIABLES.includes(name)) {
			process.env[name] = proxyUrl;
		} else {
			delete process.env[name];
		}
	}
	return () => {
		for (const [name, value] of previous) {
			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
	};
};

const guardedClient = Effect.gen(function* () {
	return withEgressPolicy(yield* HttpClient.HttpClient, {
		resolver: { resolve: () => Effect.succeed(["127.0.0.1"]) },
		allowedNetworks: Result.getOrThrow(parseEgressAllowedNetworks("127.0.0.1/32")),
	});
});

const outcome = (client: HttpClient.HttpClient, url: string, tls?: BunFetchRequestInitTLS) => {
	const requestInit: BunFetchRequestInit = tls === undefined ? {} : { tls };
	return client.execute(HttpClientRequest.get(url)).pipe(
		Effect.flatMap((response) => Effect.map(response.text, (text) => `${response.status} ${text}`)),
		Effect.provideService(FetchHttpClient.RequestInit, requestInit),
		Effect.catch((error) =>
			Effect.succeed(
				Predicate.hasProperty(error.reason.cause, "code")
					? `error ${String(error.reason.cause.code)}`
					: `error ${error.reason._tag}`,
			),
		),
	);
};

layer(Layer.merge(BunServices.layer, FetchHttpClient.layer))((test) => {
	test.effect("verifies each pinned request against its hostname on pooled connections", () =>
		Effect.gen(function* () {
			const { ca, key, cert } = yield* testCertificates;
			const { port, hosts } = yield* serveOrigin({ key, cert });
			const client = yield* guardedClient;
			const at = (hostname: string) => `https://${hostname}:${port}/`;

			expect(yield* outcome(client, at("egress.test"), { ca })).toBe("200 origin");
			expect(hosts).toEqual([`egress.test:${port}`]);
			expect(yield* outcome(client, at("other.test"), { ca })).toBe(
				"error ERR_TLS_CERT_ALTNAME_INVALID",
			);
			expect(yield* outcome(client, at("other.test"), { rejectUnauthorized: false })).toBe(
				"200 origin",
			);
			expect(yield* outcome(client, at("other.test"), { ca })).toBe(
				"error ERR_TLS_CERT_ALTNAME_INVALID",
			);
			expect(yield* outcome(client, at("egress.test"), { rejectUnauthorized: false })).toBe(
				"200 origin",
			);
			expect(yield* outcome(client, at("egress.test"))).toBe(
				"error UNABLE_TO_VERIFY_LEAF_SIGNATURE",
			);
		}),
	);

	test.effect("connects pinned requests directly when proxy environment variables are set", () =>
		Effect.gen(function* () {
			const { ca, key, cert } = yield* testCertificates;
			const secure = yield* serveOrigin({ key, cert });
			const plain = yield* serveOrigin();
			const proxy = yield* recordingProxy;
			yield* Effect.acquireRelease(
				Effect.sync(() => setProxyEnvironment(proxy.url)),
				(restore) => Effect.sync(restore),
			);
			const unguarded = yield* HttpClient.HttpClient;
			const client = yield* guardedClient;

			expect(
				yield* outcome(unguarded, `https://127.0.0.1:${secure.port}/`, {
					ca,
					serverName: "egress.test",
				}),
			).toBe("error ERR_PROXY_TUNNEL");
			expect(yield* outcome(unguarded, `http://127.0.0.1:${plain.port}/`)).toBe("502 ");
			expect(proxy.requestLines).toEqual([
				`CONNECT 127.0.0.1:${secure.port} HTTP/1.1`,
				`GET http://127.0.0.1:${plain.port}/ HTTP/1.1`,
			]);

			expect(yield* outcome(client, `https://egress.test:${secure.port}/`, { ca })).toBe(
				"200 origin",
			);
			expect(yield* outcome(client, `http://egress.test:${plain.port}/`)).toBe("200 origin");
			expect(yield* outcome(client, `http://127.0.0.1:${plain.port}/`)).toBe("200 origin");
			expect(proxy.requestLines).toHaveLength(2);
			expect(secure.hosts).toEqual([`egress.test:${secure.port}`]);
			expect(plain.hosts).toEqual([`egress.test:${plain.port}`, `127.0.0.1:${plain.port}`]);
		}),
	);
});
