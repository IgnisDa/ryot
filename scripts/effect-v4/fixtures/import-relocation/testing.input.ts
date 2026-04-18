/* keep mixed effect import context */
import { Effect, Schedule, TestClock } from "effect";
import { TestConsole } from "effect/testing";

/* keep alias import context */
import {
	Effect as Fx,
	/* keep aliased TestClock */ TestClock as ClockControl,
} from "effect";
import type { Schedule as ScheduleType, TestClock as TestClockType } from "effect";
import { FastCheck, type TestClock as InlineTestClockType } from "effect";
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
