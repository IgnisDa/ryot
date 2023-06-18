import urllib.request
import urllib.parse
import json
from typing import TypedDict, Literal


class ExternalId(TypedDict):
    imdbId: str
    tmdbId: int


class ProgressPayload(TypedDict):
    mediaType: Literal["movie", "tv"]
    id: ExternalId
    seasonNumber: int
    episodeNumber: int
    action: Literal["playing", "paused"]
    progress: float
    duration: float


class MarkAsSeenPayload(TypedDict):
    mediaType: Literal["movie", "tv"]
    id: ExternalId
    seasonNumber: int
    episodeNumber: int
    duration: float


class Ryot:
    def __init__(self, url: str, api_token: str) -> None:
        self.url = url
        self.api_token = api_token

    def set_progress(self, payload: ProgressPayload):
        url = urllib.parse.urljoin(
            self.url, '/api/progress/by-external-id?token=' + self.api_token)

        put_json(url, payload)

    def mark_as_seen(self, payload: MarkAsSeenPayload):
        url = urllib.parse.urljoin(
            self.url, '/api/seen/by-external-id?token=' + self.api_token)

        put_json(url, payload)


def put_json(url: str, data: dict):
    postdata = json.dumps(data).encode()

    headers = {"Content-Type": "application/json; charset=UTF-8"}

    httprequest = urllib.request.Request(
        url,
        data=postdata,
        headers=headers,
        method="PUT"
    )

    urllib.request.urlopen(httprequest)
