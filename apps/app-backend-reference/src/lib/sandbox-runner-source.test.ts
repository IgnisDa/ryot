import { expect, it } from "@effect/vitest";

import { sandboxRunnerSource } from "./sandbox-runner-source";

it("builds syntactically valid sandbox runner source", () => {
	expect(() =>
		new Bun.Transpiler({ loader: "js" }).transformSync(sandboxRunnerSource),
	).not.toThrow();
});

it("encodes rpc path segments in sandbox runner requests", () => {
	expect(sandboxRunnerSource).toContain("encodeURIComponent(executionId)");
	expect(sandboxRunnerSource).toContain("encodeURIComponent(fnName)");
});
