use enums::MediaSource;
use providers::google_books::GoogleBooksService;

pub enum IntegrationType {
    Komga(String, String, String, MediaSource),
    Jellyfin(String),
    Emby(String),
    Plex(String, Option<String>),
    Audiobookshelf(String, String, Option<bool>, GoogleBooksService),
    Kodi(String),
    Sonarr(String, String, i32, String, String),
    Radarr(String, String, i32, String, String),
}
