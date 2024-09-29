use std::sync::Arc;

use apalis::prelude::MemoryStorage;
use async_graphql::{Error, Result};
use background::CoreApplicationJob;
use common_models::{
    ChangeCollectionToEntityInput, DefaultCollection, SearchDetails, StringIdObject,
};
use database_models::{
    collection, collection_to_entity,
    prelude::{
        Collection, CollectionToEntity, Exercise, Metadata, MetadataGroup, Person, User,
        UserToEntity, Workout,
    },
    user_to_entity,
};
use database_utils::{
    add_entity_to_collection, create_or_update_collection, ilike_sql, item_reviews,
    remove_entity_from_collection,
};
use dependent_models::{CollectionContents, SearchResults};
use enums::EntityLot;
use media_models::{
    CollectionContentsInput, CollectionContentsSortBy, CollectionItem,
    CreateOrUpdateCollectionInput, EntityWithLot,
};
use migrations::{
    AliasedCollection, AliasedCollectionToEntity, AliasedExercise, AliasedMetadata,
    AliasedMetadataGroup, AliasedPerson, AliasedUser, AliasedUserToEntity,
};
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, ItemsAndPagesNumber, Iterable, JoinType,
    ModelTrait, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};
use sea_query::{
    extension::postgres::PgExpr, Alias, Condition, Expr, Func, Iden, Query, SimpleExpr, Write,
};

pub struct CollectionService {
    db: DatabaseConnection,
    config: Arc<config::AppConfig>,
    perform_core_application_job: MemoryStorage<CoreApplicationJob>,
}

impl CollectionService {
    pub fn new(
        db: &DatabaseConnection,
        config: Arc<config::AppConfig>,
        perform_core_application_job: &MemoryStorage<CoreApplicationJob>,
    ) -> Self {
        Self {
            config,
            db: db.clone(),
            perform_core_application_job: perform_core_application_job.clone(),
        }
    }
}

impl CollectionService {
    pub async fn user_collections_list(
        &self,
        user_id: &String,
        name: Option<String>,
    ) -> Result<Vec<CollectionItem>> {
        // TODO: Replace when https://github.com/SeaQL/sea-query/pull/787 is merged
        struct JsonBuildObject;
        impl Iden for JsonBuildObject {
            fn unquoted(&self, s: &mut dyn Write) {
                write!(s, "JSON_BUILD_OBJECT").unwrap();
            }
        }
        struct JsonAgg;
        impl Iden for JsonAgg {
            fn unquoted(&self, s: &mut dyn Write) {
                write!(s, "JSON_AGG").unwrap();
            }
        }
        let collaborators_subquery = Query::select()
            .from(UserToEntity)
            .expr(
                Func::cust(JsonAgg).arg(
                    Func::cust(JsonBuildObject)
                        .arg(Expr::val("id"))
                        .arg(Expr::col((AliasedUser::Table, AliasedUser::Id)))
                        .arg(Expr::val("name"))
                        .arg(Expr::col((AliasedUser::Table, AliasedUser::Name))),
                ),
            )
            .join(
                JoinType::InnerJoin,
                AliasedUser::Table,
                Expr::col((AliasedUserToEntity::Table, AliasedUserToEntity::UserId))
                    .equals((AliasedUser::Table, AliasedUser::Id)),
            )
            .and_where(
                Expr::col((
                    AliasedUserToEntity::Table,
                    AliasedUserToEntity::CollectionId,
                ))
                .equals((AliasedCollection::Table, AliasedCollection::Id)),
            )
            .and_where(
                Expr::col((AliasedUser::Table, AliasedUser::Id))
                    .not_equals((AliasedCollection::Table, AliasedCollection::UserId)),
            )
            .to_owned();
        let count_subquery = Query::select()
            .expr(collection_to_entity::Column::Id.count())
            .from(CollectionToEntity)
            .and_where(
                Expr::col((
                    AliasedCollectionToEntity::Table,
                    AliasedCollectionToEntity::CollectionId,
                ))
                .equals((
                    AliasedUserToEntity::Table,
                    AliasedUserToEntity::CollectionId,
                )),
            )
            .to_owned();
        let collections = Collection::find()
            .apply_if(name, |query, v| {
                query.filter(collection::Column::Name.eq(v))
            })
            .select_only()
            .column(collection::Column::Id)
            .column(collection::Column::Name)
            .column_as(
                collection::Column::Name
                    .is_in(DefaultCollection::iter().map(|s| s.to_string()))
                    .and(collection::Column::UserId.eq(user_id)),
                "is_default",
            )
            .column(collection::Column::InformationTemplate)
            .expr_as(
                SimpleExpr::SubQuery(None, Box::new(count_subquery.into_sub_query_statement())),
                "count",
            )
            .expr_as(
                Func::coalesce([
                    SimpleExpr::SubQuery(
                        None,
                        Box::new(collaborators_subquery.into_sub_query_statement()),
                    ),
                    SimpleExpr::FunctionCall(Func::cast_as(Expr::val("[]"), Alias::new("JSON"))),
                ]),
                "collaborators",
            )
            .column(collection::Column::Description)
            .column_as(
                Expr::expr(
                    Func::cust(JsonBuildObject)
                        .arg(Expr::val("id"))
                        .arg(Expr::col((AliasedUser::Table, AliasedUser::Id)))
                        .arg(Expr::val("name"))
                        .arg(Expr::col((AliasedUser::Table, AliasedUser::Name))),
                ),
                "creator",
            )
            .order_by_desc(collection::Column::LastUpdatedOn)
            .left_join(User)
            .left_join(UserToEntity)
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .into_model::<CollectionItem>()
            .all(&self.db)
            .await
            .unwrap();
        Ok(collections)
    }

    pub async fn collection_contents(
        &self,
        input: CollectionContentsInput,
    ) -> Result<CollectionContents> {
        let search = input.search.unwrap_or_default();
        let sort = input.sort.unwrap_or_default();
        let filter = input.filter.unwrap_or_default();
        let page: u64 = search.page.unwrap_or(1).try_into().unwrap();
        let maybe_collection = Collection::find_by_id(input.collection_id.clone())
            .one(&self.db)
            .await
            .unwrap();
        let collection = match maybe_collection {
            Some(c) => c,
            None => return Err(Error::new("Collection not found".to_owned())),
        };

        let take = input
            .take
            .unwrap_or_else(|| self.config.frontend.page_size.try_into().unwrap());
        let results = if take != 0 {
            let paginator = CollectionToEntity::find()
                .left_join(Metadata)
                .left_join(MetadataGroup)
                .left_join(Person)
                .left_join(Exercise)
                .left_join(Workout)
                .filter(collection_to_entity::Column::CollectionId.eq(collection.id.clone()))
                .apply_if(search.query, |query, v| {
                    query.filter(
                        Condition::any()
                            .add(
                                Expr::col((AliasedMetadata::Table, AliasedMetadata::Title))
                                    .ilike(ilike_sql(&v)),
                            )
                            .add(
                                Expr::col((
                                    AliasedMetadataGroup::Table,
                                    AliasedMetadataGroup::Title,
                                ))
                                .ilike(ilike_sql(&v)),
                            )
                            .add(
                                Expr::col((AliasedPerson::Table, AliasedPerson::Name))
                                    .ilike(ilike_sql(&v)),
                            )
                            .add(
                                Expr::col((AliasedExercise::Table, AliasedExercise::Id))
                                    .ilike(ilike_sql(&v)),
                            ),
                    )
                })
                .apply_if(filter.metadata_lot, |query, v| {
                    query.filter(
                        Condition::any()
                            .add(Expr::col((AliasedMetadata::Table, AliasedMetadata::Lot)).eq(v)),
                    )
                })
                .apply_if(filter.entity_type, |query, v| {
                    let f = match v {
                        EntityLot::Metadata => {
                            collection_to_entity::Column::MetadataId.is_not_null()
                        }
                        EntityLot::MetadataGroup => {
                            collection_to_entity::Column::MetadataGroupId.is_not_null()
                        }
                        EntityLot::Person => collection_to_entity::Column::PersonId.is_not_null(),
                        EntityLot::Exercise => {
                            collection_to_entity::Column::ExerciseId.is_not_null()
                        }
                        EntityLot::Workout => collection_to_entity::Column::WorkoutId.is_not_null(),
                        EntityLot::WorkoutTemplate => {
                            collection_to_entity::Column::WorkoutTemplateId.is_not_null()
                        }
                        EntityLot::Collection => unreachable!(),
                    };
                    query.filter(f)
                })
                .order_by(
                    match sort.by {
                        CollectionContentsSortBy::LastUpdatedOn => {
                            Expr::col(collection_to_entity::Column::LastUpdatedOn)
                        }
                        CollectionContentsSortBy::Title => Expr::expr(Func::coalesce([
                            Expr::col((AliasedMetadata::Table, AliasedMetadata::Title)).into(),
                            Expr::col((AliasedMetadataGroup::Table, AliasedMetadataGroup::Title))
                                .into(),
                            Expr::col((AliasedPerson::Table, AliasedPerson::Name)).into(),
                            Expr::col((AliasedExercise::Table, AliasedExercise::Id)).into(),
                        ])),
                        CollectionContentsSortBy::Date => Expr::expr(Func::coalesce([
                            Expr::col((AliasedMetadata::Table, AliasedMetadata::PublishDate))
                                .into(),
                            Expr::col((AliasedPerson::Table, AliasedPerson::BirthDate)).into(),
                        ])),
                    },
                    sort.order.into(),
                )
                .paginate(&self.db, take);
            let mut items = vec![];
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            for cte in paginator.fetch_page(page - 1).await? {
                items.push(EntityWithLot {
                    entity_id: cte.entity_id,
                    entity_lot: cte.entity_lot,
                });
            }
            SearchResults {
                details: SearchDetails {
                    total: number_of_items.try_into().unwrap(),
                    next_page: if page < number_of_pages {
                        Some((page + 1).try_into().unwrap())
                    } else {
                        None
                    },
                },
                items,
            }
        } else {
            SearchResults {
                details: SearchDetails::default(),
                items: vec![],
            }
        };
        let user = collection.find_related(User).one(&self.db).await?.unwrap();
        let reviews = item_reviews(
            &self.db,
            &collection.user_id,
            &input.collection_id,
            EntityLot::Collection,
        )
        .await?;
        Ok(CollectionContents {
            details: collection,
            reviews,
            results,
            user,
        })
    }

    pub async fn create_or_update_collection(
        &self,
        user_id: &String,
        input: CreateOrUpdateCollectionInput,
    ) -> Result<StringIdObject> {
        create_or_update_collection(&self.db, user_id, input).await
    }

    pub async fn delete_collection(&self, user_id: String, name: &str) -> Result<bool> {
        if DefaultCollection::iter().any(|col_name| col_name.to_string() == name) {
            return Err(Error::new("Can not delete a default collection".to_owned()));
        }
        let collection = Collection::find()
            .filter(collection::Column::Name.eq(name))
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .one(&self.db)
            .await?;
        let resp = if let Some(c) = collection {
            Collection::delete_by_id(c.id).exec(&self.db).await.is_ok()
        } else {
            false
        };
        Ok(resp)
    }

    pub async fn add_entity_to_collection(
        &self,
        user_id: &String,
        input: ChangeCollectionToEntityInput,
    ) -> Result<bool> {
        add_entity_to_collection(&self.db, user_id, input, &self.perform_core_application_job).await
    }

    pub async fn remove_entity_from_collection(
        &self,
        user_id: &String,
        input: ChangeCollectionToEntityInput,
    ) -> Result<StringIdObject> {
        remove_entity_from_collection(&self.db, user_id, input).await
    }
}
