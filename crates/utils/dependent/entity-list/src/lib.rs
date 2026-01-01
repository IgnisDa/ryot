use std::{collections::HashSet, sync::Arc};

use anyhow::Result;
use application_utils::graphql_to_db_order;
use common_models::{DefaultCollection, SearchDetails, SearchInput, UserLevelCacheKey};
use database_models::{
    collection, collection_entity_membership, collection_to_entity, entity_translation, exercise,
    genre, metadata, metadata_group, metadata_to_genre, person,
    prelude::{
        Collection, CollectionEntityMembership, CollectionToEntity, EntityTranslation, Exercise,
        Genre, Metadata, MetadataGroup, Person, Review, Seen, User, UserMeasurement, UserToEntity,
        Workout, WorkoutTemplate,
    },
    review, seen, user, user_measurement, user_to_entity, workout, workout_template,
};
use database_utils::{
    apply_columns_search, build_collection_filter_condition, extract_pagination_params, user_by_id,
};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, SearchResults,
    UserCollectionsListResponse, UserExercisesListResponse, UserMeasurementsListResponse,
    UserMetadataGroupsListInput, UserMetadataGroupsListResponse, UserMetadataListInput,
    UserMetadataListResponse, UserPeopleListInput, UserPeopleListResponse,
    UserTemplatesOrWorkoutsListInput, UserTemplatesOrWorkoutsListSortBy, UserWorkoutsListResponse,
    UserWorkoutsTemplatesListResponse,
};
use enum_models::{EntityTranslationVariant, ExerciseSource, SeenState, UserToMediaReason};
use fitness_models::{ExerciseSortBy, UserExercisesListInput, UserMeasurementsListInput};
use media_models::{
    CollectionItem, GenreListItem, MediaCollectionPresenceFilter, MediaCollectionStrategyFilter,
    MediaGeneralFilter, MediaSortBy, PersonAndMetadataGroupsSortBy,
};
use sea_orm::{
    ColumnTrait, Condition, EntityTrait, ItemsAndPagesNumber, Iterable, JoinType, Order,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait, RelationTrait, Select, Value,
    prelude::Expr,
    sea_query::{
        Alias, Func, NullOrdering, PgFunc, Query, SimpleExpr, extension::postgres::PgExpr,
    },
};
use supporting_service::SupportingService;

fn apply_is_in_filter<E, T, C>(query: Select<E>, values: Option<&Vec<T>>, column: C) -> Select<E>
where
    E: EntityTrait,
    T: Clone + Into<Value>,
    C: ColumnTrait + Copy,
{
    query.apply_if(values.filter(|v| !v.is_empty()), move |q, v| {
        q.filter(column.is_in(v.clone()))
    })
}

fn get_user_search_languages(user: &user::Model) -> Vec<String> {
    user.preferences
        .languages
        .providers
        .iter()
        .map(|p| p.preferred_language.clone())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect()
}

fn apply_columns_search_with_translations<D, E, C>(
    value: &str,
    query: Select<D>,
    columns: impl IntoIterator<Item = Expr>,
    translation_fk_column: entity_translation::Column,
    entity: E,
    entity_id_column: C,
    user_languages: &[String],
) -> Select<D>
where
    D: EntityTrait,
    E: EntityTrait,
    C: ColumnTrait,
{
    if value.is_empty() || user_languages.is_empty() {
        return apply_columns_search(value, query, columns);
    }

    let pattern = format!("%{value}%");
    let mut any_match_condition = Condition::any();

    for column in columns {
        any_match_condition = any_match_condition.add(column.ilike(pattern.clone()));
    }

    let translation_exists = Expr::exists(
        Query::select()
            .expr(Expr::val(1))
            .from(EntityTranslation)
            .and_where(
                Expr::col((entity_translation::Entity, translation_fk_column))
                    .equals((entity, entity_id_column)),
            )
            .and_where(entity_translation::Column::Language.is_in(user_languages.to_vec()))
            .and_where(entity_translation::Column::Variant.is_in([
                EntityTranslationVariant::Title,
                EntityTranslationVariant::Description,
            ]))
            .and_where(
                Expr::col((
                    entity_translation::Entity,
                    entity_translation::Column::Value,
                ))
                .ilike(pattern),
            )
            .to_owned(),
    );
    any_match_condition = any_match_condition.add(translation_exists);

    query.filter(any_match_condition)
}

fn build_translation_aware_sort_expr<E, C>(
    original_column: Expr,
    translation_fk_column: entity_translation::Column,
    entity: E,
    entity_id_column: C,
    user_languages: &[String],
) -> SimpleExpr
where
    E: EntityTrait,
    C: ColumnTrait,
{
    if user_languages.is_empty() {
        return original_column.into();
    }

    let translation_subquery = Query::select()
        .column(entity_translation::Column::Value)
        .from(EntityTranslation)
        .and_where(
            Expr::col((entity_translation::Entity, translation_fk_column))
                .equals((entity, entity_id_column)),
        )
        .and_where(entity_translation::Column::Language.is_in(user_languages.to_vec()))
        .and_where(entity_translation::Column::Variant.eq(EntityTranslationVariant::Title))
        .limit(1)
        .to_owned();

    Func::coalesce([
        SimpleExpr::SubQuery(
            None,
            Box::new(translation_subquery.into_sub_query_statement()),
        ),
        original_column.into(),
    ])
    .into()
}

pub async fn user_metadata_list(
    user_id: &String,
    input: UserMetadataListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserMetadataListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserMetadataList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserMetadataList,
        || async {
            let user = user_by_id(user_id, ss).await?;
            let user_languages = get_user_search_languages(&user);
            let order_by = input
                .sort
                .clone()
                .map(|a| graphql_to_db_order(a.order))
                .unwrap_or(Order::Asc);
            let (take, page) = extract_pagination_params(input.search.clone(), user_id, ss).await?;

            let max_seen_finished_on_subquery = Query::select()
                .expr(Func::max(Expr::col((
                    seen::Entity,
                    seen::Column::FinishedOn,
                ))))
                .from(Seen)
                .and_where(Expr::col((seen::Entity, seen::Column::UserId)).eq(user_id))
                .and_where(
                    Expr::col((seen::Entity, seen::Column::MetadataId))
                        .equals((metadata::Entity, metadata::Column::Id)),
                )
                .to_owned();

            let times_seen_subquery = Query::select()
                .expr(Func::count(Expr::col((seen::Entity, seen::Column::Id))))
                .from(Seen)
                .and_where(Expr::col((seen::Entity, seen::Column::UserId)).eq(user_id))
                .and_where(
                    Expr::col((seen::Entity, seen::Column::MetadataId))
                        .equals((metadata::Entity, metadata::Column::Id)),
                )
                .to_owned();

            let max_seen_last_updated_on_subquery = Query::select()
                .expr(Func::max(Expr::col((
                    seen::Entity,
                    seen::Column::LastUpdatedOn,
                ))))
                .from(Seen)
                .and_where(Expr::col((seen::Entity, seen::Column::UserId)).eq(user_id))
                .and_where(
                    Expr::col((seen::Entity, seen::Column::MetadataId))
                        .equals((metadata::Entity, metadata::Column::Id)),
                )
                .to_owned();

            let average_rating_subquery = Query::select()
                .expr(Func::avg(Expr::col((
                    review::Entity,
                    review::Column::Rating,
                ))))
                .from(Review)
                .and_where(Expr::col((review::Entity, review::Column::UserId)).eq(user_id))
                .and_where(
                    Expr::col((review::Entity, review::Column::MetadataId))
                        .equals((metadata::Entity, metadata::Column::Id)),
                )
                .and_where(Expr::col((review::Entity, review::Column::Rating)).is_not_null())
                .to_owned();

            let mut base_query = Metadata::find()
                .select_only()
                .column(metadata::Column::Id)
                .inner_join(UserToEntity)
                .filter(user_to_entity::Column::UserId.eq(user_id))
                .filter(user_to_entity::Column::MetadataId.is_not_null())
                .apply_if(input.lot, |query, v| {
                    query.filter(metadata::Column::Lot.eq(v))
                })
                .apply_if(input.filter.clone().and_then(|f| f.source), |query, v| {
                    query.filter(metadata::Column::Source.eq(v))
                })
                .apply_if(input.search.and_then(|s| s.query), |query, v| {
                    apply_columns_search_with_translations(
                        &v,
                        query,
                        [
                            Expr::col(metadata::Column::Title),
                            Expr::col(metadata::Column::Description),
                        ],
                        entity_translation::Column::MetadataId,
                        metadata::Entity,
                        metadata::Column::Id,
                        &user_languages,
                    )
                })
                .apply_if(
                    input.filter.clone().and_then(|f| f.date_range),
                    |outer_query, outer_value| {
                        outer_query
                            .apply_if(outer_value.start_date, |inner_query, inner_value| {
                                inner_query.filter(
                                    Expr::expr(SimpleExpr::SubQuery(
                                        None,
                                        Box::new(
                                            max_seen_finished_on_subquery
                                                .clone()
                                                .into_sub_query_statement(),
                                        ),
                                    ))
                                    .gte(inner_value),
                                )
                            })
                            .apply_if(outer_value.end_date, |inner_query, inner_value| {
                                inner_query.filter(
                                    Expr::expr(SimpleExpr::SubQuery(
                                        None,
                                        Box::new(
                                            max_seen_finished_on_subquery
                                                .clone()
                                                .into_sub_query_statement(),
                                        ),
                                    ))
                                    .lte(inner_value),
                                )
                            })
                    },
                );

            base_query = base_query.apply_if(
                input
                    .filter
                    .as_ref()
                    .and_then(|f| f.collections.as_ref())
                    .and_then(|collections| {
                        build_collection_filter_condition(user_id, collections)
                    }),
                |query, condition| query.filter(condition),
            );

            base_query = base_query.apply_if(input.filter.and_then(|f| f.general), |query, v| {
                let filter_expression: SimpleExpr = match v {
                    MediaGeneralFilter::Dropped => Expr::exists(
                        Query::select()
                            .expr(Expr::val(1))
                            .from(Seen)
                            .and_where(Expr::col((seen::Entity, seen::Column::UserId)).eq(user_id))
                            .and_where(
                                Expr::col((seen::Entity, seen::Column::MetadataId))
                                    .equals((metadata::Entity, metadata::Column::Id)),
                            )
                            .and_where(
                                Expr::col((seen::Entity, seen::Column::State))
                                    .eq(SeenState::Dropped),
                            )
                            .to_owned(),
                    ),
                    MediaGeneralFilter::OnAHold => Expr::exists(
                        Query::select()
                            .expr(Expr::val(1))
                            .from(Seen)
                            .and_where(Expr::col((seen::Entity, seen::Column::UserId)).eq(user_id))
                            .and_where(
                                Expr::col((seen::Entity, seen::Column::MetadataId))
                                    .equals((metadata::Entity, metadata::Column::Id)),
                            )
                            .and_where(
                                Expr::col((seen::Entity, seen::Column::State))
                                    .eq(SeenState::OnAHold),
                            )
                            .to_owned(),
                    ),
                    MediaGeneralFilter::Unrated => Expr::exists(
                        Query::select()
                            .expr(Expr::val(1))
                            .from(Review)
                            .and_where(
                                Expr::col((review::Entity, review::Column::UserId)).eq(user_id),
                            )
                            .and_where(
                                Expr::col((review::Entity, review::Column::MetadataId))
                                    .equals((metadata::Entity, metadata::Column::Id)),
                            )
                            .and_where(
                                Expr::col((review::Entity, review::Column::Rating)).is_not_null(),
                            )
                            .to_owned(),
                    )
                    .not(),
                    MediaGeneralFilter::All => metadata::Column::Id.is_not_null(),
                    MediaGeneralFilter::Rated => Expr::exists(
                        Query::select()
                            .expr(Expr::val(1))
                            .from(Review)
                            .and_where(
                                Expr::col((review::Entity, review::Column::UserId)).eq(user_id),
                            )
                            .and_where(
                                Expr::col((review::Entity, review::Column::MetadataId))
                                    .equals((metadata::Entity, metadata::Column::Id)),
                            )
                            .and_where(
                                Expr::col((review::Entity, review::Column::Rating)).is_not_null(),
                            )
                            .to_owned(),
                    ),
                    MediaGeneralFilter::Unfinished => Expr::val(UserToMediaReason::Finished)
                        .eq(PgFunc::any(Expr::col(user_to_entity::Column::MediaReason)))
                        .not(),
                };
                query.filter(filter_expression)
            });

            let paginator = base_query
                .apply_if(input.sort.map(|s| s.by), |query, v| match v {
                    MediaSortBy::Random => query.order_by(Expr::expr(Func::random()), order_by),
                    MediaSortBy::Title => query.order_by(
                        build_translation_aware_sort_expr(
                            Expr::col(metadata::Column::Title),
                            entity_translation::Column::MetadataId,
                            metadata::Entity,
                            metadata::Column::Id,
                            &user_languages,
                        ),
                        order_by,
                    ),
                    MediaSortBy::TimesConsumed => query.order_by(
                        Expr::expr(SimpleExpr::SubQuery(
                            None,
                            Box::new(times_seen_subquery.clone().into_sub_query_statement()),
                        )),
                        order_by,
                    ),
                    MediaSortBy::LastUpdated => {
                        query.order_by(user_to_entity::Column::LastUpdatedOn, order_by)
                    }
                    MediaSortBy::ReleaseDate => query.order_by_with_nulls(
                        metadata::Column::PublishDate,
                        order_by,
                        NullOrdering::Last,
                    ),
                    MediaSortBy::LastConsumed => query.order_by_with_nulls(
                        Expr::expr(SimpleExpr::SubQuery(
                            None,
                            Box::new(
                                max_seen_finished_on_subquery
                                    .clone()
                                    .into_sub_query_statement(),
                            ),
                        )),
                        order_by,
                        NullOrdering::Last,
                    ),
                    MediaSortBy::UserRating => query.order_by_with_nulls(
                        Expr::expr(SimpleExpr::SubQuery(
                            None,
                            Box::new(average_rating_subquery.clone().into_sub_query_statement()),
                        )),
                        order_by,
                        NullOrdering::Last,
                    ),
                    MediaSortBy::ProviderRating => query.order_by_with_nulls(
                        metadata::Column::ProviderRating,
                        order_by,
                        NullOrdering::Last,
                    ),
                })
                .order_by_with_nulls(
                    Expr::expr(SimpleExpr::SubQuery(
                        None,
                        Box::new(max_seen_last_updated_on_subquery.into_sub_query_statement()),
                    )),
                    Order::Desc,
                    NullOrdering::Last,
                );

            let paginator = paginator.into_tuple::<String>().paginate(&ss.db, take);
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            let response = SearchResults {
                items: paginator.fetch_page(page - 1).await?,
                details: SearchDetails {
                    total_items: number_of_items,
                    next_page: (page < number_of_pages).then(|| page + 1),
                },
            };
            Ok(response)
        },
    )
    .await
}

pub async fn user_collections_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserCollectionsListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserCollectionsList(UserLevelCacheKey {
            input: (),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserCollectionsList,
        || async {
            let user_jsonb_build_object = PgFunc::json_build_object(vec![
                (Expr::val("id"), Expr::col((user::Entity, user::Column::Id))),
                (
                    Expr::val("name"),
                    Expr::col((user::Entity, user::Column::Name)),
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
                        user_to_entity::Entity,
                        user_to_entity::Column::CollectionExtraInformation,
                    )),
                ),
            ]);
            let collaborators_subquery = Query::select()
                .from(UserToEntity)
                .expr(PgFunc::json_agg(outer_collaborator.clone()))
                .join(
                    JoinType::InnerJoin,
                    user::Entity,
                    Expr::col((user_to_entity::Entity, user_to_entity::Column::UserId))
                        .equals((user::Entity, user::Column::Id)),
                )
                .and_where(
                    Expr::col((user_to_entity::Entity, user_to_entity::Column::CollectionId))
                        .equals((collection::Entity, collection::Column::Id)),
                )
                .to_owned();
            let count_subquery = Query::select()
                .expr(collection_to_entity::Column::Id.count())
                .from(CollectionToEntity)
                .and_where(
                    Expr::col((
                        collection_to_entity::Entity,
                        collection_to_entity::Column::CollectionId,
                    ))
                    .equals((user_to_entity::Entity, user_to_entity::Column::CollectionId)),
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
                        SimpleExpr::FunctionCall(Func::cast_as(
                            Expr::val("[]"),
                            Alias::new("JSON"),
                        )),
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
                .all(&ss.db)
                .await
                .unwrap();
            Ok(response)
        },
    )
    .await
}

pub async fn user_metadata_groups_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: UserMetadataGroupsListInput,
) -> Result<CachedResponse<UserMetadataGroupsListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserMetadataGroupsList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserMetadataGroupsList,
        || async {
            let user = user_by_id(user_id, ss).await?;
            let user_languages = get_user_search_languages(&user);
            let (order_by, sort_order) = match input.sort {
                None => (Expr::col(metadata_group::Column::Parts), Order::Desc),
                Some(ord) => (
                    match ord.by {
                        PersonAndMetadataGroupsSortBy::Random => Expr::expr(Func::random()),
                        PersonAndMetadataGroupsSortBy::AssociatedEntityCount => {
                            Expr::col(metadata_group::Column::Parts)
                        }
                        PersonAndMetadataGroupsSortBy::Name => {
                            Expr::expr(build_translation_aware_sort_expr(
                                Expr::col(metadata_group::Column::Title),
                                entity_translation::Column::MetadataGroupId,
                                metadata_group::Entity,
                                metadata_group::Column::Id,
                                &user_languages,
                            ))
                        }
                    },
                    graphql_to_db_order(ord.order),
                ),
            };
            let (take, page) = extract_pagination_params(input.search.clone(), user_id, ss).await?;

            let mut base_query = MetadataGroup::find()
                .select_only()
                .column(metadata_group::Column::Id)
                .inner_join(UserToEntity)
                .filter(user_to_entity::Column::UserId.eq(user_id))
                .filter(user_to_entity::Column::MetadataGroupId.is_not_null())
                .apply_if(input.lot, |query, v| {
                    query.filter(metadata_group::Column::Lot.eq(v))
                })
                .apply_if(input.filter.clone().and_then(|f| f.source), |query, v| {
                    query.filter(metadata_group::Column::Source.eq(v))
                })
                .apply_if(input.search.and_then(|f| f.query), |query, v| {
                    apply_columns_search_with_translations(
                        &v,
                        query,
                        [
                            Expr::col(metadata_group::Column::Title),
                            Expr::col(metadata_group::Column::Description),
                        ],
                        entity_translation::Column::MetadataGroupId,
                        metadata_group::Entity,
                        metadata_group::Column::Id,
                        &user_languages,
                    )
                });

            base_query = base_query.apply_if(
                input
                    .filter
                    .as_ref()
                    .and_then(|f| f.collections.as_ref())
                    .and_then(|collections| {
                        build_collection_filter_condition(user_id, collections)
                    }),
                |query, condition| query.filter(condition),
            );

            let paginator = base_query
                .order_by(order_by, sort_order)
                .into_tuple::<String>()
                .paginate(&ss.db, take);
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            let response = SearchResults {
                items: paginator.fetch_page(page - 1).await?,
                details: SearchDetails {
                    total_items: number_of_items,
                    next_page: (page < number_of_pages).then(|| page + 1),
                },
            };
            Ok(response)
        },
    )
    .await
}

pub async fn user_people_list(
    user_id: &String,
    input: UserPeopleListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserPeopleListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserPeopleList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.clone(),
        }),
        ApplicationCacheValue::UserPeopleList,
        || async {
            let user = user_by_id(user_id, ss).await?;
            let user_languages = get_user_search_languages(&user);
            let (order_by, sort_order) = match input.sort {
                None => (
                    Expr::col(person::Column::AssociatedEntityCount),
                    Order::Desc,
                ),
                Some(ord) => (
                    match ord.by {
                        PersonAndMetadataGroupsSortBy::Random => Expr::expr(Func::random()),
                        PersonAndMetadataGroupsSortBy::Name => {
                            Expr::expr(build_translation_aware_sort_expr(
                                Expr::col(person::Column::Name),
                                entity_translation::Column::PersonId,
                                person::Entity,
                                person::Column::Id,
                                &user_languages,
                            ))
                        }
                        PersonAndMetadataGroupsSortBy::AssociatedEntityCount => {
                            Expr::col(person::Column::AssociatedEntityCount)
                        }
                    },
                    graphql_to_db_order(ord.order),
                ),
            };
            let (take, page) = extract_pagination_params(input.search.clone(), user_id, ss).await?;

            let mut base_query = Person::find()
                .select_only()
                .column(person::Column::Id)
                .inner_join(UserToEntity)
                .filter(user_to_entity::Column::UserId.eq(user_id))
                .filter(user_to_entity::Column::PersonId.is_not_null())
                .apply_if(input.filter.clone().and_then(|f| f.source), |query, v| {
                    query.filter(person::Column::Source.eq(v))
                })
                .apply_if(input.search.clone().and_then(|s| s.query), |query, v| {
                    apply_columns_search_with_translations(
                        &v,
                        query,
                        [
                            Expr::col(person::Column::Name),
                            Expr::col(person::Column::Description),
                        ],
                        entity_translation::Column::PersonId,
                        person::Entity,
                        person::Column::Id,
                        &user_languages,
                    )
                });

            base_query = base_query.apply_if(
                input
                    .filter
                    .as_ref()
                    .and_then(|f| f.collections.as_ref())
                    .and_then(|collections| {
                        build_collection_filter_condition(user_id, collections)
                    }),
                |query, condition| query.filter(condition),
            );

            let creators_paginator = base_query
                .order_by(order_by, sort_order)
                .into_tuple::<String>()
                .paginate(&ss.db, take);
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = creators_paginator.num_items_and_pages().await?;
            let response = SearchResults {
                items: creators_paginator.fetch_page(page - 1).await?,
                details: SearchDetails {
                    total_items: number_of_items,
                    next_page: (page < number_of_pages).then(|| page + 1),
                },
            };
            Ok(response)
        },
    )
    .await
}

pub async fn user_workouts_list(
    user_id: &String,
    input: UserTemplatesOrWorkoutsListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserWorkoutsListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserWorkoutsList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserWorkoutsList,
        || async {
            let (take, page) = extract_pagination_params(input.search.clone(), user_id, ss).await?;
            let paginator = Workout::find()
                .select_only()
                .column(workout::Column::Id)
                .filter(workout::Column::UserId.eq(user_id))
                .apply_if(input.search.and_then(|s| s.query), |query, v| {
                    apply_columns_search(&v, query, [Expr::col(workout::Column::Name)])
                })
                .apply_if(input.sort, |query, v| {
                    query.order_by(
                        match v.by {
                            UserTemplatesOrWorkoutsListSortBy::Random => Expr::expr(Func::random()),
                            UserTemplatesOrWorkoutsListSortBy::Time => {
                                Expr::col(workout::Column::EndTime)
                            }
                        },
                        graphql_to_db_order(v.order),
                    )
                })
                .into_tuple::<String>()
                .paginate(&ss.db, take);
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            let response = SearchResults {
                items: paginator.fetch_page(page - 1).await?,
                details: SearchDetails {
                    total_items: number_of_items,
                    next_page: (page < number_of_pages).then(|| page + 1),
                },
            };
            Ok(response)
        },
    )
    .await
}

pub async fn user_workout_templates_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: UserTemplatesOrWorkoutsListInput,
) -> Result<CachedResponse<UserWorkoutsTemplatesListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserWorkoutTemplatesList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserWorkoutTemplatesList,
        || async {
            let (take, page) = extract_pagination_params(input.search.clone(), user_id, ss).await?;
            let paginator = WorkoutTemplate::find()
                .select_only()
                .column(workout_template::Column::Id)
                .filter(workout_template::Column::UserId.eq(user_id))
                .apply_if(input.search.and_then(|s| s.query), |query, v| {
                    apply_columns_search(&v, query, [Expr::col(workout_template::Column::Name)])
                })
                .apply_if(input.sort, |query, v| {
                    query.order_by(
                        match v.by {
                            UserTemplatesOrWorkoutsListSortBy::Random => Expr::expr(Func::random()),
                            UserTemplatesOrWorkoutsListSortBy::Time => {
                                Expr::col(workout_template::Column::CreatedOn)
                            }
                        },
                        graphql_to_db_order(v.order),
                    )
                })
                .into_tuple::<String>()
                .paginate(&ss.db, take);
            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            let response = SearchResults {
                items: paginator.fetch_page(page - 1).await?,
                details: SearchDetails {
                    total_items: number_of_items,
                    next_page: (page < number_of_pages).then(|| page + 1),
                },
            };
            Ok(response)
        },
    )
    .await
}

pub async fn user_exercises_list(
    user_id: &String,
    input: UserExercisesListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserExercisesListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserExercisesList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserExercisesList,
        || async {
            let user_id = user_id.to_owned();
            let (take, page) =
                extract_pagination_params(input.search.clone(), &user_id, ss).await?;

            let order_by_col = match input.sort_by {
                None => Expr::col(exercise::Column::Id),
                Some(sb) => match sb {
                    ExerciseSortBy::Name => Expr::val("1"),
                    ExerciseSortBy::Random => Expr::expr(Func::random()),
                    ExerciseSortBy::TimesPerformed => Expr::expr(Func::coalesce([
                        Expr::col(user_to_entity::Column::ExerciseNumTimesInteracted).into(),
                        Expr::val(0).into(),
                    ])),
                    ExerciseSortBy::LastPerformed => Expr::expr(Func::coalesce([
                        Expr::col(user_to_entity::Column::LastUpdatedOn).into(),
                        Func::cast_as(Expr::val("1900-01-01"), Alias::new("timestamptz")).into(),
                    ])),
                },
            };

            let user_id_for_join = user_id.clone();
            let mut base_query = Exercise::find()
                .select_only()
                .column(exercise::Column::Id)
                .join_rev(
                    JoinType::LeftJoin,
                    UserToEntity::belongs_to(Exercise)
                        .from(user_to_entity::Column::ExerciseId)
                        .to(exercise::Column::Id)
                        .on_condition(move |_left, _right| {
                            Condition::all()
                                .add(user_to_entity::Column::UserId.eq(&user_id_for_join))
                        })
                        .into(),
                )
                .filter(
                    exercise::Column::Source
                        .eq(ExerciseSource::Github)
                        .or(exercise::Column::CreatedByUserId.eq(&user_id)),
                )
                .apply_if(input.filter.clone(), |query, q| {
                    let query = query
                        .apply_if(q.lots.as_ref().filter(|v| !v.is_empty()), |q, v| {
                            q.filter(exercise::Column::Lot.is_in(v.clone()))
                        })
                        .apply_if(q.muscles.as_ref().filter(|v| !v.is_empty()), |q, v| {
                            q.filter(v.iter().fold(Condition::any(), |cond, muscle| {
                                cond.add(
                                    Expr::val(*muscle)
                                        .eq(PgFunc::any(Expr::col(exercise::Column::Muscles))),
                                )
                            }))
                        });

                    let query =
                        apply_is_in_filter(query, q.levels.as_ref(), exercise::Column::Level);
                    let query =
                        apply_is_in_filter(query, q.forces.as_ref(), exercise::Column::Force);
                    let query =
                        apply_is_in_filter(query, q.mechanics.as_ref(), exercise::Column::Mechanic);
                    apply_is_in_filter(query, q.equipments.as_ref(), exercise::Column::Equipment)
                })
                .apply_if(input.search.and_then(|s| s.query), |query, v| {
                    apply_columns_search(
                        &v,
                        query,
                        [
                            Expr::col((exercise::Entity, exercise::Column::Name)),
                            Expr::col((exercise::Entity, exercise::Column::AggregatedInstructions)),
                        ],
                    )
                });

            if let Some(ref filter) = input.filter
                && let Some(ref collections) = filter.collections
                && !collections.is_empty()
            {
                let (first_filter, remaining_filters) = collections.split_first().unwrap();

                let mut combined_condition: SimpleExpr = {
                    let exists_condition = Expr::exists(
                        Query::select()
                            .expr(Expr::val(1))
                            .from(CollectionEntityMembership)
                            .and_where(
                                collection_entity_membership::Column::OriginCollectionId
                                    .eq(&first_filter.collection_id),
                            )
                            .and_where(collection_entity_membership::Column::UserId.eq(&user_id))
                            .and_where(
                                Expr::col(collection_entity_membership::Column::EntityId).equals((
                                    user_to_entity::Entity,
                                    user_to_entity::Column::EntityId,
                                )),
                            )
                            .and_where(
                                Expr::col(collection_entity_membership::Column::EntityLot).equals(
                                    (user_to_entity::Entity, user_to_entity::Column::EntityLot),
                                ),
                            )
                            .to_owned(),
                    );
                    match first_filter.presence {
                        MediaCollectionPresenceFilter::PresentIn => exists_condition,
                        MediaCollectionPresenceFilter::NotPresentIn => exists_condition.not(),
                    }
                };

                for coll_filter in remaining_filters {
                    let exists_condition = Expr::exists(
                        Query::select()
                            .expr(Expr::val(1))
                            .from(CollectionEntityMembership)
                            .and_where(
                                collection_entity_membership::Column::OriginCollectionId
                                    .eq(&coll_filter.collection_id),
                            )
                            .and_where(collection_entity_membership::Column::UserId.eq(&user_id))
                            .and_where(
                                Expr::col(collection_entity_membership::Column::EntityId).equals((
                                    user_to_entity::Entity,
                                    user_to_entity::Column::EntityId,
                                )),
                            )
                            .and_where(
                                Expr::col(collection_entity_membership::Column::EntityLot).equals(
                                    (user_to_entity::Entity, user_to_entity::Column::EntityLot),
                                ),
                            )
                            .to_owned(),
                    );
                    let condition = match coll_filter.presence {
                        MediaCollectionPresenceFilter::PresentIn => exists_condition,
                        MediaCollectionPresenceFilter::NotPresentIn => exists_condition.not(),
                    };

                    combined_condition = match coll_filter.strategy {
                        MediaCollectionStrategyFilter::Or => combined_condition.or(condition),
                        MediaCollectionStrategyFilter::And => combined_condition.and(condition),
                    };
                }

                base_query = base_query.filter(combined_condition);
            }

            let mut paginator = base_query.order_by_desc(order_by_col);
            if !matches!(input.sort_by, Some(ExerciseSortBy::Random)) {
                paginator = paginator.order_by_asc(exercise::Column::Name);
            }
            let paginator = paginator.into_tuple::<String>().paginate(&ss.db, take);

            let ItemsAndPagesNumber {
                number_of_items,
                number_of_pages,
            } = paginator.num_items_and_pages().await?;
            let response = SearchResults {
                items: paginator.fetch_page(page - 1).await?,
                details: SearchDetails {
                    total_items: number_of_items,
                    next_page: (page < number_of_pages).then(|| page + 1),
                },
            };
            Ok(response)
        },
    )
    .await
}

pub async fn user_measurements_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: UserMeasurementsListInput,
) -> Result<CachedResponse<UserMeasurementsListResponse>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserMeasurementsList(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserMeasurementsList,
        || async {
            let resp = UserMeasurement::find()
                .apply_if(input.start_time, |query, v| {
                    query.filter(user_measurement::Column::Timestamp.gte(v))
                })
                .apply_if(input.end_time, |query, v| {
                    query.filter(user_measurement::Column::Timestamp.lte(v))
                })
                .filter(user_measurement::Column::UserId.eq(user_id))
                .order_by_asc(user_measurement::Column::Timestamp)
                .all(&ss.db)
                .await?;
            Ok(resp)
        },
    )
    .await
}

pub async fn user_genres_list(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: Option<SearchInput>,
) -> Result<SearchResults<String>> {
    let (take, page) = extract_pagination_params(input.clone(), &user_id, ss).await?;
    let num_items = "num_items";
    let query = Genre::find()
        .column_as(
            Expr::expr(Func::count(Expr::col((
                metadata_to_genre::Entity,
                metadata_to_genre::Column::MetadataId,
            )))),
            num_items,
        )
        .apply_if(input.and_then(|i| i.query), |query, v| {
            apply_columns_search(&v, query, [Expr::col(genre::Column::Name)])
        })
        .join(JoinType::Join, genre::Relation::MetadataToGenre.def())
        .group_by(Expr::tuple([
            Expr::col(genre::Column::Id).into(),
            Expr::col(genre::Column::Name).into(),
        ]))
        .order_by(Expr::col(Alias::new(num_items)), Order::Desc);
    let paginator = query
        .clone()
        .into_model::<GenreListItem>()
        .paginate(&ss.db, take);
    let ItemsAndPagesNumber {
        number_of_items,
        number_of_pages,
    } = paginator.num_items_and_pages().await?;
    let items = paginator.fetch_page(page - 1).await?;
    Ok(SearchResults {
        items: items.into_iter().map(|g| g.id).collect(),
        details: SearchDetails {
            total_items: number_of_items,
            next_page: (page < number_of_pages).then(|| page + 1),
        },
    })
}
