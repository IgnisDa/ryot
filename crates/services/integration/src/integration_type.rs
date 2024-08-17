use enums::MediaSource;

pub enum IntegrationType {
    Komga(String, String, String, MediaSource),
    Jellyfin(String),
    Emby(String),
}
