use std::sync::Arc;

use async_graphql::{Context, Error, Object, Result};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
};

use crate::{
    entities::{
        metadata,
        prelude::{Metadata, Show},
        show,
    },
    graphql::IdObject,
    media::{
        resolver::{MediaDetails, MediaSearchResults, MediaService, SearchInput},
        MediaSpecifics,
    },
    migrator::{MetadataLot, ShowSource},
    traits::MediaProvider,
};

use super::{tmdb::TmdbService, ShowSpecifics};

#[derive(Default)]
pub struct ShowsQuery;

#[Object]
impl ShowsQuery {
    /// Search for a list of show by a particular search query and a given page.
    async fn show_search(
        &self,
        gql_ctx: &Context<'_>,
        input: SearchInput,
    ) -> Result<MediaSearchResults> {
        gql_ctx
            .data_unchecked::<ShowsService>()
            .show_search(&input.query, input.page)
            .await
    }
}

#[derive(Default)]
pub struct ShowsMutation;

#[Object]
impl ShowsMutation {
    /// Fetch details about a show and create a media item in the database.
    async fn commit_show(&self, gql_ctx: &Context<'_>, identifier: String) -> Result<IdObject> {
        gql_ctx
            .data_unchecked::<ShowsService>()
            .commit_show(&identifier)
            .await
    }
}

#[derive(Debug, Clone)]
pub struct ShowsService {
    db: DatabaseConnection,
    tmdb_service: Arc<TmdbService>,
    media_service: Arc<MediaService>,
}

impl ShowsService {
    pub fn new(
        db: &DatabaseConnection,
        tmdb_service: &TmdbService,
        media_service: &MediaService,
    ) -> Self {
        Self {
            tmdb_service: Arc::new(tmdb_service.clone()),
            db: db.clone(),
            media_service: Arc::new(media_service.clone()),
        }
    }
}

impl ShowsService {
    // Get show details from all sources
    async fn show_search(&self, query: &str, page: Option<i32>) -> Result<MediaSearchResults> {
        let movies = self.tmdb_service.search(query, page).await?;
        Ok(movies)
    }

    pub async fn details_from_provider(&self, metadata_id: i32) -> Result<MediaDetails> {
        let (metadata, additional_details) = Metadata::find_by_id(metadata_id)
            .find_also_related(Show)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let additional_details = additional_details.unwrap();
        let details = match additional_details.source {
            ShowSource::Tmdb => self.tmdb_service.details(&metadata.identifier).await?,
            ShowSource::Custom => {
                return Err(Error::new(
                    "Getting details for custom provider is not supported".to_owned(),
                ))
            }
        };
        Ok(details)
    }

    pub async fn commit_show(&self, identifier: &str) -> Result<IdObject> {
        let meta = Metadata::find()
            .filter(metadata::Column::Identifier.eq(identifier))
            .one(&self.db)
            .await
            .unwrap();
        if let Some(m) = meta {
            Ok(IdObject { id: m.id.into() })
        } else {
            let details = self.tmdb_service.details(identifier).await?;
            self.save_to_db(details).await
        }
    }

    pub async fn save_to_db(&self, details: MediaDetails) -> Result<IdObject> {
        let show_metadata_id = self
            .media_service
            .commit_media(
                details.identifier.clone(),
                MetadataLot::Show,
                details.title,
                details.description,
                details.publish_year,
                details.publish_date,
                details.images,
                details.creators,
                details.genres,
            )
            .await?;
        match details.specifics {
            MediaSpecifics::Show(s) => {
                let show = show::ActiveModel {
                    metadata_id: ActiveValue::Set(show_metadata_id),
                    details: ActiveValue::Set(ShowSpecifics {
                        seasons: s.seasons,
                        source: s.source,
                    }),
                    source: ActiveValue::Set(ShowSource::Tmdb),
                };
                let show = show.insert(&self.db).await.unwrap();
                Ok(IdObject {
                    id: show.metadata_id.into(),
                })
            }
            _ => unreachable!(),
        }
    }

    pub async fn update_details(&self, media_id: i32, details: ShowSpecifics) -> Result<()> {
        let media = Show::find_by_id(media_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let mut media: show::ActiveModel = media.into();
        media.details = ActiveValue::Set(details);
        media.save(&self.db).await.ok();
        Ok(())
    }
}
