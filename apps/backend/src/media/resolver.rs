use async_graphql::{Context, Enum, Error, InputObject, Object, OutputType, Result, SimpleObject};
use chrono::{DateTime, Utc};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, ModelTrait,
    QueryFilter, QueryOrder,
};
use serde::{Deserialize, Serialize};

use crate::{
    books::resolver::SeenStatus,
    entities::{
        book,
        metadata::Model as MetadataModel,
        prelude::{Book, Creator, Metadata, MetadataImage, Seen},
        seen,
    },
    graphql::IdObject,
    migrator::MetadataLot,
    utils::user_id_from_ctx,
};

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct MediaSeen {
    pub identifier: String,
    pub seen: SeenStatus,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
pub struct BookSpecifics {
    pub pages: Option<i32>,
}

#[derive(Debug, Serialize, Deserialize, Enum, Clone, PartialEq, Eq, Copy)]
pub enum ProgressUpdateAction {
    Update,
    JustStarted,
    InThePast,
}

#[derive(Debug, Serialize, Deserialize, InputObject, Clone)]
pub struct ProgressUpdate {
    pub metadata_id: i32,
    pub progress: Option<i32>,
    pub action: ProgressUpdateAction,
    pub date: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize, Deserialize, SimpleObject, Clone)]
#[graphql(concrete(name = "BookDetails", params(BookSpecifics)))]
pub struct MediaDetails<T: OutputType> {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    #[graphql(name = "type")]
    pub lot: MetadataLot,
    pub creators: Vec<String>,
    pub images: Vec<String>,
    pub publish_year: Option<i32>,
    pub specifics: T,
}

#[derive(Default)]
pub struct MediaQuery;

#[Object]
impl MediaQuery {
    // Get details about a book present in the database
    async fn book_details(
        &self,
        gql_ctx: &Context<'_>,
        metadata_id: i32,
    ) -> Result<MediaDetails<BookSpecifics>> {
        gql_ctx
            .data_unchecked::<MediaService>()
            .book_details(metadata_id)
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

    async fn book_details(&self, metadata_id: i32) -> Result<MediaDetails<BookSpecifics>> {
        let (meta, creators, images) = self.generic_metadata(metadata_id).await?;
        let book = Book::find_by_id(metadata_id)
            .one(&self.db)
            .await
            .unwrap()
            .unwrap();
        let resp = MediaDetails {
            id: meta.id,
            title: meta.title,
            description: meta.description,
            publish_year: meta.publish_year,
            lot: meta.lot,
            creators,
            images,
            specifics: BookSpecifics {
                pages: book.num_pages,
            },
        };
        Ok(resp)
    }

    pub async fn book_read(
        &self,
        identifiers: Vec<String>,
        user_id: i32,
    ) -> Result<Vec<MediaSeen>> {
        let books = Book::find()
            .filter(book::Column::OpenLibraryKey.is_in(&identifiers))
            .all(&self.db)
            .await
            .unwrap();
        let seen = Seen::find()
            .filter(seen::Column::UserId.eq(user_id))
            .filter(
                seen::Column::MetadataId
                    .is_in(books.iter().map(|b| b.metadata_id).collect::<Vec<_>>()),
            )
            .all(&self.db)
            .await
            .unwrap();
        let mut resp = vec![];
        for identifier in identifiers {
            let is_in_database = books.iter().find(|b| b.open_library_key == identifier);
            if let Some(m) = is_in_database {
                let is_there = if seen.iter().any(|b| b.metadata_id == m.metadata_id) {
                    SeenStatus::ConsumedAtleastOnce
                } else {
                    SeenStatus::NotConsumed
                };
                resp.push(MediaSeen {
                    identifier,
                    seen: is_there,
                });
            } else {
                resp.push(MediaSeen {
                    identifier,
                    seen: SeenStatus::NotInDatabase,
                });
            }
        }
        Ok(resp)
    }

    pub async fn progress_update(&self, input: ProgressUpdate, user_id: i32) -> Result<IdObject> {
        let prev_seen = Seen::find()
            .filter(seen::Column::Progress.lt(100))
            .filter(seen::Column::UserId.eq(user_id))
            .filter(seen::Column::MetadataId.eq(input.metadata_id))
            .order_by_desc(seen::Column::LastUpdateOn)
            .all(&self.db)
            .await
            .unwrap();
        let seen_item = match input.action {
            ProgressUpdateAction::Update => {
                assert!(prev_seen.len() == 1);
                let progress = input.progress.unwrap();
                let mut last_seen: seen::ActiveModel = prev_seen[0].clone().into();
                last_seen.progress = ActiveValue::Set(progress);
                last_seen.last_update_on = ActiveValue::Set(Utc::now());
                if progress == 100 {
                    last_seen.finished_on = ActiveValue::Set(Some(Utc::now()));
                }
                last_seen.update(&self.db).await.unwrap()
            }
            ProgressUpdateAction::JustStarted | ProgressUpdateAction::InThePast => {
                if !prev_seen.is_empty() {
                    return Err(Error::new(
                        "There is already a `seen` item in progress".to_owned(),
                    ));
                }
                let (started_on, progress) = if input.action == ProgressUpdateAction::JustStarted {
                    (Some(Utc::now()), 0)
                } else {
                    (None, 100)
                };
                let seen_ins = seen::ActiveModel {
                    progress: ActiveValue::Set(progress),
                    user_id: ActiveValue::Set(user_id),
                    metadata_id: ActiveValue::Set(input.metadata_id),
                    started_on: ActiveValue::Set(started_on),
                    finished_on: ActiveValue::Set(None),
                    last_update_on: ActiveValue::Set(Utc::now()),
                    ..Default::default()
                };
                seen_ins.insert(&self.db).await.unwrap()
            }
        };
        Ok(IdObject { id: seen_item.id })
    }
}
