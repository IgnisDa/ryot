/* keep mixed effect import context */
import { Effect, Schedule } from "effect";
import {
    TestConsole,
    TestClock,
    /* keep aliased TestClock */ TestClock as ClockControl,
} from "effect/testing";

/* keep alias import context */
import { Effect as Fx } from "effect";
import type { Schedule as ScheduleType } from "effect";
import type { TestClock as TestClockType } from "effect/testing";
import { FastCheck } from "effect";
import type { TestClock as InlineTestClockType } from "effect/testing";
import { TestClock as ForeignTestClock } from "other-testing";

export const program = Effect.zipRight(Schedule.spaced("1 second"), TestClock.adjust("1 second"));
export const aliases = [Fx, ClockControl];
export type ClockStates = [
	TestClockType.TestClock.State,
	InlineTestClockType.TestClock.State,
	ScheduleType.Schedule,
];
export const untouched = [FastCheck, TestConsole, ForeignTestClock];
export const raw = 'import { TestClock } from "effect";';
export const template = `import { TestClock } from "effect";`;
