import { expect, layer } from "@effect/vitest";
import { Effect, Path } from "effect";

import { posixDirname, posixExtname, posixJoin } from "./path";

const corpus = [
	"",
	".",
	"..",
	"...",
	"/",
	"//",
	"///",
	"./",
	".//",
	"../",
	"a",
	"a/",
	"/a",
	"/a/",
	"a//b",
	"a/./b",
	"a/b/../c",
	"a/../..",
	"../../x",
	"..//..",
	"/..",
	"/../x",
	"/a/../../b",
	"a/b/c/../../../..",
	"shared/../client/x.ts",
	"\\",
	"a\\b",
	"..\\x",
	".hidden",
	"a/.hidden",
	"a/.hidden/",
	"a.tsx",
	".js",
	"x/.js",
	"a.",
	"..a",
	"a..",
	"a/b.c.d",
	"foo/bar.tar.gz/",
	"//a/b",
];

layer(Path.layer)((it) => {
	it.effect("matches Effect's node-derived posix dirname and extname over the corpus", () =>
		Effect.gen(function* () {
			const posix = yield* Path.Path;
			for (const path of corpus) {
				expect([path, posixDirname(path)]).toEqual([path, posix.dirname(path)]);
				expect([path, posixExtname(path)]).toEqual([path, posix.extname(path)]);
			}
			expect(posixDirname("a.tsx")).toBe(".");
			expect(posixExtname(".js")).toBe("");
		}),
	);

	it.effect("matches Effect's node-derived posix join over the corpus", () =>
		Effect.gen(function* () {
			const posix = yield* Path.Path;
			expect(posixJoin()).toBe(posix.join());
			for (const left of corpus) {
				expect([left, posixJoin(left)]).toEqual([left, posix.join(left)]);
				for (const right of corpus) {
					expect([left, right, posixJoin(left, right)]).toEqual([
						left,
						right,
						posix.join(left, right),
					]);
					expect([left, right, posixJoin(left, "x", right)]).toEqual([
						left,
						right,
						posix.join(left, "x", right),
					]);
				}
			}
		}),
	);
});
