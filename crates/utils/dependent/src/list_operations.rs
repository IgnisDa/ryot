use std::sync::Arc;

use application_utils::graphql_to_db_order;
use async_graphql::Result;
use common_models::{SearchDetails, UserLevelCacheKey};
use database_models::{
    collection, collection_to_entity, exercise, metadata, metadata_group, person, prelude::*,
    review, seen, user_measurement, user_to_entity, workout, workout_template,
};
use database_utils::{apply_collection_filter, ilike_sql, user_by_id};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, SearchResults,
    UserCollectionsListResponse, UserExercisesListResponse, UserMeasurementsListResponse,
    UserMetadataGroupsListInput, UserMetadataGroupsListResponse, UserMetadataListInput,
    UserMetadataListResponse, UserPeopleListInput, UserPeopleListResponse,
    UserTemplatesOrWorkoutsListInput, UserTemplatesOrWorkoutsListSortBy, UserWorkoutsListResponse,
    UserWorkoutsTemplatesListResponse,
};
use enum_models::{ExerciseSource, SeenState, UserToMediaReason};
use fitness_models::{ExerciseSortBy, UserExercisesListInput, UserMeasurementsListInput};
use media_models::{
    CollectionItem, MediaGeneralFilter, MediaSortBy, PersonAndMetadataGroupsSortBy,
};
use migrations::{
    AliasedCollection, AliasedCollectionToEntity, AliasedExercise, AliasedReview, AliasedUser,
    AliasedUserToEntity,
};
use sea_orm::Iterable;
use sea_orm::{
    ColumnTrait, Condition, EntityTrait, ItemsAndPagesNumber, JoinType, Order, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, QueryTrait, RelationTrait, prelude::Expr,
};
use sea_query::extension::postgres::PgExpr;
use sea_query::{Alias, Func, NullOrdering, PgFunc};
use slug::slugify;
use supporting_service::SupportingService;
use user_models::UserReviewScale;

pub async fn user_metadata_list(
    user_id: &String,
    input: UserMetadataListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserMetadataListResponse>> {
    let key = ApplicationCacheKey::UserMetadataList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });

    let (cache_id, response) = ss
        .cache_service
        .get_or_set_with_callback(
            key,
            |val| ApplicationCacheValue::UserMetadataList(val),
            || async {
                let preferences = user_by_id(user_id, ss).await?.preferences;

                let avg_rating_col = "user_average_rating";
                let cloned_user_id_1 = user_id.clone();
                let cloned_user_id_2 = user_id.clone();

                let order_by = input
                    .sort
                    .clone()
                    .map(|a| graphql_to_db_order(a.order))
                    .unwrap_or(Order::Asc);
                let review_scale = match preferences.general.review_scale {
                    UserReviewScale::OutOfTen => 10,
                    UserReviewScale::OutOfFive => 20,
                    UserReviewScale::OutOfHundred | UserReviewScale::ThreePointSmiley => 1,
                };
                let take = input
                    .search
                    .clone()
                    .and_then(|s| s.take)
                    .unwrap_or(preferences.general.list_page_size);
                let page: u64 = input
                    .search
                    .clone()
                    .and_then(|s| s.page)
                    .unwrap_or(1)
                    .try_into()
                    .unwrap();
                let paginator = Metadata::find()
                    .select_only()
                    .column(metadata::Column::Id)
                    .expr_as(
                        Func::round_with_precision(
                            Func::avg(
                                Expr::col((AliasedReview::Table, AliasedReview::Rating))
                                    .div(review_scale),
                            ),
                            review_scale,
                        ),
                        avg_rating_col,
                    )
                    .group_by(metadata::Column::Id)
                    .filter(user_to_entity::Column::UserId.eq(user_id))
                    .apply_if(input.lot, |query, v| {
                        query.filter(metadata::Column::Lot.eq(v))
                    })
                    .inner_join(UserToEntity)
                    .join(
                        JoinType::LeftJoin,
                        metadata::Relation::Review
                            .def()
                            .on_condition(move |_left, right| {
                                Condition::all().add(
                                    Expr::col((right, review::Column::UserId))
                                        .eq(cloned_user_id_1.clone()),
                                )
                            }),
                    )
                    .join(
                        JoinType::LeftJoin,
                        metadata::Relation::Seen
                            .def()
                            .on_condition(move |_left, right| {
                                Condition::all().add(
                                    Expr::col((right, seen::Column::UserId))
                                        .eq(cloned_user_id_2.clone()),
                                )
                            }),
                    )
                    .apply_if(input.search.and_then(|s| s.query), |query, v| {
                        query.filter(
                            Condition::any()
                                .add(Expr::col(metadata::Column::Title).ilike(ilike_sql(&v)))
                                .add(Expr::col(metadata::Column::Description).ilike(ilike_sql(&v))),
                        )
                    })
                    .apply_if(
                        input.filter.clone().and_then(|f| f.date_range),
                        |outer_query, outer_value| {
                            outer_query
                                .apply_if(outer_value.start_date, |inner_query, inner_value| {
                                    inner_query.filter(seen::Column::FinishedOn.gte(inner_value))
                                })
                                .apply_if(outer_value.end_date, |inner_query, inner_value| {
                                    inner_query.filter(seen::Column::FinishedOn.lte(inner_value))
                                })
                        },
                    )
                    .apply_if(
                        input.filter.clone().and_then(|f| f.collections),
                        |query, v| {
                            apply_collection_filter(
                                metadata::Column::Id,
                                query,
                                collection_to_entity::Column::MetadataId,
                                v,
                            )
                        },
                    )
                    .apply_if(input.filter.and_then(|f| f.general), |query, v| match v {
                        MediaGeneralFilter::All => query.filter(metadata::Column::Id.is_not_null()),
                        MediaGeneralFilter::Rated => query.filter(review::Column::Id.is_not_null()),
                        MediaGeneralFilter::Unrated => query.filter(review::Column::Id.is_null()),
                        MediaGeneralFilter::Unfinished => {
                            query.filter(
                                Expr::expr(Expr::val(UserToMediaReason::Finished.to_string()).eq(
                                    PgFunc::any(Expr::col(user_to_entity::Column::MediaReason)),
                                ))
                                .not(),
                            )
                        }
                        s => query.filter(seen::Column::State.eq(match s {
                            MediaGeneralFilter::Dropped => SeenState::Dropped,
                            MediaGeneralFilter::OnAHold => SeenState::OnAHold,
                            _ => unreachable!(),
                        })),
                    })
                    .apply_if(input.sort.map(|s| s.by), |query, v| match v {
                        MediaSortBy::Title => query.order_by(metadata::Column::Title, order_by),
                        MediaSortBy::Random => query.order_by(Expr::expr(Func::random()), order_by),
                        MediaSortBy::TimesConsumed => {
                            query.order_by(seen::Column::Id.count(), order_by)
                        }
                        MediaSortBy::LastUpdated => query
                            .order_by(user_to_entity::Column::LastUpdatedOn, order_by)
                            .group_by(user_to_entity::Column::LastUpdatedOn),
                        MediaSortBy::ReleaseDate => query.order_by_with_nulls(
                            metadata::Column::PublishYear,
                            order_by,
                            NullOrdering::Last,
                        ),
                        MediaSortBy::LastSeen => query.order_by_with_nulls(
                            seen::Column::FinishedOn.max(),
                            order_by,
                            NullOrdering::Last,
                        ),
                        MediaSortBy::UserRating => query.order_by_with_nulls(
                            Expr::col(Alias::new(avg_rating_col)),
                            order_by,
                            NullOrdering::Last,
                        ),
                        MediaSortBy::ProviderRating => query.order_by_with_nulls(
                            metadata::Column::ProviderRating,
                            order_by,
                            NullOrdering::Last,
                        ),
                    })
                    .order_by_desc(seen::Column::LastUpdatedOn.max())
                    .into_tuple::<String>()
                    .paginate(&ss.db, take);
                let ItemsAndPagesNumber {
                    number_of_items,
                    number_of_pages,
                } = paginator.num_items_and_pages().await?;
                let mut items = vec![];
                for c in paginator.fetch_page(page - 1).await? {
                    items.push(c);
                }
                let response = SearchResults {
                    items,
                    details: SearchDetails {
                        total: number_of_items.try_into().unwrap(),
                        next_page: (page < number_of_pages).then(|| (page + 1).try_into().unwrap()),
                    },
                };
                Ok(response)
            },
        )
        .await?;

    Ok(CachedResponse { cache_id, response })
}

pub async fn user_collections_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserCollectionsListResponse>> {
    let cache_key = ApplicationCacheKey::UserCollectionsList(UserLevelCacheKey {
        input: (),
        user_id: user_id.to_owned(),
    });

    let (cache_id, response) = ss
        .cache_service
        .get_or_set_with_callback(
            cache_key,
            |val| ApplicationCacheValue::UserCollectionsList(val),
            || async {
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
                let collaborators_subquery = sea_query::Query::select()
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
                let count_subquery = sea_query::Query::select()
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
                            .is_in(common_models::DefaultCollection::iter().map(|s| s.to_string()))
                            .and(collection::Column::UserId.eq(user_id)),
                        "is_default",
                    )
                    .column(collection::Column::InformationTemplate)
                    .expr_as(
                        sea_query::SimpleExpr::SubQuery(
                            None,
                            Box::new(count_subquery.into_sub_query_statement()),
                        ),
                        "count",
                    )
                    .expr_as(
                        Func::coalesce([
                            sea_query::SimpleExpr::SubQuery(
                                None,
                                Box::new(collaborators_subquery.into_sub_query_statement()),
                            ),
                            sea_query::SimpleExpr::FunctionCall(Func::cast_as(
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
        .await?;

    Ok(CachedResponse { cache_id, response })
}

pub async fn user_metadata_groups_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: UserMetadataGroupsListInput,
) -> Result<CachedResponse<UserMetadataGroupsListResponse>> {
    let key = ApplicationCacheKey::UserMetadataGroupsList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });

    let (cache_id, response) = ss
        .cache_service
        .get_or_set_with_callback(
            key,
            |val| ApplicationCacheValue::UserMetadataGroupsList(val),
            || async {
                let preferences = user_by_id(user_id, ss).await?.preferences;
                let page: u64 = input
                    .search
                    .clone()
                    .and_then(|f| f.page)
                    .unwrap_or(1)
                    .try_into()
                    .unwrap();
                let alias = "parts";
                let metadata_group_parts_col = Expr::col(Alias::new(alias));
                let (order_by, sort_order) = match input.sort {
                    None => (metadata_group_parts_col, Order::Desc),
                    Some(ord) => (
                        match ord.by {
                            PersonAndMetadataGroupsSortBy::Random => Expr::expr(Func::random()),
                            PersonAndMetadataGroupsSortBy::AssociatedEntityCount => {
                                metadata_group_parts_col
                            }
                            PersonAndMetadataGroupsSortBy::Name => {
                                Expr::col(metadata_group::Column::Title)
                            }
                        },
                        graphql_to_db_order(ord.order),
                    ),
                };
                let take = input
                    .search
                    .clone()
                    .and_then(|s| s.take)
                    .unwrap_or(preferences.general.list_page_size);
                let paginator = MetadataGroup::find()
                    .select_only()
                    .column(metadata_group::Column::Id)
                    .group_by(metadata_group::Column::Id)
                    .inner_join(UserToEntity)
                    .filter(user_to_entity::Column::UserId.eq(user_id))
                    .filter(metadata_group::Column::Id.is_not_null())
                    .apply_if(input.search.and_then(|f| f.query), |query, v| {
                        query.filter(
                            Condition::all()
                                .add(Expr::col(metadata_group::Column::Title).ilike(ilike_sql(&v))),
                        )
                    })
                    .apply_if(
                        input.filter.clone().and_then(|f| f.collections),
                        |query, v| {
                            apply_collection_filter(
                                metadata_group::Column::Id,
                                query,
                                collection_to_entity::Column::MetadataGroupId,
                                v,
                            )
                        },
                    )
                    .order_by(order_by, sort_order)
                    .into_tuple::<String>()
                    .paginate(&ss.db, take);
                let ItemsAndPagesNumber {
                    number_of_items,
                    number_of_pages,
                } = paginator.num_items_and_pages().await?;
                let mut items = vec![];
                for c in paginator.fetch_page(page - 1).await? {
                    items.push(c);
                }
                let response = SearchResults {
                    items,
                    details: SearchDetails {
                        total: number_of_items.try_into().unwrap(),
                        next_page: (page < number_of_pages).then(|| (page + 1).try_into().unwrap()),
                    },
                };
                Ok(response)
            },
        )
        .await?;

    Ok(CachedResponse { cache_id, response })
}

pub async fn user_people_list(
    user_id: &String,
    input: UserPeopleListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserPeopleListResponse>> {
    let key = ApplicationCacheKey::UserPeopleList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.clone(),
    });

    let (cache_id, response) = ss
        .cache_service
        .get_or_set_with_callback(
            key,
            |val| ApplicationCacheValue::UserPeopleList(val),
            || async {
                let preferences = user_by_id(user_id, ss).await?.preferences;
                let page: u64 = input
                    .search
                    .clone()
                    .and_then(|f| f.page)
                    .unwrap_or(1)
                    .try_into()
                    .unwrap();
                let (order_by, sort_order) = match input.sort {
                    None => (
                        Expr::col(person::Column::AssociatedEntityCount),
                        Order::Desc,
                    ),
                    Some(ord) => (
                        match ord.by {
                            PersonAndMetadataGroupsSortBy::Random => Expr::expr(Func::random()),
                            PersonAndMetadataGroupsSortBy::Name => Expr::col(person::Column::Name),
                            PersonAndMetadataGroupsSortBy::AssociatedEntityCount => {
                                Expr::col(person::Column::AssociatedEntityCount)
                            }
                        },
                        graphql_to_db_order(ord.order),
                    ),
                };
                let take = input
                    .search
                    .clone()
                    .and_then(|s| s.take)
                    .unwrap_or(preferences.general.list_page_size);
                let creators_paginator = Person::find()
                    .apply_if(input.search.clone().and_then(|s| s.query), |query, v| {
                        query.filter(
                            Condition::all()
                                .add(Expr::col(person::Column::Name).ilike(ilike_sql(&v))),
                        )
                    })
                    .apply_if(
                        input.filter.clone().and_then(|f| f.collections),
                        |query, v| {
                            apply_collection_filter(
                                person::Column::Id,
                                query,
                                collection_to_entity::Column::PersonId,
                                v,
                            )
                        },
                    )
                    .filter(user_to_entity::Column::UserId.eq(user_id))
                    .left_join(MetadataToPerson)
                    .inner_join(UserToEntity)
                    .group_by(person::Column::Id)
                    .group_by(person::Column::Name)
                    .order_by(order_by, sort_order)
                    .into_tuple::<String>()
                    .paginate(&ss.db, take);
                let ItemsAndPagesNumber {
                    number_of_items,
                    number_of_pages,
                } = creators_paginator.num_items_and_pages().await?;
                let mut items = vec![];
                for cr in creators_paginator.fetch_page(page - 1).await? {
                    items.push(cr);
                }
                let response = SearchResults {
                    items,
                    details: SearchDetails {
                        total: number_of_items.try_into().unwrap(),
                        next_page: (page < number_of_pages).then(|| (page + 1).try_into().unwrap()),
                    },
                };
                Ok(response)
            },
        )
        .await?;

    Ok(CachedResponse { cache_id, response })
}

pub async fn user_workouts_list(
    user_id: &String,
    input: UserTemplatesOrWorkoutsListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserWorkoutsListResponse>> {
    let key = ApplicationCacheKey::UserWorkoutsList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });

    let (cache_id, response) = ss
        .cache_service
        .get_or_set_with_callback(
            key,
            |val| ApplicationCacheValue::UserWorkoutsList(val),
            || async {
                let preferences = user_by_id(user_id, ss).await?.preferences;
                let page = input.search.page.unwrap_or(1);
                let take = input
                    .search
                    .take
                    .unwrap_or(preferences.general.list_page_size);
                let paginator = Workout::find()
                    .select_only()
                    .column(workout::Column::Id)
                    .filter(workout::Column::UserId.eq(user_id))
                    .apply_if(input.search.query, |query, v| {
                        query.filter(Expr::col(workout::Column::Name).ilike(ilike_sql(&v)))
                    })
                    .apply_if(input.sort, |query, v| {
                        query.order_by(
                            match v.by {
                                UserTemplatesOrWorkoutsListSortBy::Random => {
                                    Expr::expr(Func::random())
                                }
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
                let items = paginator.fetch_page((page - 1).try_into().unwrap()).await?;
                let response = SearchResults {
                    items,
                    details: SearchDetails {
                        total: number_of_items.try_into().unwrap(),
                        next_page: (page < number_of_pages.try_into().unwrap()).then(|| page + 1),
                    },
                };
                Ok(response)
            },
        )
        .await?;

    Ok(CachedResponse { cache_id, response })
}

pub async fn user_workout_templates_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: UserTemplatesOrWorkoutsListInput,
) -> Result<CachedResponse<UserWorkoutsTemplatesListResponse>> {
    let key = ApplicationCacheKey::UserWorkoutTemplatesList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });

    let (cache_id, response) = ss
        .cache_service
        .get_or_set_with_callback(
            key,
            |val| ApplicationCacheValue::UserWorkoutTemplatesList(val),
            || async {
                let preferences = user_by_id(user_id, ss).await?.preferences;
                let page = input.search.page.unwrap_or(1);
                let take = input
                    .search
                    .take
                    .unwrap_or(preferences.general.list_page_size);
                let paginator = WorkoutTemplate::find()
                    .select_only()
                    .column(workout_template::Column::Id)
                    .filter(workout_template::Column::UserId.eq(user_id))
                    .apply_if(input.search.query, |query, v| {
                        query.filter(Expr::col(workout_template::Column::Name).ilike(ilike_sql(&v)))
                    })
                    .apply_if(input.sort, |query, v| {
                        query.order_by(
                            match v.by {
                                UserTemplatesOrWorkoutsListSortBy::Random => {
                                    Expr::expr(Func::random())
                                }
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
                let items = paginator.fetch_page((page - 1).try_into().unwrap()).await?;
                let response = SearchResults {
                    items,
                    details: SearchDetails {
                        total: number_of_items.try_into().unwrap(),
                        next_page: (page < number_of_pages.try_into().unwrap()).then(|| page + 1),
                    },
                };
                Ok(response)
            },
        )
        .await?;

    Ok(CachedResponse { cache_id, response })
}

pub async fn user_exercises_list(
    user_id: &String,
    input: UserExercisesListInput,
    ss: &Arc<SupportingService>,
) -> Result<CachedResponse<UserExercisesListResponse>> {
    let key = ApplicationCacheKey::UserExercisesList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });

    let (cache_id, response) = ss
        .cache_service
        .get_or_set_with_callback(
            key,
            |val| ApplicationCacheValue::UserExercisesList(val),
            || async {
                let preferences = user_by_id(user_id, ss).await?.preferences;
                let user_id = user_id.to_owned();
                let take = input
                    .search
                    .take
                    .unwrap_or(preferences.general.list_page_size);
                let page = input.search.page.unwrap_or(1);
                let ex = Alias::new("exercise");
                let etu = Alias::new("user_to_entity");
                let order_by_col = match input.sort_by {
                    None => Expr::col((ex, exercise::Column::Id)),
                    Some(sb) => match sb {
                        // DEV: This is just a small hack to reduce duplicated code. We
                        // are ordering by name for the other `sort_by` anyway.
                        ExerciseSortBy::Name => Expr::val("1"),
                        ExerciseSortBy::Random => Expr::expr(Func::random()),
                        ExerciseSortBy::TimesPerformed => Expr::expr(Func::coalesce([
                            Expr::col((
                                etu.clone(),
                                user_to_entity::Column::ExerciseNumTimesInteracted,
                            ))
                            .into(),
                            Expr::val(0).into(),
                        ])),
                        ExerciseSortBy::LastPerformed => Expr::expr(Func::coalesce([
                            Expr::col((etu.clone(), user_to_entity::Column::LastUpdatedOn)).into(),
                            // DEV: For some reason this does not work without explicit casting on postgres
                            Func::cast_as(Expr::val("1900-01-01"), Alias::new("timestamptz"))
                                .into(),
                        ])),
                    },
                };
                let paginator = Exercise::find()
                    .select_only()
                    .column(exercise::Column::Id)
                    .filter(
                        exercise::Column::Source
                            .eq(ExerciseSource::Github)
                            .or(exercise::Column::CreatedByUserId.eq(&user_id)),
                    )
                    .apply_if(input.filter, |query, q| {
                        query
                            .apply_if(q.lot, |q, v| q.filter(exercise::Column::Lot.eq(v)))
                            .apply_if(q.muscle, |q, v| {
                                q.filter(
                                    Expr::val(v)
                                        .eq(PgFunc::any(Expr::col(exercise::Column::Muscles))),
                                )
                            })
                            .apply_if(q.level, |q, v| q.filter(exercise::Column::Level.eq(v)))
                            .apply_if(q.force, |q, v| q.filter(exercise::Column::Force.eq(v)))
                            .apply_if(q.mechanic, |q, v| {
                                q.filter(exercise::Column::Mechanic.eq(v))
                            })
                            .apply_if(q.equipment, |q, v| {
                                q.filter(exercise::Column::Equipment.eq(v))
                            })
                            .apply_if(q.collection, |q, v| {
                                q.left_join(CollectionToEntity)
                                    .filter(collection_to_entity::Column::CollectionId.eq(v))
                            })
                    })
                    .apply_if(input.search.query, |query, v| {
                        query.filter(
                            Condition::any()
                                .add(
                                    Expr::col((AliasedExercise::Table, AliasedExercise::Id))
                                        .ilike(ilike_sql(&v)),
                                )
                                .add(Expr::col(exercise::Column::Name).ilike(slugify(v))),
                        )
                    })
                    .join(
                        JoinType::LeftJoin,
                        user_to_entity::Relation::Exercise.def().rev().on_condition(
                            move |_left, right| {
                                Condition::all().add(
                                    Expr::col((right, user_to_entity::Column::UserId)).eq(&user_id),
                                )
                            },
                        ),
                    )
                    .order_by_desc(order_by_col)
                    .order_by_asc(exercise::Column::Id)
                    .into_tuple::<String>()
                    .paginate(&ss.db, take);
                let ItemsAndPagesNumber {
                    number_of_items,
                    number_of_pages,
                } = paginator.num_items_and_pages().await?;
                let mut items = vec![];
                for ex in paginator.fetch_page((page - 1).try_into().unwrap()).await? {
                    items.push(ex);
                }
                let response = SearchResults {
                    items,
                    details: SearchDetails {
                        total: number_of_items.try_into().unwrap(),
                        next_page: (page < number_of_pages.try_into().unwrap()).then(|| page + 1),
                    },
                };
                Ok(response)
            },
        )
        .await?;

    Ok(CachedResponse { cache_id, response })
}

pub async fn user_measurements_list(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: UserMeasurementsListInput,
) -> Result<CachedResponse<UserMeasurementsListResponse>> {
    let key = ApplicationCacheKey::UserMeasurementsList(UserLevelCacheKey {
        input: input.clone(),
        user_id: user_id.to_owned(),
    });

    let (cache_id, response) = ss
        .cache_service
        .get_or_set_with_callback(
            key,
            |val| ApplicationCacheValue::UserMeasurementsList(val),
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
        .await?;

    Ok(CachedResponse { cache_id, response })
}
