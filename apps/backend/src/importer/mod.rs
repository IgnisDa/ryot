use std::sync::Arc;

use async_graphql::{Context, InputObject, Object, Result};

use crate::{
    audio_books::resolver::AudioBooksService, books::resolver::BooksService, migrator::MetadataLot,
    movies::resolver::MoviesService, shows::resolver::ShowsService,
    video_games::resolver::VideoGamesService,
};

mod media_tracker;

#[derive(Debug, InputObject)]
pub struct MediaTrackerImportInput {
    /// The base url where the resource is present at
    api_url: String,
    /// An application token generated by an admin
    api_key: String,
}

#[derive(Debug)]
pub struct ImportItem {
    lot: MetadataLot,
    identifier: String,
}

#[derive(Debug)]
pub struct ImportResult {
    media: Vec<ImportItem>,
}

#[derive(Default)]
pub struct ImporterMutation;

#[Object]
impl ImporterMutation {
    /// Add job to import data from MediaTracker.
    async fn media_tracker_import(
        &self,
        gql_ctx: &Context<'_>,
        input: MediaTrackerImportInput,
    ) -> Result<bool> {
        gql_ctx
            .data_unchecked::<ImporterService>()
            .media_tracker_import(input)
            .await
    }
}

#[derive(Debug)]
pub struct ImporterService {
    audio_books_service: Arc<AudioBooksService>,
    books_service: Arc<BooksService>,
    movies_service: Arc<MoviesService>,
    shows_service: Arc<ShowsService>,
    video_games_service: Arc<VideoGamesService>,
}

impl ImporterService {
    pub fn new(
        audio_books_service: &AudioBooksService,
        books_service: &BooksService,
        movies_service: &MoviesService,
        shows_service: &ShowsService,
        video_games_service: &VideoGamesService,
    ) -> Self {
        Self {
            audio_books_service: Arc::new(audio_books_service.clone()),
            books_service: Arc::new(books_service.clone()),
            movies_service: Arc::new(movies_service.clone()),
            shows_service: Arc::new(shows_service.clone()),
            video_games_service: Arc::new(video_games_service.clone()),
        }
    }

    pub async fn media_tracker_import(&self, input: MediaTrackerImportInput) -> Result<bool> {
        let import = media_tracker::import(input).await?;
        for item in import.media.iter() {
            let data = match item.lot {
                MetadataLot::AudioBook => {
                    self.audio_books_service
                        .commit_audio_book(&item.identifier)
                        .await
                }
                MetadataLot::Book => self.books_service.commit_book(&item.identifier).await,
                MetadataLot::Movie => self.movies_service.commit_movie(&item.identifier).await,
                MetadataLot::Show => self.shows_service.commit_show(&item.identifier).await,
                MetadataLot::VideoGame => {
                    self.video_games_service
                        .commit_video_game(&item.identifier)
                        .await
                }
            };
            data.ok();
        }
        tracing::info!(
            "Imported {} media items from MediaTracker",
            import.media.len()
        );
        Ok(true)
    }
}
