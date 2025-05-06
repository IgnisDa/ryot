use std::{collections::HashSet, sync::Arc};

use application_utils::graphql_to_db_order;
use async_graphql::{Error, Result};
use chrono::Utc;
use common_models::{
    ChangeCollectionToEntityInput, CollectionExtraInformationLot, DefaultCollection, SearchDetails,
    StringIdObject, UserLevelCacheKey,
};
use common_utils::{MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS, ryot_log};
use database_models::{
    collection, collection_to_entity, metadata,
    prelude::{
        Collection, CollectionToEntity, Exercise, Metadata, MetadataGroup, Person, User,
        UserToEntity, Workout,
    },
    user_to_entity,
};
use database_utils::{ilike_sql, item_reviews, user_by_id};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, CollectionContents,
    CollectionContentsInput, CollectionContentsResponse, CollectionRecommendationsCachedInput,
    CollectionRecommendationsInput, SearchResults, UserCollectionsListResponse,
};
use dependent_utils::{
    add_entity_to_collection, create_or_update_collection, expire_user_collections_list_cache,
    generic_metadata, remove_entity_from_collection, update_metadata_and_notify_users,
};
use enum_models::EntityLot;
use itertools::Itertools;
use media_models::{
    CollectionContentsSortBy, CollectionItem, CreateOrUpdateCollectionInput, EntityWithLot,
};
use migrations::{
    AliasedCollection, AliasedCollectionToEntity, AliasedExercise, AliasedMetadata,
    AliasedMetadataGroup, AliasedPerson, AliasedUser, AliasedUserToEntity,
};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseBackend, EntityTrait, FromQueryResult,
    ItemsAndPagesNumber, Iterable, JoinType, ModelTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, QueryTrait, Statement,
};
use sea_query::{
    Alias, Condition, Expr, Func, PgFunc, Query, SimpleExpr, extension::postgres::PgExpr,
};
use supporting_service::SupportingService;
use uuid::Uuid;

pub struct CollectionService(pub Arc<SupportingService>);

impl CollectionService {
    pub async fn user_collections_list(
        &self,
        user_id: &String,
    ) -> Result<CachedResponse<UserCollectionsListResponse>> {
        let cc = &self.0.cache_service;
        let cache_key = ApplicationCacheKey::UserCollectionsList(UserLevelCacheKey {
            input: (),
            user_id: user_id.to_owned(),
        });
        if let Some((cache_id, response)) = cc.get_value(cache_key.clone()).await {
            return Ok(CachedResponse { cache_id, response });
        }
        let user_jsonb_build_object = PgFunc::json_build_object(vec![
            (
                Expr::val("id"),
                Expr::col((AliasedUser::Table, AliasedUser::Id)),
            ),
            (
                Expr::val("name"),
                Expr::col((AliasedUser::Table, AliasedUser::Name)),
            ),
        ]);
        let outer_collaborator = PgFunc::json_build_object(vec![
            (
                Expr::val("collaborator"),
                Expr::expr(user_jsonb_build_object.clone()),
            ),
            (
                Expr::val("extra_information"),
                Expr::col((
                    AliasedUserToEntity::Table,
                    AliasedUserToEntity::CollectionExtraInformation,
                )),
            ),
        ]);
        let collaborators_subquery = Query::select()
            .from(UserToEntity)
            .expr(PgFunc::json_agg(outer_collaborator.clone()))
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
        let response = Collection::find()
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
            .column_as(Expr::expr(user_jsonb_build_object), "creator")
            .order_by_desc(collection::Column::LastUpdatedOn)
            .left_join(User)
            .left_join(UserToEntity)
            .filter(user_to_entity::Column::UserId.eq(user_id))
            .into_model::<CollectionItem>()
            .all(&self.0.db)
            .await
            .unwrap();
        let cache_id = cc
            .set_key(
                cache_key,
                ApplicationCacheValue::UserCollectionsList(response.clone()),
            )
            .await?;
        Ok(CachedResponse { cache_id, response })
    }

    pub async fn collection_contents(
        &self,
        user_id: &String,
        input: CollectionContentsInput,
    ) -> Result<CachedResponse<CollectionContentsResponse>> {
        let cc = &self.0.cache_service;
        let key = ApplicationCacheKey::UserCollectionContents(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        });
        if let Some((id, cached)) = cc
            .get_value::<CollectionContentsResponse>(key.clone())
            .await
        {
            return Ok(CachedResponse {
                cache_id: id,
                response: cached,
            });
        }
        let preferences = user_by_id(user_id, &self.0).await?.preferences;
        let take = input
            .search
            .clone()
            .and_then(|s| s.take)
            .unwrap_or(preferences.general.list_page_size as u64);
        let search = input.search.unwrap_or_default();
        let sort = input.sort.unwrap_or_default();
        let filter = input.filter.unwrap_or_default();
        let page: u64 = search.page.unwrap_or(1).try_into().unwrap();
        let maybe_collection = Collection::find_by_id(input.collection_id.clone())
            .one(&self.0.db)
            .await
            .unwrap();
        let Some(details) = maybe_collection else {
            return Err(Error::new("Collection not found".to_owned()));
        };
        let paginator = CollectionToEntity::find()
            .left_join(Metadata)
            .left_join(MetadataGroup)
            .left_join(Person)
            .left_join(Exercise)
            .left_join(Workout)
            .filter(collection_to_entity::Column::CollectionId.eq(details.id.clone()))
            .apply_if(search.query, |query, v| {
                query.filter(
                    Condition::any()
                        .add(
                            Expr::col((AliasedMetadata::Table, AliasedMetadata::Title))
                                .ilike(ilike_sql(&v)),
                        )
                        .add(
                            Expr::col((AliasedMetadataGroup::Table, AliasedMetadataGroup::Title))
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
            .apply_if(filter.entity_lot, |query, v| {
                let f = match v {
                    EntityLot::Metadata => collection_to_entity::Column::MetadataId.is_not_null(),
                    EntityLot::MetadataGroup => {
                        collection_to_entity::Column::MetadataGroupId.is_not_null()
                    }
                    EntityLot::Person => collection_to_entity::Column::PersonId.is_not_null(),
                    EntityLot::Exercise => collection_to_entity::Column::ExerciseId.is_not_null(),
                    EntityLot::Workout => collection_to_entity::Column::WorkoutId.is_not_null(),
                    EntityLot::WorkoutTemplate => {
                        collection_to_entity::Column::WorkoutTemplateId.is_not_null()
                    }
                    EntityLot::Collection | EntityLot::Review | EntityLot::UserMeasurement => {
                        unreachable!()
                    }
                };
                query.filter(f)
            })
            .order_by(
                match sort.by {
                    CollectionContentsSortBy::Random => Expr::expr(Func::random()),
                    CollectionContentsSortBy::LastUpdatedOn => {
                        Expr::col(collection_to_entity::Column::LastUpdatedOn)
                    }
                    CollectionContentsSortBy::Date => Expr::expr(Func::coalesce([
                        Expr::col((AliasedMetadata::Table, AliasedMetadata::PublishDate)).into(),
                        Expr::col((AliasedPerson::Table, AliasedPerson::BirthDate)).into(),
                    ])),
                    CollectionContentsSortBy::Title => Expr::expr(Func::coalesce([
                        Expr::col((AliasedMetadata::Table, AliasedMetadata::Title)).into(),
                        Expr::col((AliasedMetadataGroup::Table, AliasedMetadataGroup::Title))
                            .into(),
                        Expr::col((AliasedPerson::Table, AliasedPerson::Name)).into(),
                        Expr::col((AliasedExercise::Table, AliasedExercise::Id)).into(),
                    ])),
                },
                graphql_to_db_order(sort.order),
            )
            .paginate(&self.0.db, take);
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
        let results = SearchResults {
            details: SearchDetails {
                total: number_of_items.try_into().unwrap(),
                next_page: if page < number_of_pages {
                    Some((page + 1).try_into().unwrap())
                } else {
                    None
                },
            },
            items,
        };
        let user = details.find_related(User).one(&self.0.db).await?.unwrap();
        let reviews = item_reviews(
            &details.user_id,
            &input.collection_id,
            EntityLot::Collection,
            true,
            &self.0,
        )
        .await?;
        let total_items = CollectionToEntity::find()
            .filter(collection_to_entity::Column::CollectionId.eq(input.collection_id.clone()))
            .count(&self.0.db)
            .await?;
        let response = CollectionContents {
            user,
            reviews,
            results,
            details,
            total_items,
        };
        let cache_id = cc
            .set_key(
                key,
                ApplicationCacheValue::UserCollectionContents(Box::new(response.clone())),
            )
            .await?;
        Ok(CachedResponse { response, cache_id })
    }

    pub async fn collection_recommendations(
        &self,
        _user_id: &String,
        input: CollectionRecommendationsInput,
    ) -> Result<SearchResults<String>> {
        let cc = &self.0.cache_service;
        let cache_key =
            ApplicationCacheKey::CollectionRecommendations(CollectionRecommendationsCachedInput {
                collection_id: input.collection_id.clone(),
            });
        let required_set = 'calc: {
            if let Some((_cache_id, response)) = cc.get_value(cache_key.clone()).await {
                break 'calc response;
            }
            let mut data = vec![];
            #[derive(Debug, FromQueryResult)]
            struct CustomQueryResponse {
                metadata_id: String,
            }
            let mut args = vec![input.collection_id.into()];
            args.extend(
                MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS
                    .into_iter()
                    .map(|s| s.into()),
            );
            let media_items =
                CustomQueryResponse::find_by_statement(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    r#"
SELECT "cte"."metadata_id"
FROM "collection_to_entity" "cte"
WHERE "cte"."collection_id" = $1 AND "cte"."metadata_id" IS NOT NULL
ORDER BY RANDOM() LIMIT 10;
        "#,
                    args,
                ))
                .all(&self.0.db)
                .await?;
            ryot_log!(debug, "Media items: {:?}", media_items);
            for item in media_items {
                update_metadata_and_notify_users(&item.metadata_id, &self.0).await?;
                let generic = generic_metadata(&item.metadata_id, &self.0).await?;
                data.extend(generic.suggestions);
            }
            cc.set_key(
                cache_key,
                ApplicationCacheValue::CollectionRecommendations(data.clone()),
            )
            .await?;
            data
        };
        ryot_log!(debug, "Required set: {:?}", required_set);

        let preferences = user_by_id(_user_id, &self.0).await?.preferences;
        let search = input.search.unwrap_or_default();
        let take = search
            .take
            .unwrap_or(preferences.general.list_page_size as u64);
        let page: u64 = search.page.unwrap_or(1).try_into().unwrap();

        let paginator = Metadata::find()
            .select_only()
            .column(metadata::Column::Id)
            .filter(metadata::Column::Id.is_in(required_set))
            .apply_if(search.query, |query, v| {
                query.filter(
                    Condition::any()
                        .add(Expr::col(metadata::Column::Title).ilike(ilike_sql(&v)))
                        .add(Expr::col(metadata::Column::Description).ilike(ilike_sql(&v))),
                )
            })
            .into_tuple::<String>()
            .paginate(&self.0.db, take);

        let ItemsAndPagesNumber {
            number_of_items,
            number_of_pages,
        } = paginator.num_items_and_pages().await?;

        let items = paginator.fetch_page(page - 1).await?;

        Ok(SearchResults {
            items,
            details: SearchDetails {
                total: number_of_items.try_into().unwrap(),
                next_page: if page < number_of_pages {
                    Some((page + 1).try_into().unwrap())
                } else {
                    None
                },
            },
        })
    }

    pub async fn create_or_update_collection(
        &self,
        user_id: &String,
        input: CreateOrUpdateCollectionInput,
    ) -> Result<StringIdObject> {
        create_or_update_collection(user_id, &self.0, input).await
    }

    pub async fn delete_collection(&self, user_id: String, name: &str) -> Result<bool> {
        if DefaultCollection::iter().any(|col_name| col_name.to_string() == name) {
            return Err(Error::new("Can not delete a default collection".to_owned()));
        }
        let collection = Collection::find()
            .filter(collection::Column::Name.eq(name))
            .filter(collection::Column::UserId.eq(user_id.to_owned()))
            .one(&self.0.db)
            .await?;
        let Some(c) = collection else {
            return Ok(false);
        };
        let resp = Collection::delete_by_id(c.id).exec(&self.0.db).await?;
        if resp.rows_affected > 0 {
            expire_user_collections_list_cache(&user_id, &self.0).await?;
        }
        Ok(true)
    }

    pub async fn add_entity_to_collection(
        &self,
        user_id: &String,
        input: ChangeCollectionToEntityInput,
    ) -> Result<bool> {
        add_entity_to_collection(user_id, input, &self.0).await
    }

    pub async fn remove_entity_from_collection(
        &self,
        user_id: &String,
        input: ChangeCollectionToEntityInput,
    ) -> Result<StringIdObject> {
        remove_entity_from_collection(user_id, input, &self.0).await
    }

    pub async fn handle_entity_added_to_collection_event(
        &self,
        collection_to_entity_id: Uuid,
    ) -> Result<()> {
        let (cte, collection) = CollectionToEntity::find_by_id(collection_to_entity_id)
            .find_also_related(Collection)
            .one(&self.0.db)
            .await?
            .ok_or_else(|| Error::new("Collection to entity does not exist"))?;
        let collection = collection.ok_or_else(|| Error::new("Collection does not exist"))?;
        let mut fields = collection.clone().information_template.unwrap_or_default();
        if !fields
            .iter()
            .any(|i| i.lot == CollectionExtraInformationLot::StringArray)
        {
            return Ok(());
        }
        let mut updated_needed = false;
        for field in fields.iter_mut() {
            if field.lot == CollectionExtraInformationLot::StringArray {
                let updated_values = cte
                    .information
                    .as_ref()
                    .and_then(|v| v.get(field.name.clone()).and_then(|f| f.as_array()))
                    .map(|f| {
                        f.iter()
                            .map(|v| v.as_str().unwrap_or_default())
                            .collect_vec()
                    });
                if let Some(updated_values) = updated_values {
                    let mut current_possible_values: HashSet<String> =
                        HashSet::from_iter(field.possible_values.clone().unwrap_or_default());
                    let old_size = current_possible_values.len();
                    for value in updated_values {
                        current_possible_values.insert(value.to_string());
                    }
                    if current_possible_values.len() != old_size {
                        field.possible_values =
                            Some(current_possible_values.into_iter().collect_vec());
                        updated_needed = true;
                    }
                }
            }
        }
        if !updated_needed {
            return Ok(());
        }
        let mut col: collection::ActiveModel = collection.into();
        col.information_template = ActiveValue::Set(Some(fields));
        col.last_updated_on = ActiveValue::Set(Utc::now());
        col.update(&self.0.db).await?;
        let users = UserToEntity::find()
            .select_only()
            .column(user_to_entity::Column::UserId)
            .filter(user_to_entity::Column::CollectionId.eq(&cte.collection_id))
            .into_tuple::<String>()
            .all(&self.0.db)
            .await?;
        for user in users {
            expire_user_collections_list_cache(&user, &self.0).await?;
        }
        Ok(())
    }
}
