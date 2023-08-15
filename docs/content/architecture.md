# Architecture

In production, the frontend is a pre-rendered Nextjs app served statically by the Axum
backend server.

## Logs

Logs are written to both stdout and `ryot.log.*` in the working directory. If you
are reporting a bug, please attach the latest log.

## Development

There is a [devcontainer](https://code.visualstudio.com/docs/devcontainers/containers)
configuration in the repository. You can use it to launch a development environment
with all tools installed.

### Environment

In development, both servers are started independently running on `:3000` and `:8000`
respectively. To get them running, install [mprocs](https://github.com/pvolok/mprocs), and
run `mprocs` in the project root. If you do not want to install `mprocs`, take a look at
[`mproc.yaml`]({{ extra.file_path }}/mprocs.yaml) to see what all commands are
needed to get it working.

Here is the minimal configuration required in development mode:

```json title="config/ryot.json"
{
  "database": {
    "url": "postgres://postgres:postgres@postgres:5432/postgres",
    "auth_db_path": "/tmp"
  },
  "server": {
    "cors_origins": ["http://localhost:3000"],
    "config_dump_path": "/tmp/ryot.json",
    "insecure_cookie": true,
		"samesite_none": true
  }
}
```

I also recommend the following environment files:

```bash title=".env"
RUST_LOG="ryot=trace,sea_orm=debug"
```

```bash title="apps/frontend/.env"
NEXT_PUBLIC_BASE_URL="http://localhost:8000"
```

!!! note

    You will need to run `moon run frontend:build` before you can get the
    backend running. This needs to be done only once.

### Version Control

Unless it is a very small change, I prefer creating a separate branch and merging it via an
MR when it is done. The changelog is generated using
[git-chglog](https://github.com/git-chglog/git-chglog). Once all changes are done, run the
following command to update the changelog.

```bash
$ git-chglog --next-tag <tag-name> -o CHANGELOG.md
```
