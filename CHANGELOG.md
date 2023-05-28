
<a name="v1.0.0-beta.20"></a>
# Version v1.0.0-beta.20 (2023-05-28)

## Build

* set correct repository path

## Ci

* rename releases to changelog
* allow failing fast
* install system dependencies
* update release file
* commit changelog related files

## Docs

* add additions to release file

## Fix

* change release file format
* **ci:** remove useless operation
* **ci:** checkout entire repo
* **ci:** checkout repo before setup
* **ci:** build frontend in CI
* **ci:** use correct option
* **ci:** hoist setting to correct level

This change is mostly related to CI and does not make any changes to the code itself.
After this, we will able to release binaries.

<a name="v1.0.0-beta.19"></a>
# Version v1.0.0-beta.19 (2023-05-27)

## Build

* **backend:** bump version

## Fix

* **frontend:** use correct path for routes


<a name="v1.0.0-beta.18"></a>
# Version v1.0.0-beta.18 (2023-05-27)

## Build

* **backend:** bump version

## Fix

* **backend:** use correct connection string


<a name="v1.0.0-beta.17"></a>
# Version v1.0.0-beta.17 (2023-05-27)

## Build

* **backend:** bump version

## Ci

* **gh-actions:** detach from monitoring fly commands


<a name="v1.0.0-beta.16"></a>
# Version v1.0.0-beta.16 (2023-05-27)

## Build

* **backend:** bump dependencies

## Ci

* **gh-actions:** name steps


<a name="v1.0.0-beta.15"></a>
# Version v1.0.0-beta.15 (2023-05-27)

## Ci

* **gh-actions:** automatically deploy to fly on release


<a name="v1.0.0-beta.14"></a>
# Version v1.0.0-beta.14 (2023-05-27)


<a name="v1.0.0-beta.13"></a>
# Version v1.0.0-beta.13 (2023-05-27)

## Build

* **backend:** bump version

## Fix

* **backend:** unwrap with default


<a name="v1.0.0-beta.12"></a>
# Version v1.0.0-beta.12 (2023-05-26)

## Docs

* remove screenshots


<a name="v1.0.0-beta.11"></a>
# Version v1.0.0-beta.11 (2023-05-26)

## Build

* **backend:** bump version


<a name="v1.0.0-beta.10"></a>
# Version v1.0.0-beta.10 (2023-05-25)

## Chore

* **frontend:** remove password restrictions


<a name="v1.0.0-beta.9"></a>
# Version v1.0.0-beta.9 (2023-05-25)

## Build

* **backend:** bump version

## Docs

* update dashboard screenshot
* remove ref to goodreads rss url

## Fix

* **frontend:** client side error when trimming query


<a name="v1.0.0-beta.8"></a>
# Version v1.0.0-beta.8 (2023-05-25)

## Build

* **backend:** bump version

## Feat

* accept RSS url for goodreads

## Fix

* **backend:** wrong history for goodreads books


<a name="v1.0.0-beta.7"></a>
# Version v1.0.0-beta.7 (2023-05-25)

## Build

* **backend:** bump version

## Fix

* **frontend:** do not highlight time in summary

## Test

* **backend:** change profile url for goodreads tests


<a name="v1.0.0-beta.6"></a>
# Version v1.0.0-beta.6 (2023-05-25)

## Build

* **backend:** bump version

## Chore

* **backend:** remove down migrations

## Style

* **backend:** apply linting suggestions


<a name="v1.0.0-beta.5"></a>
# Version v1.0.0-beta.5 (2023-05-25)

## Build

* **backend:** bump version

## Feat

* **backend:** delete media from "In Progress" when it's seen item is deleted

## Fix

* **backend:** do not deploy summary job when seen deleted


<a name="v1.0.0-beta.4"></a>
# Version v1.0.0-beta.4 (2023-05-24)


<a name="v1.0.0-beta.3"></a>
# Version v1.0.0-beta.3 (2023-05-23)

## Build

* **backend:** bump version

## Feat

* **frontend:** allow clearing search input


<a name="v1.0.0-beta-2"></a>
# Version v1.0.0-beta-2 (2023-05-22)

## Build

* **backend:** bump version

## Fix

* **frontend:** layout issues for mine tab in list page


<a name="v1.0.0-beta.1"></a>
# Version v1.0.0-beta.1 (2023-05-22)

## Fix

* **backend:** calculate watched shows efficiently


<a name="v0.0.45"></a>
# Version v0.0.45 (2023-05-21)

## Build

* **backend:** bump version

## Fix

* display correct num of shows


<a name="v0.0.44"></a>
# Version v0.0.44 (2023-05-21)

## Build

* **backend:** bump version

## Feat

* do not display num shows on dashboard summary
* store summary in json
* display num show seasons and podcast episodes
* **backend:** store podcast episodes played in db
* **backend:** make season summary more explicit

## Fix

* **backend:** correct calculation for shows and episodes summary
* **frontend:** remove useless click operation


<a name="v0.0.43"></a>
# Version v0.0.43 (2023-05-21)


<a name="v0.0.42"></a>
# Version v0.0.42 (2023-05-21)

## Build

* **backend:** bump version

## Feat

* **frontend:** make password validation stronger


<a name="v0.0.41"></a>
# Version v0.0.41 (2023-05-21)

## Build

* **backend:** bump version

## Feat

* **backend:** remove `identifier` field from models

## Fix

* **frontend:** do not display "In Progress" if empty


<a name="v0.0.40"></a>
# Version v0.0.40 (2023-05-21)

## Build

* **backend:** bump version

## Feat

* **backend:** remove useless migrations

## Fix

* **frontend:** add title tag to collections page


<a name="v0.0.39"></a>
# Version v0.0.39 (2023-05-20)


<a name="v0.0.38"></a>
# Version v0.0.38 (2023-05-20)

## Build

* **backend:** bump version

## Feat

* **backend:** store identifier in metadata tbl


<a name="v0.0.37"></a>
# Version v0.0.37 (2023-05-19)

## Build

* **backend:** bump version

## Fix

* **backend:** use correct query for full text search


<a name="v0.0.36"></a>
# Version v0.0.36 (2023-05-19)

## Build

* **backend:** bump version

## Feat

* display repo link on footer


<a name="v0.0.35"></a>
# Version v0.0.35 (2023-05-19)

## Build

* **backend:** bump version

## Feat

* **frontend:** add separate collections page


<a name="v0.0.34"></a>
# Version v0.0.34 (2023-05-18)

## Build

* **backend:** bump version

## Docs

* change ryot logo

## Feat

* **frontend:** remove PWA related stuff


<a name="v0.0.33"></a>
# Version v0.0.33 (2023-05-18)


<a name="v0.0.32"></a>
# Version v0.0.32 (2023-05-18)

## Build

* **backend:** bump version

## Feat

* **frontend:** add page title


<a name="v0.0.31"></a>
# Version v0.0.31 (2023-05-18)

## Build

* **backend:** bump version


<a name="v0.0.30"></a>
# Version v0.0.30 (2023-05-18)

## Build

* **backend:** bump version
* **backend:** remove useless dependency

## Feat

* **backend:** use correct database for scheduler


<a name="v0.0.29"></a>
# Version v0.0.29 (2023-05-18)

## Feat

* **ci:** enable sea orm info logs in prod build


<a name="v0.0.28"></a>
# Version v0.0.28 (2023-05-18)


<a name="v0.0.27"></a>
# Version v0.0.27 (2023-05-15)

## Build

* **backend:** bump version

## Fix

* **backend:** store import error string in database


<a name="v0.0.26"></a>
# Version v0.0.26 (2023-05-15)

## Build

* **backend:** bump version

## Fix

* **backend:** allow listennotes init to fail


<a name="v0.0.25"></a>
# Version v0.0.25 (2023-05-15)

## Build

* **backend:** bump version

## Fix

* **backend:** deploy summary job only when import complete


<a name="v0.0.24"></a>
# Version v0.0.24 (2023-05-15)


<a name="v0.0.23"></a>
# Version v0.0.23 (2023-05-15)

## Build

* **backend:** bump version

## Fix

* **backend:** import Goodreads books from MediaTracker


<a name="v0.0.22"></a>
# Version v0.0.22 (2023-05-14)

## Build

* **backend:** bump version

## Fix

* **backend:** parse correct date from media tracker


<a name="v0.0.21"></a>
# Version v0.0.21 (2023-05-14)

## Build

* **backend:** bump version

## Docs

* add example for insecure cookie

## Fix

* **backend:** do not bail out when getting details


<a name="v0.0.20"></a>
# Version v0.0.20 (2023-05-13)

## Build

* **backend:** bump version

## Docs

* add ELI5 section

## Feat

* **backend:** allow setting insecure cookies

## Fix

* **backend:** add expires token to cookie created


<a name="v0.0.19"></a>
# Version v0.0.19 (2023-05-13)

## Fix

* **backend:** use redirects in openlibrary http client


<a name="v0.0.18"></a>
# Version v0.0.18 (2023-05-12)

## Build

* **backend:** update dependencies

## Docs

* make features clearer

## Fix

* **backend:** use redirects in openlibrary http client


<a name="v0.0.17"></a>
# Version v0.0.17 (2023-05-12)

## Build

* **backend:** bump version

## Chore

* **backend:** log name of selected database backend

## Docs

* allow updating app from script
* add deployment guide
* fix incorrect paths in guide
* add information about project

## Feat

* **backend:** load only `database.url` from environment
* **frontend:** use correct default values for form

## Fix

* **backend:** remove useless dbg stmt
* **backend:** log when a import job starts up


<a name="v0.0.16"></a>
# Version v0.0.16 (2023-05-11)


<a name="v0.0.15"></a>
# Version v0.0.15 (2023-05-10)


<a name="v0.0.14"></a>
# Version v0.0.14 (2023-05-10)


<a name="v0.0.13"></a>
# Version v0.0.13 (2023-05-07)

## Build

* **backend:** bump version

## Ci

* **gh-actions:** disable docker caching

## Feat

* **frontend:** increase scale on hover

## Fix

* **frontend:** make rating text optional


<a name="v0.0.12"></a>
# Version v0.0.12 (2023-05-07)

## Ci

* general changes

## Style

* **backend:** arrange struct definitions for config


<a name="v0.0.11"></a>
# Version v0.0.11 (2023-05-07)


<a name="v0.0.10"></a>
# Version v0.0.10 (2023-05-05)

## Build

* **backend:** bump version

## Feat

* rename project

## Fix

* finish renaming project


<a name="v0.0.9"></a>
# Version v0.0.9 (2023-05-05)


<a name="v0.0.8"></a>
# Version v0.0.8 (2023-05-04)


<a name="v0.0.7"></a>
# Version v0.0.7 (2023-05-03)

## Chore

* **graphql:** generate type definitions

## Feat

* **backend:** add endpoint to get user details
* **backend:** use correct data types for date columns
* **frontend:** redirect to auth page on invalid token
* **frontend:** show overlay when loading

## Fix

* **backend:** use correct enum repr
* **backend:** remove useless `graphql` attribute
* **backend:** use correct data type for enum
* **backend:** use text columns to denote enums
* **backend:** correct order for migrations
* **frontend:** send correct episode number as cmd
* **frontend:** refresh list


<a name="v0.0.6"></a>
# Version v0.0.6 (2023-05-03)

## Feat

* **frontend:** add link to self website

## Fix

* **frontend:** use correct casing for words


<a name="v0.0.5"></a>
# Version v0.0.5 (2023-05-02)


<a name="v0.0.4"></a>
# Version v0.0.4 (2023-05-01)

## Build

* **backend:** bump version


<a name="v0.0.3"></a>
# Version v0.0.3 (2023-04-25)

## Ci

* general updates

## Fix

* **backend:** only display trace messages on bg job
* **backend:** load port from env var
* **frontend:** allow dynamic hostname


<a name="v0.0.2"></a>
# Version v0.0.2 (2023-04-25)

## Ci

* do not install tini
* decrease docker size

## Docs

* mention project status


<a name="v0.0.1"></a>
# Version v0.0.1 (2023-04-25)

## Build

* ensure static linking
* **app:** update tailwindcss

## Chore

* **app:** add tailwindcss config
* **app:** run formatter
* **app:** remove demo material
* **frontend:** rename `app` to `frontend`
* **frontend:** rename `app` to `frontend`

## Ci

* add configuration for deployment
* configure config files
* do not install stuff thats already installed

## Feat

* initial commit
* **app:** make layout better
* **app:** add basic data fetching
* **app:** add nextjs app
* **app:** add basic application
* **app:** enable static generation
* **app:** add basic pages
* **backend:** add project config struct
* **backend:** allow displaying nested routes
* **backend:** add basic axum application
* **backend:** use correct embed route
* **backend:** add initial migration code
* **backend:** handle outputs from nextjs export
* **frontend:** add basic project
* **frontend:** add basic about page

## Fix

* **ci:** use correct tag name
* **frontend:** use correct package name
