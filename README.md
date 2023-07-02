<h1 align="center">Ryot</h1>

<h3 align="center">
  A self hosted platform for tracking various facets of your life - media, fitness etc.
</h3>

<br/>

<div align="center">
  <a href="https://github.com/ignisda/ryot/stargazers"><img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/ignisda/ryot"></a>
  <a href="https://github.com/ignisda/ryot/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-GPLv3-purple"></a>
</div>

<br/>

Ryot (**R**oll **Y**our **O**wn **T**racker), pronounced "riot", aims to be the only self
hosted tracker you will ever need!

## NOTE FOR BETA USERS

The first public release includes huge code changes. If you are running the `v1.0.0-beta.*`
versions, then please follow the migration notes for the latest release
[here](https://github.com/IgnisDa/ryot/releases/tag/v1.0.0). Please be warned that
failing to do so **WILL** result in data loss.

## 💻 Demo

You can use the demo instance hosted on [Fly.io](https://ryot.fly.dev). Login and register
with the username `demo` and password `demo-password`. This instance is automatically
deployed from the latest release.

**NOTE**: The data in this instance can be deleted randomly.

## 📝 ELI5

Imagine you have a special notebook where you can write down all the media you have
consumed, like books you've read, shows you have watched, video games you have played or
workouts you have done. Now, imagine that instead of a physical notebook, you have a
special tool on your computer or phone that lets you keep track of all these digitally.

## 💡 Why?

- Existing solutions do not have very good UI.
- Pretty graphs and summaries make everyone happy. Ryot aims to have a lot of them.
- There is a lack of a good selfhosted fitness and health tracking solution.
- Ryot consumes very little memory (around 10MB idle eyeballing `docker stats`), something
  that is significantly useful in RAM constrained environments.

## 🚀 Features

- ✅ [Supports](https://github.com/IgnisDa/ryot/discussions/4) tracking media
  and fitness.
- ✅ Import data
  - Goodreads
  - MediaTracker
- ✅ Self-hosted
- ✅ PWA enabled
- ✅ Documented GraphQL API
- ✅ Easy to understand UI
- ✅ Lightning fast (written in Rust BTW)
- ✅ Free and open-source

## 📖 Guides

Some things might not be obvious on how to setup or get working. I have written
a number of guides to make thing easier.

- [Deployment](/docs/guides/deployment.md): Deploy Ryot to various platforms
- [Exporting](/docs/guides/exporting.md): Export your data from Ryot
- [Fitness](/docs/guides/fitness.md): Fitness tracking with Ryot
- [Importing](/docs/guides/importing.md): Import data from various sources
- [Integrations](/docs/guides/integrations.md): Integrations with various platforms
- [Video Games](/docs/guides/video-games.md): Get video games tracking working

## ⌨️ How to use?

**NOTE**: The first user you register is automatically set as admin of the instance.

### 🐳 Option 1: Use Docker

To get a demo server running, use the docker image:

```bash
$ docker run \
  --detach \
  --name ryot \
  --pull always \
  --publish 8000:8000 \
  --env "WEB_INSECURE_COOKIE=true" \
  ghcr.io/ignisda/ryot:latest
```

**NOTE**: The `WEB_INSECURE_COOKIE` is only required if you are not running HTTPs.

In addition to the `latest` tag, we also publish an `unstable` tag from the latest
pre-release (or release, whichever is newer).

### 📦 Option 2: Quick-run a release

Each release has an installation script that can be used to install the `ryot`
binary. Follow the instructions in the release to use this script.

**Alternatively** using [eget](https://github.com/zyedidia/eget):

```bash
$ eget ignisda/ryot
```

### 🧑‍💻Option 3: Compile and run from source

- Install [moonrepo](https://moonrepo.dev/)

```bash
# Build the frontend
$ moon run frontend:build

# Run it
$ cargo run --bin ryot --release
```

## 👀 Production

You will have to mount a directory to the `/data`, giving it the `1001:1001`
permissions. It is also recommended to use PostgreSQL or MySQL in production.

## 🔧 Configuration options

You can specify configuration options via files (loaded from `config/ryot.json`,
`config/ryot.toml`, `config/ryot.yaml`) or via environment variables.

To set the equivalent environment variables, join keys by `_` (underscore) and
_UPPER_SNAKE_CASE_ the characters. For example, the key `podcasts.listennotes.api_token`
corresponds to the environment variable `PODCASTS_LISTENNOTES_API_TOKEN`.

Ryot serves the final configuration loaded at the `/config` endpoint as JSON
([example](https://ryot.fly.dev/config)).

**Note**: You can see all possible configuration parameters in
the [generated schema](libs/generated/src/config/backend/schema.ts). The defaults
can be inspected in the [config](/apps/backend/src/config.rs) builder.

## 🤓 Developer notes

In production, the frontend is a pre-rendered Nextjs app served statically by the Axum
backend server.

In development, both servers are started independently running on `:3000` and `:8000`
respectively. To get them running, install [mprocs](https://github.com/pvolok/mprocs), and
run `mprocs` in the project root. If you do not want to install `mprocs`, take a look at
[`mproc.yaml`](/mprocs.yaml) to see what all commands are needed to get it working.

Unless it is a very small change, I prefer creating a separate branch and merging it via an
MR when it is done. The changelog is generated using
[git-chglog](https://github.com/git-chglog/git-chglog). Once all changes are done, run the
following command to update the changelog.

```bash
$ git-chglog --next-tag <tag-name> -o CHANGELOG.md
```

## 🙏 Acknowledgements

It is highly inspired by [MediaTracker](https://github.com/bonukai/MediaTracker). Moreover
thanks to all those people whose stuff I have used.

The logo is taken from
[Flaticon](https://www.flaticon.com/free-icon/mess_4789882?term=chaos&page=1&position=2&origin=tag&related_id=4789882).
