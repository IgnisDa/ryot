import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";

import { runTests } from "./runner.js";

BunRuntime.runMain(Effect.scoped(runTests()));
