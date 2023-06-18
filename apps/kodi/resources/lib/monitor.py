import xbmc
from resources.lib.scrobbler import Scrobbler


class Monitor(xbmc.Monitor):
    def __init__(self, scrobbler: Scrobbler):
        self.scrobbler = scrobbler
        xbmc.Monitor.__init__(self)

    def onNotification(self, sender, method, dataJson):
        if method not in [
            "Player.OnPlay",
            "Player.OnPause",
            "Player.OnStop",
            "Player.OnSeek",
            "Player.OnResume",
        ]:
            return

        self.scrobbler.scrobble(xbmc.Player())
