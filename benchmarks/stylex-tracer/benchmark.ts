/* oxlint-disable perfectionist/sort-objects -- Result keys follow the benchmark report. */
import { gzipSync } from "node:zlib";

import { Effect } from "../../packages/client-plugin-compiler/node_modules/effect/dist/index.js";
import {
	compileClientPlugin,
	STYLEX_TRACER_BUILD_FINGERPRINT,
} from "../../packages/client-plugin-compiler/src/index";
import type { ClientPluginCompilerGraphInput } from "../../packages/client-plugin-compiler/src/index";
import { CLIENT_API_VERSION } from "../../packages/client-plugin-contract/src/index";
import { readPluginArchive, writePluginArchive } from "../../packages/plugin-archive/src/index";
import { stylexTracerPlugin } from "../../plugins/stylex-tracer/host/plugin";

export type Variant = "stylex" | "tailwind";

const benchmarkRoot = import.meta.dir;
const repositoryRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const encoder = new TextEncoder();

const readFiles = async (root: string) => {
	const paths = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: root, onlyFiles: true }));
	return Object.fromEntries(
		await Promise.all(
			paths
				.sort()
				.map(async (path) => [
					`client/${path}`,
					new Uint8Array(await Bun.file(`${root}/${path}`).arrayBuffer()),
				]),
		),
	);
};

export const variantFiles = async (variant: Variant) =>
	variant === "stylex"
		? readFiles(`${repositoryRoot}/plugins/stylex-tracer/client`)
		: readFiles(`${benchmarkRoot}/fixture/tailwind`);

const digestBytes = (chunks: readonly (string | Uint8Array)[]) => {
	const hasher = new Bun.CryptoHasher("sha256");
	for (const chunk of chunks) {
		hasher.update(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
	}
	return hasher.digest("hex");
};

export const variantInput = async (
	variant: Variant,
	marker?: { readonly id: string; readonly color: string },
	traceId?: string,
): Promise<ClientPluginCompilerGraphInput> => {
	const files = await variantFiles(variant);
	if (marker !== undefined) {
		const tokenPath = variant === "stylex" ? "client/tokens.stylex.ts" : "client/styles.css";
		const source = new TextDecoder().decode(files[tokenPath]);
		files[tokenPath] = encoder.encode(
			source
				.replace("#173f35", marker.color)
				.replace("StyleX tracer", `StyleX tracer ${marker.id}`),
		);
	}
	return {
		name: "StyleX tracer",
		apiVersion: CLIENT_API_VERSION,
		application: "page",
		contributorOrder: [variant],
		contributors: { [variant]: { files } },
		entry: { contributor: variant, path: "client/page.tsx" },
		publicExports: {},
		...(traceId === undefined ? {} : { benchmarkInstrumentation: { traceId } }),
		...(variant === "stylex"
			? {
					stylexTracer: {
						fingerprint:
							marker === undefined
								? STYLEX_TRACER_BUILD_FINGERPRINT
								: `${STYLEX_TRACER_BUILD_FINGERPRINT}:${marker.id}`,
					},
				}
			: {}),
	};
};

export const compileVariant = async (variant: Variant, traceId?: string) => {
	const inputReadStarted = Bun.nanoseconds();
	const input = await variantInput(variant, undefined, traceId);
	const inputReadMs = (Bun.nanoseconds() - inputReadStarted) / 1_000_000;
	const files = input.contributors[variant].files;
	const inputFiles = Object.values(files);
	const started = Bun.nanoseconds();
	const compiled = await Effect.runPromise(compileClientPlugin(input));
	const { artifact } = compiled;
	const compilationMs = (Bun.nanoseconds() - started) / 1_000_000;
	const byName = new Map(artifact.files.map((file) => [file.name, file]));
	const javascript = byName.get("plugin.js")?.contents ?? new Uint8Array();
	const css = byName.get("plugin.css")?.contents ?? new Uint8Array();
	const fonts = artifact.files.filter(({ name }) => name.endsWith(".woff2"));
	const localAssets = artifact.files.filter(
		({ name }) => name.startsWith("asset-") && !name.endsWith(".woff2"),
	);
	const document = byName.get("index.html")?.contents ?? new Uint8Array();
	const archiveManifest = { ...stylexTracerPlugin, scripts: [] };
	const canonicalArchive = writePluginArchive({
		manifest:
			variant === "stylex"
				? archiveManifest
				: {
						...archiveManifest,
						metadata: { ...archiveManifest.metadata, slug: "tailwind-tracer" },
					},
		files,
	});
	const archiveRoundTrip = await Effect.runPromise(readPluginArchive(canonicalArchive));
	const identity = digestBytes([
		JSON.stringify({
			format: artifact.format,
			hash: artifact.hash,
			apiVersion: artifact.apiVersion,
			bridgeVersion: artifact.bridgeVersion,
			compilerVersion: artifact.compilerVersion,
		}),
		...artifact.files.flatMap(({ name, contentType, contents }) => [name, contentType, contents]),
	]);

	return {
		identity,
		artifactHash: artifact.hash,
		compilationMs,
		input: {
			manifest: Object.entries(files)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([path, contents]) => ({
					path,
					bytes: contents.byteLength,
					sha256: digestBytes([contents]),
				})),
			manifestSha256: digestBytes(
				Object.entries(files)
					.sort(([left], [right]) => left.localeCompare(right))
					.flatMap(([path, contents]) => [path, contents]),
			),
			readMs: inputReadMs,
			fileCount: inputFiles.length,
			bytes: inputFiles.reduce((total, contents) => total + contents.byteLength, 0),
			textModuleCount: Object.keys(input.contributors[variant].files).filter((path) =>
				/\.tsx?$/.test(path),
			).length,
		},
		sizes: {
			javascript: { rawBytes: javascript.byteLength, gzipBytes: gzipSync(javascript).byteLength },
			css: { rawBytes: css.byteLength, gzipBytes: gzipSync(css).byteLength },
			javascriptAndCss: {
				rawBytes: javascript.byteLength + css.byteLength,
				gzipBytes: gzipSync(javascript).byteLength + gzipSync(css).byteLength,
			},
			documentBytes: document.byteLength,
			fontAssets: {
				count: fonts.length,
				rawBytes: fonts.reduce((total, file) => total + file.contents.byteLength, 0),
			},
			localAssets: {
				count: localAssets.length,
				rawBytes: localAssets.reduce((total, file) => total + file.contents.byteLength, 0),
			},
			fullArtifactBytes: artifact.files.reduce(
				(total, file) => total + file.contents.byteLength,
				0,
			),
			canonicalSourceArchiveBytes: canonicalArchive.byteLength,
		},
		archive: {
			readerVerified: Object.keys(archiveRoundTrip.files).length === Object.keys(files).length,
			identity: digestBytes([canonicalArchive]),
		},
		...(compiled.benchmarkInstrumentation === undefined
			? {}
			: { benchmarkInstrumentation: compiled.benchmarkInstrumentation }),
	};
};
