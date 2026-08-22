import { requirePresent } from "~/support/assertions";
import { describe, expect, it } from "~/support/effect-test";

import {
	assignRoles,
	cgroupCandidates,
	DEFAULT_SERVICES,
	decodeDockerInspect,
	type DockerContainer,
	firstIpAddress,
} from "./resolution";

const inspected = (input: {
	readonly id: string;
	readonly name: string;
	readonly service: string | null;
	readonly running?: boolean;
}): DockerContainer => ({
	Id: input.id,
	RestartCount: 0,
	Name: `/${input.name}`,
	Image: `sha256:${input.id}`,
	NetworkSettings: { Networks: { coolify: { IPAddress: "10.0.1.5" } } },
	State: {
		Pid: 4242,
		OOMKilled: false,
		Running: input.running ?? true,
		StartedAt: "2026-09-19T05:00:00.000000000Z",
	},
	Config: {
		Labels:
			input.service === null
				? null
				: {
						"com.docker.compose.service": input.service,
						"com.docker.compose.project": "a2dt5g6dbmpwqwllnzsho8jc",
					},
	},
});

const stack = [
	inspected({ service: "ryot", id: "a".repeat(64), name: "ryot-a2dt5g" }),
	inspected({ id: "b".repeat(64), service: "ryot-db", name: "ryot-db-a2dt5g" }),
	inspected({ id: "c".repeat(64), service: "ryot-redis", name: "ryot-redis-a2dt5g" }),
	inspected({ id: "d".repeat(64), service: "otel-collector", name: "otel-collector-a2dt5g" }),
];

const assignedIds = (containers: ReadonlyArray<DockerContainer>) =>
	Object.fromEntries(
		assignRoles(containers, DEFAULT_SERVICES).assigned.map(({ role, container }) => [
			role,
			container.Id,
		]),
	);

describe("assignRoles", () => {
	it("maps each role by exact compose service label", () => {
		expect(assignedIds(stack)).toEqual({
			ryot: "a".repeat(64),
			otel: "d".repeat(64),
			redis: "c".repeat(64),
			postgres: "b".repeat(64),
		});
	});

	it("never resolves ryot through the ryot-db or ryot-redis services", () => {
		const result = assignRoles(stack.slice(1), DEFAULT_SERVICES);

		expect(result.assigned.map(({ role }) => role)).toEqual(["postgres", "redis", "otel"]);
		expect(result.unresolved).toEqual([
			{ role: "ryot", reason: "no running container for service 'ryot' (0 stopped)" },
		]);
	});

	it("ignores container names that merely contain the service name", () => {
		const unlabeled = inspected({ name: "ryot", service: null, id: "e".repeat(64) });
		expect(assignRoles([unlabeled], DEFAULT_SERVICES).assigned).toEqual([]);
	});

	it("reports two running containers for one service as ambiguous", () => {
		const result = assignRoles(
			[...stack, inspected({ service: "ryot", name: "ryot-old", id: "f".repeat(64) })],
			DEFAULT_SERVICES,
		);

		expect(result.assigned.map(({ role }) => role)).not.toContain("ryot");
		expect(result.unresolved).toEqual([
			{ role: "ryot", reason: "ambiguous: 2 running containers for service 'ryot'" },
		]);
	});

	it("ignores stopped containers when a single running one exists", () => {
		const stopped = inspected({
			running: false,
			service: "ryot",
			name: "ryot-old",
			id: "0".repeat(64),
		});
		expect(assignedIds([stopped, ...stack]).ryot).toBe("a".repeat(64));
	});

	it("honours service overrides", () => {
		const renamed = inspected({ name: "app", service: "app", id: "9".repeat(64) });
		const result = assignRoles([renamed], { ...DEFAULT_SERVICES, ryot: "app" });
		expect(result.assigned.map(({ role, container }) => [role, container.Id])).toEqual([
			["ryot", "9".repeat(64)],
		]);
	});
});

describe("docker inspect decoding", () => {
	it("decodes the inspected fields and picks the first non-empty network address", () => {
		const [decoded] = decodeDockerInspect(
			JSON.stringify([
				{
					RestartCount: 2,
					Id: "a".repeat(64),
					Name: "/ryot-a2dt5g",
					Image: "sha256:1234",
					Config: { Env: ["SECRET=x"], Labels: { "com.docker.compose.service": "ryot" } },
					NetworkSettings: {
						Networks: { bridge: { IPAddress: "" }, coolify: { IPAddress: "10.0.1.9" } },
					},
					State: {
						Pid: 991,
						Running: true,
						OOMKilled: false,
						Status: "running",
						StartedAt: "2026-09-19T05:06:19.1Z",
					},
				},
			]),
		);

		expect(firstIpAddress(requirePresent(decoded, "decoded container"))).toBe("10.0.1.9");
	});
});

describe("cgroupCandidates", () => {
	it("prefers the process cgroup and falls back to the Docker defaults", () => {
		const id = "a".repeat(64);
		expect(cgroupCandidates(id, `0::/benchmark.slice/docker-${id}.scope\n`)).toEqual([
			`/sys/fs/cgroup/benchmark.slice/docker-${id}.scope`,
			`/sys/fs/cgroup/system.slice/docker-${id}.scope`,
			`/sys/fs/cgroup/docker/${id}`,
		]);
		expect(cgroupCandidates(id, null)).toEqual([
			`/sys/fs/cgroup/system.slice/docker-${id}.scope`,
			`/sys/fs/cgroup/docker/${id}`,
		]);
	});
});
