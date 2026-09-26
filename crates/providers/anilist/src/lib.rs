mod base;
pub use base::AnilistService;

mod models;

mod anime;
pub use anime::AnilistAnimeService;

mod manga;
pub use manga::AnilistMangaService;

mod people;
pub use people::NonMediaAnilistService;
