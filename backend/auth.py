"""Authentication module for LLM Council."""

import ipaddress
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

from .config import (
    ALLOWED_IPS,
    ALLOWED_NETWORKS,
    JWT_ALGORITHM,
    JWT_EXPIRE_HOURS,
    JWT_SECRET,
    LEADS_MODE,
    MONGODB_DB_NAME,
    MONGODB_URL,
    BASE_SYSTEM_PROMPT,
)

logger = logging.getLogger("llm-council.auth")

security = HTTPBearer(auto_error=False)

_mongo_client: Optional[AsyncIOMotorClient] = None


class User(BaseModel):
    """Authenticated user model."""

    user_id: str
    username: str
    email: str
    roles: list[str]
    is_bypassed: bool = False
    personal_prompt: str = ""
    personal_prompt_template_id: str = "default"
    base_system_prompt: str = ""
    base_system_prompt_id: str = "arteus"


class TokenData(BaseModel):
    """JWT token payload."""

    user_id: str
    username: str
    email: str
    roles: list[str]


class LeadUser(BaseModel):
    """Lead user model for leads mode."""

    session_id: str
    email: Optional[str] = None
    telegram: Optional[str] = None
    is_lead: bool = True


class LeadTokenData(BaseModel):
    """JWT token payload for leads."""

    session_id: str
    email: Optional[str] = None
    telegram: Optional[str] = None
    token_type: str = "lead"


def get_mongo_client() -> AsyncIOMotorClient:
    """Get or create MongoDB client singleton."""
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = AsyncIOMotorClient(MONGODB_URL)
    return _mongo_client


def get_database():
    """Get the MongoDB database instance."""
    return get_mongo_client()[MONGODB_DB_NAME]


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain password against the stored hash."""
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8")
        )
    except Exception as e:
        logger.error(f"Password verification error: {e}")
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create a JWT access token."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(hours=JWT_EXPIRE_HOURS)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[TokenData]:
    """Decode and validate a JWT access token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return TokenData(
            user_id=payload.get("user_id", ""),
            username=payload.get("username", ""),
            email=payload.get("email", ""),
            roles=payload.get("roles", []),
        )
    except JWTError as e:
        logger.warning(f"JWT decode error: {e}")
        return None


def _parse_network(network_str: str) -> Optional[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    """Parse a network string into an IP network object."""
    try:
        return ipaddress.ip_network(network_str, strict=False)
    except ValueError:
        logger.warning(f"Invalid network: {network_str}")
        return None


def is_ip_allowed(client_ip: str) -> bool:
    """Check if the client IP is in the allowed list or networks."""
    if not client_ip:
        return False

    if client_ip in ALLOWED_IPS:
        return True

    try:
        ip_addr = ipaddress.ip_address(client_ip)
        for network_str in ALLOWED_NETWORKS:
            network = _parse_network(network_str)
            if network and ip_addr in network:
                return True
    except ValueError:
        logger.warning(f"Invalid client IP: {client_ip}")

    return False


def get_client_ip(request: Request) -> str:
    """Extract client IP from request, considering proxy headers."""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()

    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()

    if request.client:
        return request.client.host

    return ""


async def authenticate_user(identifier: str, password: str) -> Optional[dict]:
    """
    Authenticate a user against MongoDB.
    
    Args:
        identifier: Email or Telegram username
        password: User password
        
    Returns:
        User document or None if authentication fails
    """
    try:
        db = get_database()
        operators = db["operators"]

        user = await operators.find_one({
            "$or": [
                {"email": identifier},
                {"telegram": identifier}
            ],
            "is_deleted": {"$ne": True}
        })

        if user is None:
            logger.info(f"User not found: {identifier}")
            return None

        hashed = user.get("_password", "")
        if not verify_password(password, hashed):
            logger.info(f"Invalid password for: {identifier}")
            return None

        logger.info(f"User authenticated: {identifier}")
        return user
    except Exception as e:
        logger.error(f"MongoDB error during authentication: {e}")
        raise


async def get_user_council_settings(user_id: str) -> dict:
    """Get user's council settings (personal prompt and base system prompt) from MongoDB."""
    try:
        db = get_database()
        settings = db["council_settings"]

        doc = await settings.find_one({"user_id": user_id})
        if doc is None:
            return {
                "personal_prompt": "",
                "template_id": "default",
                "base_system_prompt": BASE_SYSTEM_PROMPT,
                "base_system_prompt_id": "arteus",
            }

        return {
            "personal_prompt": doc.get("personal_prompt", ""),
            "template_id": doc.get("template_id", "default"),
            "base_system_prompt": doc.get("base_system_prompt") or (BASE_SYSTEM_PROMPT if doc.get("base_system_prompt_id") == "arteus" else ""),
            "base_system_prompt_id": doc.get("base_system_prompt_id", "arteus"),
        }
    except Exception as e:
        logger.error(f"MongoDB error getting council settings: {e}")
        return {
            "personal_prompt": "",
            "template_id": "default",
            "base_system_prompt": "",
            "base_system_prompt_id": "arteus",
        }


async def set_user_council_settings(
    user_id: str,
    personal_prompt: str,
    template_id: str = "custom",
    base_system_prompt: str = "",
    base_system_prompt_id: str = "custom",
) -> dict:
    """Set user's council settings in MongoDB."""
    try:
        db = get_database()
        settings = db["council_settings"]

        await settings.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "personal_prompt": personal_prompt,
                    "template_id": template_id,
                    "base_system_prompt": base_system_prompt,
                    "base_system_prompt_id": base_system_prompt_id,
                }
            },
            upsert=True,
        )

        return {
            "personal_prompt": personal_prompt,
            "template_id": template_id,
            "base_system_prompt": base_system_prompt,
            "base_system_prompt_id": base_system_prompt_id,
        }
    except Exception as e:
        logger.error(f"MongoDB error setting council settings: {e}")
        raise


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> User:
    """FastAPI dependency to get the current authenticated user."""
    client_ip = get_client_ip(request)

    if is_ip_allowed(client_ip):
        logger.info(f"IP bypass for {client_ip}")
        return User(
            user_id="bypassed",
            username="bypassed",
            email="bypassed@local",
            roles=["admin"],
            is_bypassed=True,
        )

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token_data = decode_access_token(credentials.credentials)
    if token_data is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return User(
        user_id=token_data.user_id,
        username=token_data.username,
        email=token_data.email,
        roles=token_data.roles,
    )


async def get_current_user_optional(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[User]:
    """FastAPI dependency to get the current user if authenticated, or None."""
    client_ip = get_client_ip(request)

    if is_ip_allowed(client_ip):
        return User(
            user_id="bypassed",
            username="bypassed",
            email="bypassed@local",
            roles=["admin"],
            is_bypassed=True,
        )

    if credentials is None:
        return None

    token_data = decode_access_token(credentials.credentials)
    if token_data is None:
        return None

    return User(
        user_id=token_data.user_id,
        username=token_data.username,
        email=token_data.email,
        roles=token_data.roles,
    )


# Leads mode authentication functions

def create_leads_token(session_id: str, email: Optional[str], telegram: Optional[str]) -> str:
    """Create a JWT access token for a lead user."""
    data = {
        "session_id": session_id,
        "email": email,
        "telegram": telegram,
        "token_type": "lead",
    }
    return create_access_token(data)


def decode_leads_token(token: str) -> Optional[LeadTokenData]:
    """Decode and validate a leads JWT access token."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("token_type") != "lead":
            return None
        return LeadTokenData(
            session_id=payload.get("session_id", ""),
            email=payload.get("email"),
            telegram=payload.get("telegram"),
            token_type="lead",
        )
    except JWTError as e:
        logger.warning(f"Leads JWT decode error: {e}")
        return None


async def get_current_lead(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> LeadUser:
    """FastAPI dependency to get the current lead user (leads mode only)."""
    if not LEADS_MODE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Leads mode is not enabled",
        )

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token_data = decode_leads_token(credentials.credentials)
    if token_data is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return LeadUser(
        session_id=token_data.session_id,
        email=token_data.email,
        telegram=token_data.telegram,
    )


async def get_current_lead_optional(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[LeadUser]:
    """FastAPI dependency to get the current lead if authenticated, or None."""
    if not LEADS_MODE:
        return None

    if credentials is None:
        return None

    token_data = decode_leads_token(credentials.credentials)
    if token_data is None:
        return None

    return LeadUser(
        session_id=token_data.session_id,
        email=token_data.email,
        telegram=token_data.telegram,
    )
