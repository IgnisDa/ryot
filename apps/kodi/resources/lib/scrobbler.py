import xbmc
import xbmcaddon
import xbmcgui
import json
from resources.lib.ryot import Ryot
from resources.lib.previous_action import PreviousActions


class Scrobbler:
    def __init__(self) -> None:
        self.previous_actions = PreviousActions()
        self.__addon__ = xbmcaddon.Addon()
        self.media_cache = {}

    def scrobble(self, player: xbmc.Player):
        if player.isPlaying() is False:
            return

        playing_item = player.getPlayingItem()

        if not isinstance(playing_item, xbmcgui.ListItem):
            return

        video_info_tag = playing_item.getVideoInfoTag()

        if not isinstance(video_info_tag, xbmc.InfoTagVideo):
            return

        api_token = self.__addon__.getSettingString("apiToken")
        instance_url = self.__addon__.getSettingString("instanceUrl")

        if len(api_token) == 0:
            xbmc.log("Ryot: missing api token", xbmc.LOGDEBUG)
            return

        if len(instance_url) == 0:
            xbmc.log("Ryot: missing Ryot instance url", xbmc.LOGDEBUG)
            return

        ryot_tracker = Ryot(instance_url, api_token)

        id = video_info_tag.getDbId()
        duration = video_info_tag.getDuration()
        current_time = player.getTime()
        progress = (current_time / duration) * 100

        title = None
        tmdb_id = None
        lot = None

        if video_info_tag.getMediaType() == "episode":
            lot = "SHOW"
            res = kodi_json_request(
                "VideoLibrary.GetEpisodeDetails",
                {"episodeid": video_info_tag.getDbId(), "properties": ["tvshowid"]},
            )
            title = video_info_tag.getTVShowTitle()

            tv_show_id = res.get("episodedetails", {}).get("tvshowid")

            if tv_show_id is None:
                xbmc.log(
                    "Ryot: missing tvShowId for episode " + video_info_tag.getTitle(),
                    xbmc.LOGDEBUG,
                )
                return

            res = kodi_json_request(
                "VideoLibrary.GetTVShowDetails",
                {"tvshowid": tv_show_id, "properties": ["uniqueid"]},
            )

            tmdb_id = res.get("tvshowdetails", {}).get("uniqueid", {}).get("tmdb")

        elif video_info_tag.getMediaType() == "movie":
            tmdb_id = video_info_tag.getUniqueID("tmdb")
            lot = "MOVIE"
            title = video_info_tag.getTitle()

        if not title:
            xbmc.log(f'Ryot: missing title for "{id}"', xbmc.LOGDEBUG)
            return

        if not lot:
            xbmc.log("Ryot: only movie and show tracking is supported", xbmc.LOGDEBUG)
            return

        if not tmdb_id:
            xbmc.log(f'Ryot: missing tmdbId for "{title}"', xbmc.LOGDEBUG)
            return

        ryot_media_id = self.media_cache.get(tmdb_id, None)

        if not ryot_media_id:
            data = ryot_tracker.media_exists_in_database(tmdb_id, lot)
            ryot_media_id = data
            self.media_cache[tmdb_id] = data

        xbmc.log(
            f'Ryot: updating progress for movie "{title}" - {progress :.2f}%',
            xbmc.LOGDEBUG,
        )

        response = ryot_tracker.update_progress(ryot_media_id, progress)



def kodi_json_request(method: str, params: dict):
    args = {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    request = xbmc.executeJSONRPC(json.dumps(args))
    response = json.loads(request)

    if not isinstance(response, dict):
        return {}

    return response.get("result", {})
