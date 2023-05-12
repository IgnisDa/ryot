<h1 align="center">Ryot</h1>

<h3 align="center">
  A self hosted platform for tracking various facets of your life - media,
  fitness etc.
</h3>

Ryot (**R**oll **Y**our **O**wn **T**racker), pronounced "riot", aims to be the
only self hosted tracker you will ever need!

## 🚀 Features

* ✅ Free and open-source
* ✅ [Importing data](./docs/guides/importing.md)
  - Goodreads
  - MediaTracker
* ✅ Supports tracking media (audio books, books, movies, shows, video games)
  and fitness (exercises) (https://github.com/IgnisDa/ryot/discussions/4)
* ✅ Built by developers for developers
* ✅ GraphQL API
* ✅ Lightning fast
* ✅ Self-hosted



## Project Status

This project is still very much a WIP. Until it hits `1.0.0`, consider the project
to have breaking changes without any warning, for example backwards incompatible
schema changes. You can see the latest release
[here](https://github.com/IgnisDa/ryot/releases).

## ⌨️ How to use?

### 🐳 Option 1: Use Docker

To get a demo server running, use the docker image:

```bash
$ docker run --detach \
  --publish 8000:8000 \
  --volume ./ryot-data:/data \
  --name ryot \
  ghcr.io/ignisda/ryot:latest
```

### 🧑‍💻 Option 2: Compile and run from source

- Install [moonrepor](https://moonrepo.dev/https://moonrepo.dev/)

```bash
# Build the frontend
$ moon run frontend:build

# Run it
$ cargo run --bin ryot --release
```

## Development

Ryot is an Axum server running in the backend. The frontend is a pre-rendered
Nextjs app served statically by the backend server.

To get the servers running, install [mprocs](https://github.com/pvolok/mprocs),
and run `mprocs` in the project root and access the frontend at
http://localhost:3000 and backend at http://localhost:8000. If you do not want
to install it, take a look at [`mproc.yaml`](./mprocs.yaml) to see what all
commands are needed to get it working.

## Acknowledgements

It is highly inspired by [MediaTracker](https://github.com/bonukai/MediaTracker).
Moreover thanks to all those people whose stuff I have used.
