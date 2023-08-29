from datetime import datetime
import xbmc
import xbmcaddon
import xbmcgui
import json
from resources.lib.ryot import Ryot


class Scrobbler:
    def __init__(self) -> None:
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

        id = video_info_tag.getDbId()
        duration = video_info_tag.getDuration()
        current_time = player.getTime()
        progress = (current_time / duration) * 100

        slug = self.__addon__.getSettingString("slug")
        instance_url = self.__addon__.getSettingString("instanceUrl")

        if len(slug) == 0:
            xbmc.log("Ryot: missing Kodi slug", xbmc.LOGDEBUG)
            return

        if len(instance_url) == 0:
            xbmc.log("Ryot: missing instance url", xbmc.LOGDEBUG)
            return

        ryot_tracker = Ryot(instance_url, slug)

        title = None
        tmdb_id = None
        lot = None
        season_number = None
        episode_number = None

        if video_info_tag.getMediaType() == "episode":
            lot = "Show"
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
            season_number = video_info_tag.getSeason()
            episode_number = video_info_tag.getEpisode()

        elif video_info_tag.getMediaType() == "movie":
            tmdb_id = video_info_tag.getUniqueID("tmdb")
            lot = "Movie"
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

        xbmc.log(
            f'Ryot: updating progress for "{title}" - {progress}%',
            xbmc.LOGDEBUG,
        )

        (status, ex) = ryot_tracker.update_progress(
            tmdb_id, lot, progress, season_number, episode_number
        )
        if not status:
            xbmc.log(f'Ryot: {ex}', xbmc.LOGERROR)
        else:
            xbmc.log(f'Ryot: {ex}', xbmc.LOGDEBUG)

def kodi_json_request(method: str, params: dict):
    args = {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    request = xbmc.executeJSONRPC(json.dumps(args))
    response = json.loads(request)

    if not isinstance(response, dict):
        return {}

    return response.get("result", {})
