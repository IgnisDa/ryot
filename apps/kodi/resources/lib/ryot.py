import os
from pathlib import Path
from datetime import date
import urllib.request
import urllib.parse
import json
from typing import Literal, Optional

class Ryot:
    def __init__(self, url: str, slug: str) -> None:
        self.url = url
        self.slug = slug

    def update_progress(
        self,
        id: str,
        lot: str,
        progress: int,
        season_number: Optional[int],
        episode_number: Optional[int],
    ):
        return self.post_json(
            {
                "identifier": id,
                "lot": lot,
                "progress": int(progress),
                "show_season_number": season_number,
                "show_episode_number": episode_number,
            },
        )

    def post_json(self, variables: dict):
        headers = {
            "Content-Type": "application/json; charset=UTF-8",
            "User-Agent": "Ryot Kodi Script"
        }
        postdata = json.dumps(variables).encode('utf-8')

        try:
            httprequest = urllib.request.Request(
                urllib.parse.urljoin(self.url, "/webhooks/integrations/kodi") + '/' + self.slug,
                data=postdata,
                headers=headers,
                method="POST",
            )
            response = urllib.request.urlopen(httprequest)
            data = response.read().decode("utf-8")
            return (True, data)
        except Exception as e:
            return (False, str(e))
            
