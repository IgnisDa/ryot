use anyhow::Result;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use serde_with::skip_serializing_none;
use uuid::Uuid;

#[skip_serializing_none]
#[derive(Debug, Deserialize, Serialize)]
pub struct Claims {
    pub jti: Uuid,
    pub exp: usize,
    pub iat: usize,
    pub sub: String,
    pub access_link_id: Option<String>,
}

impl Claims {
    pub fn new(sub: String, token_valid_for_days: i32, access_link_id: Option<String>) -> Self {
        let iat = Utc::now();
        let exp = iat + Duration::try_days(token_valid_for_days.into()).unwrap();

        Self {
            sub,
            access_link_id,
            jti: Uuid::new_v4(),
            iat: iat.timestamp().try_into().unwrap(),
            exp: exp.timestamp().try_into().unwrap(),
        }
    }
}

pub fn sign(
    user_id: String,
    jwt_secret: &str,
    token_valid_for_days: i32,
    access_link_id: Option<String>,
) -> Result<String> {
    let tokens = encode(
        &Header::default(),
        &Claims::new(user_id, token_valid_for_days, access_link_id),
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )?;
    Ok(tokens)
}

pub fn verify(token: &str, jwt_secret: &str) -> Result<Claims> {
    let claims = decode(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)?;
    Ok(claims)
}
