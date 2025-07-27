import { describe, expect, it } from "bun:test";

import { toEntityImage } from "./entity-image";

describe("toEntityImage", () => {
	it("returns null for null", () => {
		expect(toEntityImage(null)).toBeNull();
	});

	it("returns null for undefined", () => {
		expect(toEntityImage(undefined)).toBeNull();
	});

	it("returns null for a string", () => {
		expect(toEntityImage("s3://bucket/key")).toBeNull();
	});

	it("returns null for a number", () => {
		expect(toEntityImage(42)).toBeNull();
	});

	it("returns null for an object without a kind field", () => {
		expect(toEntityImage({ key: "foo" })).toBeNull();
	});

	it("returns null for an unknown kind", () => {
		expect(toEntityImage({ kind: "blob", path: "/foo" })).toBeNull();
	});

	it("returns the s3 image for a valid s3 object", () => {
		expect(toEntityImage({ kind: "s3", key: "uploads/photo.jpg" })).toEqual({
			key: "uploads/photo.jpg",
			kind: "s3",
		});
	});

	it("returns null when an s3 object is missing key", () => {
		expect(toEntityImage({ kind: "s3" })).toBeNull();
	});

	it("returns null when an s3 key is not a string", () => {
		expect(toEntityImage({ kind: "s3", key: 123 })).toBeNull();
	});

	it("returns the remote image for a valid remote object", () => {
		expect(toEntityImage({ kind: "remote", url: "https://example.com/photo.jpg" })).toEqual({
			kind: "remote",
			url: "https://example.com/photo.jpg",
		});
	});

	it("returns null when a remote object is missing url", () => {
		expect(toEntityImage({ kind: "remote" })).toBeNull();
	});

	it("returns null when a remote url is not a string", () => {
		expect(toEntityImage({ kind: "remote", url: null })).toBeNull();
	});
});
