from datetime import date
import urllib.request
import urllib.parse
import json
from typing import Literal, Optional

COMMIT_MEDIA = """
    mutation CommitMedia($lot: MetadataLot!, $source: MetadataSource!, $identifier: String!) {
      commitMedia(lot: $lot, source: $source, identifier: $identifier) {
        id
      }
    }
"""

MEDIA_EXISTS_IN_DATABASE = """
    query MediaExistsInDatabase($identifier: String!, $lot: MetadataLot!, $source: MetadataSource!) {
      mediaExistsInDatabase(identifier: $identifier, lot: $lot, source: $source) {
        id
      }
    }  
"""

PROGRESS_UPDATE = """
    mutation ProgressUpdate($input: ProgressUpdate!) {
      progressUpdate(input: $input) {
        id
      }
    }
"""


class Ryot:
    def __init__(self, url: str, api_token: str) -> None:
        self.url = url
        self.api_token = api_token

    def media_exists_in_database(self, identifier: str, lot: Literal["MOVIE", "SHOW"]):
        # since we support only movies and shows
        input = {"identifier": identifier, "lot": lot, "source": "TMDB"}
        response = self.post_json(MEDIA_EXISTS_IN_DATABASE, input)["data"][
            "mediaExistsInDatabase"
        ]
        if response is None:
            return self.post_json(COMMIT_MEDIA, input)["data"]["commitMedia"]["id"]
        else:
            return response["id"]

    def update_progress(
        self,
        id: int,
        progress: int,
        season_number: Optional[int],
        episode_number: Optional[int],
    ):
        return self.post_json(
            PROGRESS_UPDATE,
            {
                "input": {
                    "metadataId": id,
                    "progress": int(progress),
                    "date": str(date.today()),
                    "showSeasonNumber": season_number,
                    "showEpisodeNumber": episode_number,
                }
            },
        )

    def post_json(self, query: str, variables: dict):
        postdata = json.dumps({"query": query, "variables": variables}).encode()

        headers = {
            "Content-Type": "application/json; charset=UTF-8",
            "Authorization": f"Bearer {self.api_token}",
        }

        httprequest = urllib.request.Request(
            urllib.parse.urljoin(self.url, "/graphql"),
            data=postdata,
            headers=headers,
            method="POST",
        )

        response = urllib.request.urlopen(httprequest)
        data = json.loads(response.read().decode("utf-8"))
        return data
