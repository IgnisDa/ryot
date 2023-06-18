import urllib.request
import urllib.parse
import json
from typing import Literal

PROGRESS_UPDATE = """
    mutation ProgressUpdate($input: ProgressUpdate!) {
      progressUpdate(input: $input) {
        id
      }
    }
"""

MEDIA_EXISTS_IN_DATABASE = """
    query MediaExistsInDatabase($identifier: String!, $lot: MetadataLot!) {
      mediaExistsInDatabase(identifier: $identifier, lot: $lot) {
        id
      }
    }  
"""


class Ryot:
    def __init__(self, url: str, api_token: str) -> None:
        self.url = url
        self.api_token = api_token

    def update_progress(self, payload):
        self.post_json(payload)

    def media_exists_in_database(self, identifier: str, lot: Literal["MOVIE", "SHOW"]):
        return self.post_json(
            MEDIA_EXISTS_IN_DATABASE, {"identifier": identifier, "lot": lot}
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
