# Compiler Worker

`@ryot-app/compiler-worker` is private, generic infrastructure for running Ryot's compilers in
long-lived, supervised Bun worker processes. Compilers supply their own request and response
codecs, limits, failure codes, and warm-up work; this package owns only the process protocol and
supervision.

## Worker Host

`./host` exports `runCompilerWorker`. A worker builds its Layer, runs its warm-up work, writes a ready
line to stdout, and then serves one request per stdin line with one response per stdout line, in
order, until stdin closes. Stdout carries only protocol lines; logs and startup failures go to
stderr. Started with `--verify-environment`, the worker receives `{ verifyEnvironment: true }` so its
Layer can also verify the compiler's own dependencies during warm-up.

## Worker Pool

`./pool` exports `makeCompilerWorkerPool`, a scoped pool of up to `size` workers. Workers start
lazily, and warm-up has its own startup timeout so it never counts against a job's budget. A warm
worker serves later jobs ahead of an empty slot, so compilers pay process startup and dependency
loading once instead of per compile, and only concurrent jobs start more workers.

Each job receives a fresh `{ parentPath, jobId }` workspace address beneath a private pool directory,
and the pool removes that directory after the job, including after forced termination. The pool
enforces the job's CPU-time budget, the hard Linux process-tree proportional memory limit, and the
response size limit; any of these kills the worker, fails only that job with the compiler's
`CpuTimeExceeded`, `MemoryExceeded`, or `OutputExceeded` failure, and the next job starts a fresh worker.
After a successful job, a worker above the recycle threshold is replaced; an idle worker exits after
its idle timeout. The pool sets the worker's `GOMEMLIMIT` for the native TypeScript server it starts
and makes each worker the preferred out-of-memory victim.

CPU time is the Linux process tree's, so a busy host does not fail a source that compiles within its
budget; elsewhere elapsed time stands in for it. A separate elapsed-time limit catches an overloaded
host or a stuck worker.

A worker that cannot start, exits during a job, outlasts the elapsed-time limit, or loses memory
supervision fails with `CompilerWorkerUnavailable`. That failure describes the platform, not the submitted source, so
callers report it as temporary unavailability rather than as compiler diagnostics. Failures are
logged with the worker's recent stderr.
