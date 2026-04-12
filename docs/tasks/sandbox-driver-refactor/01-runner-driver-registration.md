# Runner Driver Registration

**Parent Plan:** [Sandbox Driver Refactor](./README.md)

**Type:** AFK

**Status:** todo

## What to build

Wire the `driver(name, fn)` registration pattern into the sandbox runtime end-to-end: from
the Deno runner that executes scripts, through the lib-level sandbox service that spawns the
subprocess, up to the `modules/sandbox` route and service that accept enqueue requests from
callers.

After this slice, any script can call `driver("search", fn)` and `driver("details", fn)` and
have the correct function invoked when the caller passes `driverName: "search"` or
`driverName: "details"` in the enqueue payload. Scripts that do not use `driver()` and instead
use a raw `return` statement continue to work when `driverName` is omitted — this is the
intended fallback for user-authored scripts.

See the **Runner** and **Sandbox types and service** sections of the parent PRD for the full
design.

## Acceptance criteria

- [ ] `runner-source.txt` parses `driverName` from the stdin payload.
- [ ] `runner-source.txt` builds a `driverRegistry` map and injects a `driver(name, fn)`
      function as the first parameter of `sandboxMain`, ahead of the API stubs.
- [ ] After the script body executes, the runner calls `driverRegistry[driverName](context)`
      and uses its return value as the result.
- [ ] If `driverName` names a driver that was never registered, the runner writes
      `{ success: false, error: "Driver \"<name>\" is not defined in this script" }` to stdout.
- [ ] If `driverName` is absent from the payload, the runner falls back to the script's raw
      return value (existing behavior preserved).
- [ ] `SandboxEnqueueOptions` in `lib/sandbox/types.ts` gains an optional `driverName` field.
- [ ] `lib/sandbox/service.ts` includes `driverName` in the payload sent to the Deno subprocess.
- [ ] The `modules/sandbox` enqueue route schema gains an optional `driverName` field.
- [ ] `modules/sandbox/service.ts` forwards `driverName` when calling the lib sandbox service.
- [ ] A script that registers two drivers and is invoked with each `driverName` in turn returns
      the correct result from each driver.
- [ ] Tests covering: driver invoked correctly, unknown driverName error, absent driverName
      fallback.

## Blocked by

None — can start immediately.

## User stories addressed

- User story 1
- User story 2
- User story 3
- User story 7
- User story 10
