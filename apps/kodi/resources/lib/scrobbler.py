import web_pdb
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

        web_pdb.set_trace()

        duration = video_info_tag.getDuration()
        current_time = player.getTime()
        progress = (current_time / duration) * 100
        title = video_info_tag.getTVShowTitle()

        tmdb_id = None

        if video_info_tag.getMediaType() == "episode":
            res = kodi_json_request(
                "VideoLibrary.GetEpisodeDetails",
                {"episodeid": video_info_tag.getDbId(), "properties": ["tvshowid"]},
            )

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

            # if tmdb_id is None:
            #     xbmc.log(
            #         f'Ryot: missing tmdbId for episode of "{title}"', xbmc.LOGDEBUG
            #     )
            #     return

            # season_number = video_info_tag.getSeason()
            # episode_number = video_info_tag.getEpisode()

            # xbmc.log(
            #     f'Ryot: updating progress for tv show "{title}"'
            #     f" {season_number}x{episode_number} - {progress :.2f}%",
            #     xbmc.LOGDEBUG,
            # )

            # ryot_tracker.update_progress(
            #     {
            #         "mediaType": "tv",
            #         "id": {"tmdbId": tmdb_id},
            #         "seasonNumber": season_number,
            #         "episodeNumber": episode_number,
            #         "progress": progress,
            #         "duration": duration * 1000,
            #     }
            # )

            # if self.previous_actions.can_mark_as_seen(id, progress):
            #     xbmc.log(
            #         f'Ryot: marking tv show "{title}"'
            #         f" {season_number}x{episode_number} as seen",
            #         xbmc.LOGDEBUG,
            #     )

            #     ryot_tracker.mark_as_seen(
            #         {
            #             "mediaType": "tv",
            #             "id": {"tmdbId": tmdb_id},
            #             "seasonNumber": season_number,
            #             "episodeNumber": episode_number,
            #             "duration": duration * 1000,
            #         }
            #     )

        elif video_info_tag.getMediaType() == "movie":
            tmdb_id = video_info_tag.getUniqueID("tmdbId")

        if tmdb_id is None:
            xbmc.log(f'Ryot: missing tmdbId for "{title}"', xbmc.LOGDEBUG)
            return

        xbmc.log(
            f'Ryot: updating progress for movie "{title}" - {progress * 100:.2f}%',
            xbmc.LOGDEBUG,
        )

        ryot_tracker.update_progress(
            {
                "mediaType": "movie",
                "id": {"tmdbId": tmdb_id},
                "progress": progress,
                "duration": duration * 1000,
            }
        )

        if self.previous_actions.can_mark_as_seen(id, progress):
            xbmc.log(
                f'Ryot: marking movie "{video_info_tag.getTitle()}" as seen',
                xbmc.LOGDEBUG,
            )

            ryot_tracker.mark_as_seen(
                {
                    "mediaType": "movie",
                    "id": {"tmdbId": tmdb_id},
                    "duration": duration * 1000,
                }
            )


def kodi_json_request(method: str, params: dict):
    args = {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    request = xbmc.executeJSONRPC(json.dumps(args))
    response = json.loads(request)

    if not isinstance(response, dict):
        return {}

    return response.get("result", {})
