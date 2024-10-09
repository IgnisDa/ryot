use anyhow::{bail, Result};
use database_models::metadata;
use database_utils::ilike_sql;
use enums::{MediaLot, MediaSource};
use sea_orm::{ColumnTrait, Condition, DatabaseConnection, EntityTrait, QueryFilter};
use sea_query::{extension::postgres::PgExpr, Alias, Expr, Func};

pub async fn get_show_by_episode_identifier(
    db: &DatabaseConnection,
    series: &str,
    episode: &str,
) -> Result<metadata::Model> {
    let db_show = metadata::Entity::find()
        .filter(metadata::Column::Lot.eq(MediaLot::Show))
        .filter(metadata::Column::Source.eq(MediaSource::Tmdb))
        .filter(
            Condition::all()
                .add(
                    Expr::expr(Func::cast_as(
                        Expr::col(metadata::Column::ShowSpecifics),
                        Alias::new("text"),
                    ))
                    .ilike(ilike_sql(episode)),
                )
                .add(Expr::col(metadata::Column::Title).ilike(ilike_sql(series))),
        )
        .one(db)
        .await?;
    match db_show {
        Some(show) => Ok(show),
        None => bail!(
            "No show found with Series {:#?} and Episode {:#?}",
            series,
            episode
        ),
    }
}
