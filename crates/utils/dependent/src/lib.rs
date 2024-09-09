use std::sync::Arc;

use async_graphql::{Error, Result};
use enums::{MediaLot, MediaSource};
use providers::{
    anilist::{AnilistAnimeService, AnilistMangaService},
    audible::AudibleService,
    google_books::GoogleBooksService,
    igdb::IgdbService,
    itunes::ITunesService,
    listennotes::ListennotesService,
    mal::{MalAnimeService, MalMangaService},
    manga_updates::MangaUpdatesService,
    openlibrary::OpenlibraryService,
    tmdb::{TmdbMovieService, TmdbShowService},
    vndb::VndbService,
};
use traits::MediaProvider;

pub type Provider = Box<(dyn MediaProvider + Send + Sync)>;

pub async fn get_openlibrary_service(
    config: &Arc<config::AppConfig>,
) -> Result<OpenlibraryService> {
    Ok(OpenlibraryService::new(&config.books.openlibrary, config.frontend.page_size).await)
}

pub async fn get_isbn_service(config: &Arc<config::AppConfig>) -> Result<GoogleBooksService> {
    Ok(GoogleBooksService::new(&config.books.google_books, config.frontend.page_size).await)
}

pub async fn get_metadata_provider(
    lot: MediaLot,
    source: MediaSource,
    config: &Arc<config::AppConfig>,
    timezone: &Arc<chrono_tz::Tz>,
) -> Result<Provider> {
    let err = || Err(Error::new("This source is not supported".to_owned()));
    let service: Provider = match source {
        MediaSource::Vndb => {
            Box::new(VndbService::new(&config.visual_novels, config.frontend.page_size).await)
        }
        MediaSource::Openlibrary => Box::new(get_openlibrary_service(config).await?),
        MediaSource::Itunes => {
            Box::new(ITunesService::new(&config.podcasts.itunes, config.frontend.page_size).await)
        }
        MediaSource::GoogleBooks => Box::new(get_isbn_service(config).await?),
        MediaSource::Audible => Box::new(
            AudibleService::new(&config.audio_books.audible, config.frontend.page_size).await,
        ),
        MediaSource::Listennotes => {
            Box::new(ListennotesService::new(&config.podcasts, config.frontend.page_size).await)
        }
        MediaSource::Tmdb => match lot {
            MediaLot::Show => Box::new(
                TmdbShowService::new(
                    &config.movies_and_shows.tmdb,
                    **timezone,
                    config.frontend.page_size,
                )
                .await,
            ),
            MediaLot::Movie => Box::new(
                TmdbMovieService::new(
                    &config.movies_and_shows.tmdb,
                    **timezone,
                    config.frontend.page_size,
                )
                .await,
            ),
            _ => return err(),
        },
        MediaSource::Anilist => match lot {
            MediaLot::Anime => Box::new(
                AnilistAnimeService::new(
                    &config.anime_and_manga.anilist,
                    config.frontend.page_size,
                )
                .await,
            ),
            MediaLot::Manga => Box::new(
                AnilistMangaService::new(
                    &config.anime_and_manga.anilist,
                    config.frontend.page_size,
                )
                .await,
            ),
            _ => return err(),
        },
        MediaSource::Mal => match lot {
            MediaLot::Anime => Box::new(
                MalAnimeService::new(&config.anime_and_manga.mal, config.frontend.page_size).await,
            ),
            MediaLot::Manga => Box::new(
                MalMangaService::new(&config.anime_and_manga.mal, config.frontend.page_size).await,
            ),
            _ => return err(),
        },
        MediaSource::Igdb => {
            Box::new(IgdbService::new(&config.video_games, config.frontend.page_size).await)
        }
        MediaSource::MangaUpdates => Box::new(
            MangaUpdatesService::new(
                &config.anime_and_manga.manga_updates,
                config.frontend.page_size,
            )
            .await,
        ),
        MediaSource::Custom => return err(),
    };
    Ok(service)
}
