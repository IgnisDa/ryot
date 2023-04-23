use async_graphql::{Context, Enum, Error, InputObject, Object, Result, SimpleObject};
use chrono::{NaiveDate, Utc};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait,
    QueryFilter, QueryOrder,
};
use serde::{Deserialize, Serialize};

use crate::{
    books::BookSpecifics,
    entities::{
        book,
        metadata::Model as MetadataModel,
        movie,
        prelude::{Book, Creator, Metadata, MetadataImage, Movie, Seen},
        seen,
        seen::Model as SeenObject,
    },
    graphql::IdObject,
    migrator::MetadataLot,
    movies::MovieSpecifics,
    utils::user_id_from_ctx,
};

use super::SeenStatus;

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaSearchItem {
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub author_names: Vec<String>,
    pub images: Vec<String>,
    pub publish_year: Option<i32>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
}

#[derive(Serialize, Deserialize, Debug, SimpleObject, Clone)]
pub struct SearchResults {
    pub total: i32,
    pub items: Vec<MediaSearchItem>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaSeen {
    pub identifier: String,
    pub seen: SeenStatus,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy)]
pub enum ProgressUpdateAction {
    Update,
    Now,
    InThePast,
    JustStarted,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct ProgressUpdate {
    pub metadata_id: i32,
    pub progress: Option<i32>,
    pub action: ProgressUpdateAction,
    pub date: Option<NaiveDate>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaDetails {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    #[graphql(name = "type")]
    pub lot: MetadataLot,
    pub creators: Vec<String>,
    pub images: Vec<String>,
    pub publish_year: Option<i32>,
    pub book_specifics: Option<BookSpecifics>,
    pub movie_specifics: Option<MovieSpecifics>,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct MediaConsumedInput {
    pub identifier: String,
    pub lot: MetadataLot,
}

#[derive(Default)]
pub struct MediaQuery;

#[Object]
impl MediaQuery {
    // Get details about a media present in the database
    async fn media_details(&self, gql_ctx: &Context<'_>, metadata_id: i32) -> Result<MediaDetails> {
        gql_ctx
            .data_unchecked::<MediaService>()
            .media_details(metadata_id)
            .await
    }

    // Get the user's seen history for a particular media item
    async fn seen_history(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: i32,
    ) -> Result<Vec<SeenObject>> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .seen_history(metadata_id, user_id)
            .await
    }

    // Check whether a media item has been consumed before
    async fn media_consumed(
        &self,
        gql_ctx: &Context<'_>,
        input: MediaConsumedInput,
    ) -> Result<MediaSeen> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .media_consumed(user_id, input)
            .await
    }
}

#[derive(Default)]
pub struct MediaMutation;

#[Object]
impl MediaMutation {
    // Mark a user's progress on a specific media item
    async fn progress_update(
        &self,
        gql_ctx: &Context<'_>,
        input: ProgressUpdate,
    ) -> Result<IdObject> {
        let user_id = user_id_from_ctx(gql_ctx).await?;
        gql_ctx
            .data_unchecked::<MediaService>()
            .progress_update(input, user_id)
            .await
    }
}

#[derive(Debug, Clone)]
pub struct MediaService {
    db: DatabaseConnection,
}

impl MediaService {
    pub fn new(db: &DatabaseConnection) -> Self {
        Self { db: db.clone() }
    }
}

impl MediaService {
    async fn generic_metadata(
        &self,
        metadata_id: i32,
    ) -> Result<(MetadataModel, Vec<String>, Vec<String>)> {
        let meta = match Metadata::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
        {
            Some(m) => m,
            None => return Err(Error::new("The record does not exit".to_owned())),
        };
        let creators = meta
            .find_related(Creator)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.name)
            .collect();
        let images = meta
            .find_related(MetadataImage)
            .all(&self.db)
            .await
            .unwrap()
            .into_iter()
            .map(|i| i.url)
            .collect();
        Ok((meta, creators, images))
    }

    async fn media_details(&self, metadata_id: i32) -> Result<MediaDetails> {
        let (meta, creators, images) = self.generic_metadata(metadata_id).await?;
        let mut resp = MediaDetails {
            id: meta.id,
            title: meta.title,
            description: meta.description,
            publish_year: meta.publish_year,
            lot: meta.lot,
            creators,
            images,
            book_specifics: None,
            movie_specifics: None,
        };
        match meta.lot {
            MetadataLot::Book => {
                let additional = Book::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.book_specifics = Some(BookSpecifics {
                    pages: additional.num_pages,
                });
            }
            MetadataLot::Movie => {
                let additional = Movie::find_by_id(metadata_id)
                    .one(&self.db)
                    .await
                    .unwrap()
                    .unwrap();
                resp.movie_specifics = Some(MovieSpecifics {
                    runtime: additional.runtime,
                });
            }
            _ => todo!(),
        };
        Ok(resp)
    }

    async fn seen_history(&self, metadata_id: i32, user_id: i32) -> Result<Vec<SeenObject>> {
        let prev_seen = Seen::find()
            .filter(seen::Column::UserId.eq(user_id))
            .filter(seen::Column::MetadataId.eq(metadata_id))
            .order_by_desc(seen::Column::LastUpdatedOn)
            .all(&self.db)
            .await
            .unwrap();
        Ok(prev_seen)
    }

    pub async fn media_consumed(
        &self,
        user_id: i32,
        input: MediaConsumedInput,
    ) -> Result<MediaSeen> {
        let media = match input.lot {
            MetadataLot::Book => Book::find()
                .filter(book::Column::OpenLibraryKey.eq(&input.identifier))
                .one(&self.db)
                .await
                .unwrap()
                .map(|b| b.metadata_id),
            MetadataLot::Movie => Movie::find()
                .filter(movie::Column::TmdbId.eq(&input.identifier))
                .one(&self.db)
                .await
                .unwrap()
                .map(|b| b.metadata_id),
            _ => todo!(),
        };
        let resp = if let Some(m) = media {
            let seen = Seen::find()
                .filter(seen::Column::UserId.eq(user_id))
                .filter(seen::Column::MetadataId.eq(media))
                .order_by_asc(seen::Column::LastUpdatedOn)
                .all(&self.db)
                .await
                .unwrap();
            let filtered = seen
                .iter()
                .filter(|b| b.metadata_id == m)
                .collect::<Vec<_>>();
            let is_there = if filtered.is_empty() {
                SeenStatus::NotConsumed
            } else {
                if filtered.last().unwrap().progress < 100 {
                    SeenStatus::CurrentlyUnderway
                } else {
                    SeenStatus::ConsumedAtleastOnce
                }
            };
            MediaSeen {
                identifier: input.identifier,
                seen: is_there,
            }
        } else {
            MediaSeen {
                identifier: input.identifier,
                seen: SeenStatus::NotInDatabase,
            }
        };
        Ok(resp)
    }

    pub async fn progress_update(&self, input: ProgressUpdate, user_id: i32) -> Result<IdObject> {
        let prev_seen = Seen::find()
            .filter(seen::Column::Progress.lt(100))
            .filter(seen::Column::UserId.eq(user_id))
            .filter(seen::Column::MetadataId.eq(input.metadata_id))
            .order_by_desc(seen::Column::LastUpdatedOn)
            .all(&self.db)
            .await
            .unwrap();
        let seen_item = match input.action {
            ProgressUpdateAction::Update => {
                if prev_seen.len() != 1 {
                    return Err(Error::new("There is no `seen` item underway".to_owned()));
                }
                let progress = input.progress.unwrap();
                let mut last_seen: seen::ActiveModel = prev_seen[0].clone().into();
                last_seen.progress = ActiveValue::Set(progress);
                last_seen.last_updated_on = ActiveValue::Set(Utc::now());
                if progress == 100 {
                    last_seen.finished_on = ActiveValue::Set(Some(Utc::now().date_naive()));
                }
                last_seen.update(&self.db).await.unwrap()
            }
            ProgressUpdateAction::Now
            | ProgressUpdateAction::InThePast
            | ProgressUpdateAction::JustStarted => {
                if !prev_seen.is_empty() {
                    return Err(Error::new(
                        "There is already a `seen` item in progress".to_owned(),
                    ));
                }
                let finished_on = if input.action == ProgressUpdateAction::Now {
                    Some(Utc::now().date_naive())
                } else {
                    input.date
                };
                let (progress, started_on) =
                    if matches!(input.action, ProgressUpdateAction::JustStarted) {
                        (0, Some(Utc::now().date_naive()))
                    } else {
                        (100, None)
                    };
                let seen_ins = seen::ActiveModel {
                    progress: ActiveValue::Set(progress),
                    user_id: ActiveValue::Set(user_id),
                    metadata_id: ActiveValue::Set(input.metadata_id),
                    started_on: ActiveValue::Set(started_on),
                    finished_on: ActiveValue::Set(finished_on),
                    last_updated_on: ActiveValue::Set(Utc::now()),
                    ..Default::default()
                };
                seen_ins.insert(&self.db).await.unwrap()
            }
        };
        Ok(IdObject { id: seen_item.id })
    }
}
