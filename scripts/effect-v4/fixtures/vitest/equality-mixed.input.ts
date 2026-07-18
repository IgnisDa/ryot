// Keep declaration comment and unaffected value/type imports.
import { addEqualityTesters as installEquality, expect, type TestContext } from "@effect/vitest";

installEquality();
expect(undefined).toBeUndefined();
export type Context = TestContext;
