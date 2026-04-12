"""
Job Fetcher – pulls job listings from JSearch API,
generates embeddings, stores vectors in Qdrant
and metadata in MongoDB.

Each run flushes all old jobs and fetches fresh ones,
capped at MAX_JOBS (250).
"""

import os
import requests
from database import get_db
from utils.embedding import generate_embedding
from utils.qdrant_store import upsert_job_vector, flush_all_jobs
from utils.nlp import get_skill_extractor

JSEARCH_URL = "https://jsearch.p.rapidapi.com/search"

COLLECTION = "jobs"
MAX_JOBS = 250


def _collection():
    return get_db()[COLLECTION]


def fetch_jobs(country="in"):
    jsearch_api_key = os.getenv("JSEARCH_API_KEY")

    if not jsearch_api_key:
        raise RuntimeError("JSEARCH_API_KEY missing")

    col = _collection()
    skill_extractor = get_skill_extractor()

    # ── Flush old data from both stores ──────────────────────────────────
    col.delete_many({})              # clear MongoDB jobs collection
    print("Flushed MongoDB 'jobs' collection")
    flush_all_jobs()                 # clear Qdrant jobs collection

    FRESHER_QUERIES = [
        "software engineer fresher",
        "junior software engineer",
        "entry level software engineer",
        "graduate software engineer",
        "associate software engineer",
    ]

    processed_job_ids = set()
    stored_count = 0

    headers = {
        "X-RapidAPI-Key": jsearch_api_key,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
    }

    for query in FRESHER_QUERIES:

        if stored_count >= MAX_JOBS:
            break

        for page in range(1, 6):

            if stored_count >= MAX_JOBS:
                break

            params = {
                "query": query,
                "page": str(page),
                "num_pages": "1",
                "country": country,
                "date_posted": "month",
            }

            response = requests.get(
                JSEARCH_URL,
                headers=headers,
                params=params,
                timeout=60,
            )

            if response.status_code != 200:
                print(response.text)
                continue

            jobs = response.json().get("data", [])

            if not jobs:
                continue

            for job in jobs:

                if stored_count >= MAX_JOBS:
                    break

                job_id = job.get("job_id")

                if not job_id:
                    continue

                # Dedup within this run
                if job_id in processed_job_ids:
                    continue

                processed_job_ids.add(job_id)

                description = job.get(
                    "job_description", ""
                )

                job_skills_set = set()
                if skill_extractor and description:
                    try:
                        annotations = skill_extractor.annotate(description)
                        full_matches = annotations.get("results", {}).get("full_matches", [])
                        ngram_matches = annotations.get("results", {}).get("ngram_scored", [])
                        job_skills_set = set(
                            [s["doc_node_value"] for s in full_matches] +
                            [s["doc_node_value"] for s in ngram_matches]
                        )
                    except Exception as e:
                        print(f"Error extracting skills for job {job_id}: {e}")

                # -------- MongoDB ----------
                col.insert_one({
                    "job_id": job_id,
                    "title": job.get("job_title"),
                    "company": job.get("employer_name"),
                    "location": job.get("job_city"),
                    "country": job.get("job_country"),
                    "description": description,
                    "apply_link": job.get(
                        "job_apply_link"
                    ),
                    "employment_type":
                        job.get("job_employment_type"),
                    "posted_at":
                        job.get(
                            "job_posted_at_datetime_utc"
                        ),
                    "skills": list(job_skills_set),
                })

                # -------- Qdrant ----------
                if description:
                    embedding = generate_embedding(
                        description
                    )

                    upsert_job_vector(
                        job_id,
                        embedding,
                        title=job.get("job_title"),
                    )

                stored_count += 1

    print(f"Job fetch complete - {stored_count} jobs stored (max {MAX_JOBS})")
