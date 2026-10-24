import { expect } from "vitest";

export const anyOf = (constructor: unknown): unknown => expect.any(constructor);

export const anything = (): unknown => expect.anything();

export const arrayContaining = (expected: ReadonlyArray<unknown>): unknown =>
	expect.arrayContaining([...expected]);

export const closeTo = (expected: number, precision?: number): unknown =>
	expect.closeTo(expected, precision);

export const objectContaining = (expected: object): unknown => expect.objectContaining(expected);

export const stringContaining = (expected: string): unknown => expect.stringContaining(expected);

export const stringMatching = (expected: RegExp | string): unknown =>
	expect.stringMatching(expected);
