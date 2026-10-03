import { sandboxRuntimePayload } from "../../../kernel/backend/src/lib/infrastructure/sandbox-runtime/runtime-payload.generated.ts";
import { sandboxRunnerSource } from "../../../kernel/backend/src/lib/infrastructure/sandbox-runtime/runner.generated.ts";
const out = process.argv[2];
for (const f of sandboxRuntimePayload.files) await Bun.write(`${out}/${f.path}`, f.contents);
await Bun.write(`${out}/runner.mjs`, sandboxRunnerSource);
console.log(sandboxRuntimePayload.files.map(f => f.path).join(" "));
