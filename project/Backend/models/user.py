"""
User model – stores Clerk user details in MongoDB.

Schema (users collection):
─────────────────────────────────────────────────────────
Field               Type        Description
─────────────────────────────────────────────────────────
clerk_id            str         Clerk subject ID (unique)
email               str         Primary email address
first_name          str | None  User's first name
last_name           str | None  User's last name
profile_image_url   str | None  Avatar / profile picture URL
phone               str | None  Phone number
location            str | None  Location (city, state, etc.)
job_title           str | None  Current job title
bio                 str | None  Short biography
resume_url          str | None  Cloudinary URL of uploaded resume
resume_public_id    str | None  Cloudinary public ID (for deletion)
skills              list[str]   Skills extracted from resume
role                str         User role (default: "user")
created_at          datetime    When the record was created
updated_at          datetime    When the record was last updated
─────────────────────────────────────────────────────────
"""

from datetime import datetime, timezone

from pymongo import ReturnDocument

from database import get_db


COLLECTION = "users"


def _collection():
    return get_db()[COLLECTION]


def _serialize(doc: dict | None) -> dict | None:
    """Convert ObjectId to string for JSON serialization."""
    if doc is None:
        return None
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    # Ensure datetimes are ISO strings for JSON
    for key in ("created_at", "updated_at"):
        if key in doc and isinstance(doc[key], datetime):
            doc[key] = doc[key].isoformat()
    return doc


def ensure_indexes():
    """Create indexes on first startup."""
    col = _collection()
    col.create_index("clerk_id", unique=True)
    col.create_index("email", unique=True)


# ── CRUD helpers ─────────────────────────────────────────────────────────────

def upsert_user(
    clerk_id: str,
    email: str,
    first_name: str | None = None,
    last_name: str | None = None,
    profile_image_url: str | None = None,
) -> dict:
    """Create or update a user document.

    Called every time an authenticated request arrives so the local DB
    stays in sync with Clerk.
    """
    now = datetime.now(timezone.utc)

    result = _collection().find_one_and_update(
        {"clerk_id": clerk_id},
        {
            "$set": {
                "email": email,
                "first_name": first_name,
                "last_name": last_name,
                "profile_image_url": profile_image_url,
                "updated_at": now,
            },
            "$setOnInsert": {
                "clerk_id": clerk_id,
                "role": "user",
                "created_at": now,
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )

    return _serialize(result)


def update_user_profile(clerk_id: str, **fields) -> dict | None:
    """Update editable profile fields for a user.

    Accepted keyword arguments:
        first_name, last_name, email, phone, location, job_title, bio
    """
    allowed = {"first_name", "last_name", "email", "phone", "location",
               "job_title", "bio"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}

    if not updates:
        # Nothing to change – just return the current document
        return get_user_by_clerk_id(clerk_id)

    updates["updated_at"] = datetime.now(timezone.utc)

    result = _collection().find_one_and_update(
        {"clerk_id": clerk_id},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )

    return _serialize(result)


def get_user_by_clerk_id(clerk_id: str) -> dict | None:
    """Fetch a user document by Clerk subject ID."""
    user = _collection().find_one({"clerk_id": clerk_id})
    return _serialize(user)


def get_user_by_email(email: str) -> dict | None:
    """Fetch a user document by email address."""
    user = _collection().find_one({"email": email})
    return _serialize(user)


def update_user_resume(
    clerk_id: str,
    resume_url: str,
    resume_public_id: str,
    skills: list[str],
) -> dict | None:
    """Store the Cloudinary resume URL and extracted skills for a user."""
    update_fields = {
        "resume_url": resume_url,
        "resume_public_id": resume_public_id,
        "skills": skills,
        "updated_at": datetime.now(timezone.utc),
    }

    result = _collection().find_one_and_update(
        {"clerk_id": clerk_id},
        {"$set": update_fields},
        return_document=ReturnDocument.AFTER,
    )
    return _serialize(result)


def update_user_skills(clerk_id: str, skills: list[str]) -> dict | None:
    """Update only the skills array for a user."""
    result = _collection().find_one_and_update(
        {"clerk_id": clerk_id},
        {"$set": {"skills": skills, "updated_at": datetime.now(timezone.utc)}},
        return_document=ReturnDocument.AFTER,
    )
    return _serialize(result)


def get_user_resume_public_id(clerk_id: str) -> str | None:
    """Return the Cloudinary public_id of the user's current resume (if any)."""
    user = _collection().find_one({"clerk_id": clerk_id}, {"resume_public_id": 1})
    return user.get("resume_public_id") if user else None
