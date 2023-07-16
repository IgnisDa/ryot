# Architecture

In production, the frontend is a pre-rendered Nextjs app served statically by the Axum
backend server.

## Development

In development, both servers are started independently running on `:3000` and `:8000`
respectively. To get them running, install [mprocs](https://github.com/pvolok/mprocs), and
run `mprocs` in the project root. If you do not want to install `mprocs`, take a look at
[`mproc.yaml`]({{ extra.file_path }}/mprocs.yaml) to see what all commands are
needed to get it working.

Unless it is a very small change, I prefer creating a separate branch and merging it via an
MR when it is done. The changelog is generated using
[git-chglog](https://github.com/git-chglog/git-chglog). Once all changes are done, run the
following command to update the changelog.

```bash
$ git-chglog --next-tag <tag-name> -o CHANGELOG.md
```
