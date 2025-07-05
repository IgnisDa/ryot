use async_graphql::{Error, Result};
use enum_models::{MediaLot, MediaSource};
use media_models::MetadataDetails;
use providers::{
    anilist::{AnilistAnimeService, AnilistMangaService, NonMediaAnilistService},
    audible::AudibleService,
    giant_bomb::GiantBombService,
    google_books::GoogleBooksService,
    hardcover::HardcoverService,
    igdb::IgdbService,
    itunes::ITunesService,
    listennotes::ListennotesService,
    manga_updates::MangaUpdatesService,
    myanimelist::{MalAnimeService, MalMangaService, NonMediaMalService},
    openlibrary::OpenlibraryService,
    tmdb::{NonMediaTmdbService, TmdbMovieService, TmdbShowService},
    vndb::VndbService,
    youtube_music::YoutubeMusicService,
};
use std::sync::Arc;
use supporting_service::SupportingService;
use traits::MediaProvider;

pub type Provider = Box<(dyn MediaProvider + Send + Sync)>;

pub async fn get_openlibrary_service(config: &config::AppConfig) -> Result<OpenlibraryService> {
    Ok(OpenlibraryService::new(&config.books.openlibrary).await)
}

pub async fn get_google_books_service(config: &config::AppConfig) -> Result<GoogleBooksService> {
    Ok(GoogleBooksService::new(&config.books.google_books).await)
}

pub async fn get_hardcover_service(config: &config::AppConfig) -> Result<HardcoverService> {
    Ok(HardcoverService::new(&config.books.hardcover).await)
}

pub async fn get_tmdb_non_media_service(
    ss: &Arc<SupportingService>,
) -> Result<NonMediaTmdbService> {
    Ok(NonMediaTmdbService::new(ss.clone()).await)
}

pub async fn get_metadata_provider(
    lot: MediaLot,
    source: MediaSource,
    ss: &Arc<SupportingService>,
) -> Result<Provider> {
    let err = || Err(Error::new("This source is not supported".to_owned()));
    let service: Provider = match source {
        MediaSource::YoutubeMusic => Box::new(YoutubeMusicService::new().await),
        MediaSource::Hardcover => Box::new(get_hardcover_service(&ss.config).await?),
        MediaSource::Vndb => Box::new(VndbService::new(&ss.config.visual_novels).await),
        MediaSource::Openlibrary => Box::new(get_openlibrary_service(&ss.config).await?),
        MediaSource::Itunes => Box::new(ITunesService::new(&ss.config.podcasts.itunes).await),
        MediaSource::GoogleBooks => Box::new(get_google_books_service(&ss.config).await?),
        MediaSource::Audible => Box::new(AudibleService::new(&ss.config.audio_books.audible).await),
        MediaSource::Listennotes => Box::new(ListennotesService::new(ss.clone()).await),
        MediaSource::Tmdb => match lot {
            MediaLot::Show => Box::new(TmdbShowService::new(ss.clone()).await),
            MediaLot::Movie => Box::new(TmdbMovieService::new(ss.clone()).await),
            _ => return err(),
        },
        MediaSource::Anilist => match lot {
            MediaLot::Anime => {
                Box::new(AnilistAnimeService::new(&ss.config.anime_and_manga.anilist).await)
            }
            MediaLot::Manga => {
                Box::new(AnilistMangaService::new(&ss.config.anime_and_manga.anilist).await)
            }
            _ => return err(),
        },
        MediaSource::Myanimelist => match lot {
            MediaLot::Anime => Box::new(MalAnimeService::new(&ss.config.anime_and_manga.mal).await),
            MediaLot::Manga => Box::new(MalMangaService::new(&ss.config.anime_and_manga.mal).await),
            _ => return err(),
        },
        MediaSource::Igdb => Box::new(IgdbService::new(ss.clone()).await),
        MediaSource::GiantBomb => Box::new(GiantBombService::new(ss.clone()).await),
        MediaSource::MangaUpdates => {
            Box::new(MangaUpdatesService::new(&ss.config.anime_and_manga.manga_updates).await)
        }
        MediaSource::Custom => return err(),
    };
    Ok(service)
}

pub async fn get_non_metadata_provider(
    source: MediaSource,
    ss: &Arc<SupportingService>,
) -> Result<Provider> {
    let err = || Err(Error::new("This source is not supported".to_owned()));
    let service: Provider = match source {
        MediaSource::YoutubeMusic => Box::new(YoutubeMusicService::new().await),
        MediaSource::Hardcover => Box::new(get_hardcover_service(&ss.config).await?),
        MediaSource::Vndb => Box::new(VndbService::new(&ss.config.visual_novels).await),
        MediaSource::Openlibrary => Box::new(get_openlibrary_service(&ss.config).await?),
        MediaSource::Itunes => Box::new(ITunesService::new(&ss.config.podcasts.itunes).await),
        MediaSource::GoogleBooks => Box::new(get_google_books_service(&ss.config).await?),
        MediaSource::Audible => Box::new(AudibleService::new(&ss.config.audio_books.audible).await),
        MediaSource::Listennotes => Box::new(ListennotesService::new(ss.clone()).await),
        MediaSource::Igdb => Box::new(IgdbService::new(ss.clone()).await),
        MediaSource::GiantBomb => Box::new(GiantBombService::new(ss.clone()).await),
        MediaSource::MangaUpdates => {
            Box::new(MangaUpdatesService::new(&ss.config.anime_and_manga.manga_updates).await)
        }
        MediaSource::Tmdb => Box::new(get_tmdb_non_media_service(ss).await?),
        MediaSource::Anilist => {
            Box::new(NonMediaAnilistService::new(&ss.config.anime_and_manga.anilist).await)
        }
        MediaSource::Myanimelist => Box::new(NonMediaMalService::new().await),
        MediaSource::Custom => return err(),
    };
    Ok(service)
}

pub async fn details_from_provider(
    lot: MediaLot,
    source: MediaSource,
    identifier: &str,
    ss: &Arc<SupportingService>,
) -> Result<MetadataDetails> {
    let provider = get_metadata_provider(lot, source, ss).await?;
    let results = provider.metadata_details(identifier).await?;
    Ok(results)
}

pub async fn get_identifier_from_book_isbn(
    isbn: &str,
    hardcover_service: &HardcoverService,
    google_books_service: &GoogleBooksService,
    open_library_service: &OpenlibraryService,
) -> Option<(String, MediaSource)> {
    if let Some(id) = hardcover_service.id_from_isbn(isbn).await {
        return Some((id, MediaSource::Hardcover));
    }
    if let Some(id) = google_books_service.id_from_isbn(isbn).await {
        return Some((id, MediaSource::GoogleBooks));
    }
    if let Some(id) = open_library_service.id_from_isbn(isbn).await {
        return Some((id, MediaSource::Openlibrary));
    }
    None
}
