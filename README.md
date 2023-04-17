# trackona

Trackona is a self hosted platform for tracking movies, TV shows, video games,
books and audiobooks.

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
