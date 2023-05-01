# trackona

Trackona is a self hosted platform for tracking movies, TV shows, video games,
books and audiobooks.

## Project Status

This project is still very much a WIP. Until it hits `1.0.0`, consider the project
to have breaking changes without any warning, for example backwards incompatible
schema changes. You can see the latest release
[here](https://github.com/IgnisDa/trackona/releases).

## How to use?

To get a demo server running, use the docker image:

```bash
$ docker run --detach \
  --publish 8000:8000 \
  --volume ./trackona-data:/data \
  --name trackona \
  ghcr.io/ignisda/trackona:latest
```

## Development

Trackona is an Axum server running in the backend. The frontend is a pre-rendered
Nextjs app served statically by the backend server.

To get the servers running, install [mprocs](https://github.com/pvolok/mprocs),
and run `mprocs` in the project root and access the frontend at
http://localhost:3000 and backend at http://localhost:8000. If you do not want
to install it, take a look at [`mproc.yaml`](./mprocs.yaml) to see what all
commands are needed to get it working.

## Acknowledgements

It is highly inspired by [MediaTracker](https://github.com/bonukai/MediaTracker).
Moreover thanks to all those people whose stuff I have used.
