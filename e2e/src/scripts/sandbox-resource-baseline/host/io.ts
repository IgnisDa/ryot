import { closeSync, openSync, readdirSync, readSync, writeSync } from "node:fs";

import { parseSingleNumber, pickBlockDevice } from "./parsers";
import {
	assignRoles,
	cgroupCandidates,
	decodeDockerImageInspect,
	decodeDockerInspect,
	firstIpAddress,
} from "./resolution";
import {
	ContainerRole,
	type HostMetadataLine,
	type ResolvedContainer,
	type UnresolvedRole,
} from "./samples";

export const wallClockMs = () => performance.timeOrigin + performance.now();

export const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

const readBuffer = Buffer.allocUnsafe(256 * 1024);

/** procfs, sysfs, and cgroupfs report a zero size, so reads loop until end of file. */
export const readDescriptor = (fd: number) => {
	let length = 0;
	while (length < readBuffer.length) {
		const read = readSync(fd, readBuffer, length, readBuffer.length - length, length);
		if (read === 0) {
			break;
		}
		length += read;
	}
	return readBuffer.toString("utf8", 0, length);
};

export const readText = (path: string) => {
	let fd: number | null = null;
	try {
		fd = openSync(path, "r");
		return readDescriptor(fd);
	} catch {
		return null;
	} finally {
		if (fd !== null) {
			closeSync(fd);
		}
	}
};

export const readNumber = (path: string) => {
	const text = readText(path);
	return text === null ? null : parseSingleNumber(text);
};

export const readParsed = <T>(path: string, parse: (text: string) => T) => {
	const text = readText(path);
	return text === null ? null : parse(text);
};

export const detectBlockDevice = () => {
	try {
		return pickBlockDevice(readdirSync("/sys/block"));
	} catch {
		return null;
	}
};

export const appendLine = (fd: number, record: unknown) => {
	writeSync(fd, `${JSON.stringify(record)}\n`);
};

export const runCommand = async (command: ReadonlyArray<string>) => {
	const child = Bun.spawn([...command], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
};

const docker = async (args: ReadonlyArray<string>) => {
	const result = await runCommand(["docker", ...args]);
	if (result.exitCode !== 0) {
		throw new Error(`docker ${args[0] ?? ""} exited ${result.exitCode}: ${result.stderr.trim()}`);
	}
	return result.stdout;
};

export type Resolution = {
	readonly containers: ReadonlyArray<ResolvedContainer>;
	readonly unresolved: ReadonlyArray<UnresolvedRole>;
};

const allUnresolved = (reason: string): Resolution => ({
	containers: [],
	unresolved: ContainerRole.literals.map((role) => ({ role, reason })),
});

export const resolveContainers = async (
	project: string,
	services: Readonly<Record<ContainerRole, string>>,
): Promise<Resolution> => {
	try {
		const listed = await docker([
			"ps",
			"--all",
			"--no-trunc",
			"--filter",
			`label=com.docker.compose.project=${project}`,
			"--format",
			"{{.ID}}",
		]);
		const ids = listed
			.split("\n")
			.map((id) => id.trim())
			.filter((id) => id !== "");
		if (ids.length === 0) {
			return allUnresolved(`no containers for compose project '${project}'`);
		}
		const assignment = assignRoles(
			decodeDockerInspect(await docker(["inspect", ...ids])),
			services,
		);
		const imageIds = [...new Set(assignment.assigned.map(({ container }) => container.Image))];
		const images =
			imageIds.length === 0
				? []
				: decodeDockerImageInspect(await docker(["image", "inspect", ...imageIds]));
		const containers: Array<ResolvedContainer> = [];
		const unresolved = [...assignment.unresolved];
		for (const { role, service, container } of assignment.assigned) {
			const cgroupPath = cgroupCandidates(
				container.Id,
				readText(`/proc/${container.State.Pid}/cgroup`),
			).find((candidate) => readNumber(`${candidate}/memory.current`) !== null);
			if (cgroupPath === undefined) {
				unresolved.push({ role, reason: `no readable cgroup for container ${container.Id}` });
				continue;
			}
			containers.push({
				role,
				service,
				cgroupPath,
				imageId: container.Image,
				pid: container.State.Pid,
				containerId: container.Id,
				startedAt: container.State.StartedAt,
				restartCount: container.RestartCount,
				oomKilled: container.State.OOMKilled,
				ipAddress: firstIpAddress(container),
				containerName: container.Name.replace(/^\//, ""),
				imageRepoDigests: images.find(({ Id }) => Id === container.Image)?.RepoDigests ?? [],
			});
		}
		return { containers, unresolved };
	} catch (error) {
		return allUnresolved(`resolution failed: ${errorMessage(error)}`);
	}
};

export const resolutionKey = (resolution: Resolution) =>
	JSON.stringify([
		resolution.containers.map(({ role, startedAt, containerId }) => [role, containerId, startedAt]),
		resolution.unresolved.map(({ role }) => role),
	]);

export const metadataLine = (input: {
	readonly reason: HostMetadataLine["reason"];
	readonly project: string;
	readonly device: string | null;
	readonly resolution: Resolution;
}): HostMetadataLine => ({
	kind: "metadata",
	reason: input.reason,
	device: input.device,
	project: input.project,
	timestampMs: wallClockMs(),
	containers: input.resolution.containers,
	unresolved: input.resolution.unresolved,
});
