import os
import uuid
import json
import re
from datetime import datetime, timezone
import requests
from urllib.parse import unquote
from utils.nlp import get_skill_extractor
# pyrefly: ignore [missing-import]
from flask import Flask, jsonify, g, request
from flask_cors import CORS
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv
from utils.tts_service import generate_speech_bytes
from utils.stt_service import transcribe_audio
# pyrefly: ignore [missing-import]
from flask import Response
from utils.scheduler import start_scheduler
# pyrefly: ignore [missing-import]
import cloudinary
from database import get_db
# pyrefly: ignore [missing-import]
from bson.objectid import ObjectId
# pyrefly: ignore [missing-import]
from bson.errors import InvalidId
# pyrefly: ignore [missing-import]
import cloudinary.uploader
# pyrefly: ignore [missing-import]
from pdfminer.high_level import extract_text
from auth import require_auth
from models.user import (
    upsert_user,
    get_user_by_clerk_id,
    update_user_profile,
    ensure_indexes,
    update_user_resume,
    get_user_resume_public_id,
    update_user_skills,
)
from utils.embedding import generate_embedding
from utils.qdrant_store import (
    upsert_resume_vector,
    ensure_collections,
    get_resume_embedding,
    search_similar_jobs,
)

load_dotenv()

app = Flask(__name__)

# CORS
# cors_origins = os.getenv("CORS_ORIGINS", "https://skillsbridge-tawny.vercel.app").split(",")
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")

CORS(app, origins=cors_origins, supports_credentials=True)

# ── Resume uploads folder ────────────────────────────────────────────────────
UPLOAD_FOLDER = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "resumes"
)
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 5 * 1024 * 1024  # 5 MB max upload size
ALLOWED_EXTENSIONS = {".pdf"}

# ── Cloudinary config ────────────────────────────────────────────────────────
cloudinary.config(
    cloud_name=os.getenv("CLOUDINARY_CLOUD_NAME"),
    api_key=os.getenv("CLOUDINARY_API_KEY"),
    api_secret=os.getenv("CLOUDINARY_API_SECRET"),
    secure=True,
)

# SkillNer is lazy-loaded on first use
_skill_extractor = None


def _serialize_interview(doc):
    if not doc:
        return None
    serialized = dict(doc)
    if "_id" in serialized:
        serialized["_id"] = str(serialized["_id"])
    for key in ("created_at", "updated_at"):
        if isinstance(serialized.get(key), datetime):
            serialized[key] = serialized[key].isoformat()
    return serialized


def _safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _resolve_job_title(job_id):
    if not isinstance(job_id, str) or not job_id.strip():
        return ""

    raw_id = job_id.strip()
    decoded_id = unquote(raw_id)
    candidates = [raw_id]
    if decoded_id and decoded_id != raw_id:
        candidates.append(decoded_id)

    jobs_col = get_db()["jobs"]
    job_doc = jobs_col.find_one(
        {"job_id": {"$in": candidates}},
        {"title": 1},
    )
    return (job_doc or {}).get("title") or ""


def _ensure_interview_job_title(doc, interviews_col=None):
    if not doc:
        return doc

    current_title = (doc.get("job_title") or "").strip()
    if current_title:
        return doc

    resolved_title = _resolve_job_title(doc.get("job_id") or "")
    if not resolved_title:
        return doc

    doc["job_title"] = resolved_title

    if interviews_col is not None and doc.get("_id"):
        interviews_col.update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "job_title": resolved_title,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )

    return doc


def get_extractor():
    global _skill_extractor
    if _skill_extractor is None:
        _skill_extractor = get_skill_extractor()
    return _skill_extractor


# Create MongoDB indexes and Qdrant collections on startup
with app.app_context():
    try:
        ensure_indexes()
    except Exception:
        pass
    try:
        ensure_collections()
    except Exception:
        pass
    try:
        interviews_col = get_db()["interviews"]
        interviews_col.create_index([("clerk_id", 1), ("created_at", -1)])
        interviews_col.create_index("job_id")
    except Exception:
        pass

# Start background job-fetch scheduler
# start_scheduler()


@app.route("/", methods=["GET"])
def hello_world():
    return "hello from omkar ghodekar"


@app.route("/api/jobs", methods=["GET"])
@require_auth
def get_matched_jobs():
    """Return top 10 jobs matched to the user's resume embedding.
    If the user hasn't uploaded a resume yet, return has_resume=false."""
    clerk_id = g.user.get("sub")
    user = get_user_by_clerk_id(clerk_id)

    try:
        page = int(request.args.get("page", 1))
        limit = int(request.args.get("limit", 10))
    except ValueError:
        page = 1
        limit = 10

    offset = (page - 1) * limit

    if not user or not user.get("resume_url"):
        return jsonify(
            {"has_resume": False, "jobs": [], "page": page, "has_more": False}
        )

    # Retrieve the resume embedding from Qdrant
    embedding = get_resume_embedding(clerk_id)
    if not embedding:
        return jsonify(
            {"has_resume": True, "jobs": [], "page": page, "has_more": False}
        )

    # Find similar jobs in Qdrant.
    # Fetch up to (offset + limit + 1) from the top, then slice the page.
    # This avoids Qdrant's offset capping issue where it silently returns fewer results.
    fetch_count = offset + limit + 1
    all_matches = search_similar_jobs(embedding, limit=fetch_count)

    page_matches = all_matches[offset : offset + limit]
    has_more = len(all_matches) > offset + limit
    matches = page_matches

    jobs_col = get_db()["jobs"]

    results = []

    # User's current skills to compute missing skills
    user_skills_set = set(user.get("skills", []))

    for match in matches:
        job_id = match.payload.get("job_id")
        if not job_id:
            continue
        job_doc = jobs_col.find_one({"job_id": job_id})
        if not job_doc:
            continue

        full_desc = job_doc.get("description", "")

        # Calculate missing skills
        missing_skills = []
        job_skills = job_doc.get("skills")

        if job_skills is not None:
            # New format: skills are pre-computed in MongoDB
            job_skills_set = set(job_skills)
            missing_skills = sorted(list(job_skills_set - user_skills_set))
        elif full_desc:
            # Fallback for old jobs without 'skills' field
            try:
                extractor = get_extractor()
                if extractor:
                    annotations = extractor.annotate(full_desc)
                    full_matches = annotations.get("results", {}).get(
                        "full_matches", []
                    )
                    ngram_matches = annotations.get("results", {}).get(
                        "ngram_scored", []
                    )
                    job_skills_set = set(
                        [s["doc_node_value"] for s in full_matches]
                        + [s["doc_node_value"] for s in ngram_matches]
                    )
                    missing_skills = sorted(list(job_skills_set - user_skills_set))
            except Exception:
                pass

        results.append(
            {
                "job_id": job_id,
                "title": job_doc.get("title"),
                "company": job_doc.get("company"),
                "location": job_doc.get("location"),
                "country": job_doc.get("country"),
                "description": full_desc[:300],
                "apply_link": job_doc.get("apply_link"),
                "employment_type": job_doc.get("employment_type"),
                "posted_at": job_doc.get("posted_at"),
                "match_score": round(match.score * 100, 1),
                "missing_skills": missing_skills[:7],  # Suggest up to 7 missing skills
            }
        )

    return jsonify(
        {
            "has_resume": True,
            "jobs": results,
            "page": page,
            "has_more": has_more,
        }
    )


@app.route("/api/auth/sync", methods=["POST"])
@require_auth
def sync_user():
    """Called by the frontend after sign-in.
    Checks if the user exists in MongoDB; if not, creates them."""
    claims = g.user
    body = request.get_json(silent=True) or {}

    user = upsert_user(
        clerk_id=claims.get("sub"),
        email=body.get("email", ""),
        first_name=body.get("first_name"),
        last_name=body.get("last_name"),
        profile_image_url=body.get("profile_image_url"),
    )

    return jsonify(user)


@app.route("/api/me", methods=["GET"])
@require_auth
def get_me():
    """Protected route – returns the user profile from MongoDB."""
    user = get_user_by_clerk_id(g.user.get("sub"))
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify(user)


@app.route("/api/me", methods=["PUT"])
@require_auth
def update_me():
    """Update the authenticated user's profile fields."""
    body = request.get_json(silent=True) or {}
    clerk_id = g.user.get("sub")

    user = update_user_profile(
        clerk_id,
        first_name=body.get("first_name"),
        last_name=body.get("last_name"),
        email=body.get("email"),
        phone=body.get("phone"),
        location=body.get("location"),
        job_title=body.get("job_title"),
        bio=body.get("bio"),
    )

    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify(user)


@app.route("/api/skills", methods=["PUT"])
@require_auth
def update_skills():
    """Update the authenticated user's skills list."""
    body = request.get_json(silent=True) or {}
    skills = body.get("skills")

    if not isinstance(skills, list):
        return jsonify({"error": "skills must be a list"}), 400

    # Deduplicate and clean
    skills = sorted(set(s.strip() for s in skills if isinstance(s, str) and s.strip()))

    clerk_id = g.user.get("sub")
    user = update_user_skills(clerk_id, skills)

    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify(user)


@app.route("/api/parse-resume", methods=["POST"])
@require_auth
def parse_resume():
    """Accept a PDF resume, extract skills, upload to Cloudinary, and persist."""
    skill_extractor = get_extractor()
    if skill_extractor is None:
        return jsonify(
            {
                "error": "Resume parsing is not available. Run setup_dependencies.py first."
            }
        ), 503

    if "resume" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["resume"]
    if file.filename == "":
        return jsonify({"error": "Empty filename"}), 400

    # Validate file type
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify(
            {"error": f"Invalid file type '{ext}'. Only PDF files are accepted."}
        ), 400

    clerk_id = g.user.get("sub")

    # Save temporarily for parsing
    filename = f"{uuid.uuid4()}.pdf"
    filepath = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    file.save(filepath)

    try:
        # ── Extract skills ──────────────────────────────────────────────
        text = extract_text(filepath)
        annotations = skill_extractor.annotate(text)
        full_matches = annotations["results"]["full_matches"]
        ngram_matches = annotations["results"]["ngram_scored"]
        skills = sorted(
            set(
                [s["doc_node_value"] for s in full_matches]
                + [s["doc_node_value"] for s in ngram_matches]
            )
        )

        # ── Delete old resume from Cloudinary (if any) ──────────────────
        old_public_id = get_user_resume_public_id(clerk_id)
        if old_public_id:
            try:
                cloudinary.uploader.destroy(old_public_id, resource_type="raw")
            except Exception:
                pass

        # ── Upload new resume to Cloudinary ─────────────────────────────
        upload_result = cloudinary.uploader.upload(
            filepath,
            resource_type="raw",
            folder="skillsbridge/resumes",
            public_id=filename.replace(".pdf", ""),
            format="pdf",
            access_mode="public",
            type="upload",
        )
        resume_url = upload_result["secure_url"]
        resume_public_id = upload_result["public_id"]

        # ── Save to user profile ────────────────────────────────────────
        resume_embedding = generate_embedding(text)
        update_user_resume(clerk_id, resume_url, resume_public_id, skills)

        # Store vector in Qdrant for similarity search
        upsert_resume_vector(clerk_id, resume_embedding)

        return jsonify(
            {
                "status": "success",
                "resume_url": resume_url,
                "skills": skills,
            }
        )

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

    finally:
        if os.path.exists(filepath):
            os.remove(filepath)


# ── Text-to-Speech ───────────────────────────────────────────────────────────
@app.route("/api/tts/speak", methods=["POST", "OPTIONS"])
def tts_speak():
    """POST {"text": "..."} → streams MP3 audio bytes."""
    if request.method == "OPTIONS":
        return "", 204

    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"error": "text is required"}), 400

    try:
        wav_bytes = generate_speech_bytes(text)
        return Response(
            wav_bytes,
            mimetype="audio/mpeg",
            headers={
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": "*",
            },
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Speech-to-Text (Faster-Whisper) ─────────────────────────────────────────
@app.route("/api/stt/transcribe", methods=["POST", "OPTIONS"])
def stt_transcribe():
    """POST multipart/form-data with field 'audio' → {"transcript": "..."}.
    No auth required (same pattern as /api/tts/speak)."""
    if request.method == "OPTIONS":
        return "", 204

    audio_file = request.files.get("audio")
    if not audio_file:
        return jsonify(
            {"error": "No audio file provided. Send field name 'audio'."}
        ), 400

    # Determine a sensible file extension from the MIME type so Faster-Whisper
    # (via ffmpeg) can decode it correctly.
    mime = (audio_file.mimetype or "").lower()
    if "ogg" in mime:
        suffix = ".ogg"
    elif "mp4" in mime or "m4a" in mime:
        suffix = ".mp4"
    elif "wav" in mime:
        suffix = ".wav"
    else:
        suffix = ".webm"  # Chrome / Firefox default

    try:
        audio_bytes = audio_file.read()
        print(f"[STT] Processing audio file: {len(audio_bytes)} bytes, MIME: {mime}")
        transcript = transcribe_audio(audio_bytes, suffix=suffix)
        print(f"[STT] Transcript result: '{transcript}'")
        return jsonify({"transcript": transcript})
    except Exception as e:
        print(f"[STT] Error: {str(e)}")
        return jsonify({"error": str(e)}), 500


GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
]

FREE_MODELS = [
    "openai/gpt-4.1",
    # "meta-llama/llama-3.3-70b-instruct:free",
    # "deepseek/deepseek-v2-lite-chat:free",
    # "mistralai/mistral-small-3.1-24b-instruct:free",
]


def evaluate_interview_payload(
    questions,
    answers,
    job_title="",
    user_skills=None,
):
    gemini_api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY (or GOOGLE_API_KEY) not configured")

    user_skills = user_skills or []
    qa_items = []
    for i, question in enumerate(questions):
        ans = ""
        if i < len(answers) and isinstance(answers[i], str):
            ans = answers[i]
        qa_items.append(
            {
                "question_number": i + 1,
                "question": question,
                "answer": ans,
            }
        )

    prompt = f"""You are an expert technical interviewer and strict evaluator.
Evaluate the candidate's interview answers and return ONLY valid JSON.

Context:
- Job title: {job_title or 'Unknown'}
- Candidate skills from resume: {', '.join(user_skills[:15]) if user_skills else 'Not provided'}

Interview Q&A JSON:
{json.dumps(qa_items, ensure_ascii=True)}

Scoring rules:
- Score each answer from 1 to 10.
- Consider correctness, depth, clarity, and relevance.
- Provide concise actionable feedback per question.
- Keep strengths/weaknesses concrete and non-repetitive.

Return JSON with this exact shape:
{{
  "overall_score": 0,
  "overall_rating": "Strong|Good|Needs Work",
  "summary": "string",
  "per_question": [
    {{"question": "string", "answer": "string", "score": 0, "feedback": "string"}}
  ],
  "strengths": ["string"],
  "weaknesses": ["string"],
  "upskill_topics": [
    {{"skill": "string", "reason": "string", "resources": ["string"]}}
  ]
}}

Important:
- Output ONLY JSON. No markdown or commentary.
- per_question must contain the same number of items as input questions.
"""

    last_error = None
    for model in GEMINI_MODELS:
        try:
            response = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={gemini_api_key}",
                headers={"Content-Type": "application/json"},
                json={
                    "contents": [{
                        "role": "user",
                        "parts": [{"text": prompt}],
                    }],
                    "generationConfig": {
                        "temperature": 0.2,
                        "responseMimeType": "application/json",
                    },
                },
                timeout=45,
            )

            if response.status_code in (429, 500, 503):
                try:
                    err_msg = (
                        response.json().get("error", {}).get("message")
                        or response.text
                    )
                except Exception:
                    err_msg = response.text
                last_error = f"model unavailable: {model} - {str(err_msg)[:200]}"
                continue

            if response.status_code != 200:
                last_error = response.text
                continue

            response_data = response.json()
            candidates = response_data.get("candidates") or []
            if not candidates:
                last_error = "No candidates in Gemini response"
                continue

            parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
            content = "".join(
                str(part.get("text", "")) for part in parts if isinstance(part, dict)
            ).strip()

            if not content:
                last_error = "Empty Gemini response"
                continue

            match = re.search(r"\{.*\}", content, re.S)
            if not match:
                last_error = "No JSON object in evaluation response"
                continue

            parsed = json.loads(match.group())
            per_question = parsed.get("per_question")
            if not isinstance(per_question, list) or len(per_question) != len(questions):
                last_error = "Invalid per_question shape"
                continue

            cleaned_per_question = []
            for i, item in enumerate(per_question):
                q = questions[i]
                a = answers[i] if i < len(answers) else ""
                cleaned_per_question.append(
                    {
                        "question": str(item.get("question") or q),
                        "answer": str(item.get("answer") or a),
                        "score": max(1, min(10, int(round(_safe_float(item.get("score"), 5))))),
                        "feedback": str(item.get("feedback") or ""),
                    }
                )

            overall_score = _safe_float(parsed.get("overall_score"), 0.0)
            if overall_score <= 0:
                overall_score = round(
                    sum(x["score"] for x in cleaned_per_question)
                    / max(1, len(cleaned_per_question)),
                    1,
                )

            result = {
                "overall_score": round(max(1.0, min(10.0, overall_score)), 1),
                "overall_rating": str(parsed.get("overall_rating") or "Good"),
                "summary": str(parsed.get("summary") or ""),
                "per_question": cleaned_per_question,
                "strengths": [
                    str(x) for x in (parsed.get("strengths") or []) if str(x).strip()
                ][:6],
                "weaknesses": [
                    str(x) for x in (parsed.get("weaknesses") or []) if str(x).strip()
                ][:6],
                "upskill_topics": parsed.get("upskill_topics") or [],
            }

            return result

        except Exception as e:
            last_error = str(e)
            continue

    raise RuntimeError(last_error or "Gemini evaluation failed")


@app.route("/api/evaluate-interview", methods=["POST", "OPTIONS"])
@require_auth
def evaluate_interview():
    if request.method == "OPTIONS":
        return "", 204

    body = request.get_json(silent=True) or {}
    questions = body.get("questions") or []
    answers = body.get("answers") or []
    job_title = (body.get("job_title") or "").strip()

    if not isinstance(questions, list) or not isinstance(answers, list):
        return jsonify({"error": "questions and answers must be arrays"}), 400

    questions = [q.strip() for q in questions if isinstance(q, str) and q.strip()]
    answers = [a.strip() for a in answers if isinstance(a, str)]

    if not questions:
        return jsonify({"error": "At least one question is required"}), 400

    clerk_id = g.user.get("sub")
    user = get_user_by_clerk_id(clerk_id) or {}
    user_skills = body.get("user_skills")
    if not isinstance(user_skills, list):
        user_skills = user.get("skills", [])

    try:
        evaluation = evaluate_interview_payload(
            questions=questions,
            answers=answers,
            job_title=job_title,
            user_skills=user_skills,
        )
        return jsonify(evaluation)
    except Exception as e:
        return jsonify({"error": "evaluation_failed", "message": str(e)}), 503


@app.route("/api/interviews", methods=["POST", "GET", "OPTIONS"])
@require_auth
def interviews_collection():
    if request.method == "OPTIONS":
        return "", 204

    clerk_id = g.user.get("sub")
    interviews_col = get_db()["interviews"]

    if request.method == "GET":
        try:
            limit = max(1, min(100, int(request.args.get("limit", 20))))
        except ValueError:
            limit = 20

        cursor = (
            interviews_col.find({"clerk_id": clerk_id})
            .sort("created_at", -1)
            .limit(limit)
        )

        docs = []
        for doc in cursor:
            hydrated = _ensure_interview_job_title(doc, interviews_col=interviews_col)
            docs.append(_serialize_interview(hydrated))
        return jsonify({"items": docs, "count": len(docs)})

    body = request.get_json(silent=True) or {}
    questions = body.get("questions") or []
    answers = body.get("answers") or []
    job_id = (body.get("job_id") or "").strip()
    job_title = (body.get("job_title") or "").strip()

    if not isinstance(questions, list) or not isinstance(answers, list):
        return jsonify({"error": "questions and answers must be arrays"}), 400

    cleaned_questions = [q.strip() for q in questions if isinstance(q, str) and q.strip()]
    cleaned_answers = [a.strip() for a in answers if isinstance(a, str)]

    print(f"[InterviewSubmit] clerk_id={clerk_id} job_id={job_id} total_answers={len(cleaned_answers)}")
    for i, answer in enumerate(cleaned_answers, start=1):
        print(f"[InterviewSubmit] Q{i} transcript: {answer}")

    if not cleaned_questions:
        return jsonify({"error": "questions cannot be empty"}), 400

    if not job_title and job_id:
        job_title = _resolve_job_title(job_id)

    ai_evaluation = body.get("ai_evaluation")
    if not isinstance(ai_evaluation, dict):
        user = get_user_by_clerk_id(clerk_id) or {}
        try:
            ai_evaluation = evaluate_interview_payload(
                questions=cleaned_questions,
                answers=cleaned_answers,
                job_title=job_title,
                user_skills=user.get("skills", []),
            )
        except Exception as e:
            return jsonify({"error": "evaluation_failed", "message": str(e)}), 503

    overall_score = _safe_float(ai_evaluation.get("overall_score"), 0.0)
    if overall_score <= 0:
        per_question = ai_evaluation.get("per_question") or []
        if per_question:
            overall_score = round(
                sum(_safe_float(x.get("score"), 0.0) for x in per_question)
                / len(per_question),
                1,
            )

    now = datetime.now(timezone.utc)
    doc = {
        "clerk_id": clerk_id,
        "job_id": job_id,
        "job_title": job_title,
        "questions": cleaned_questions,
        "answers": cleaned_answers,
        "ai_evaluation": ai_evaluation,
        "score": round(overall_score, 1),
        "created_at": now,
        "updated_at": now,
    }

    insert_result = interviews_col.insert_one(doc)
    created = interviews_col.find_one({"_id": insert_result.inserted_id})
    created = _ensure_interview_job_title(created, interviews_col=interviews_col)

    return jsonify({"item": _serialize_interview(created)}), 201


@app.route("/api/interviews/<interview_id>", methods=["GET"])
@require_auth
def interview_detail(interview_id):
    clerk_id = g.user.get("sub")
    interviews_col = get_db()["interviews"]

    try:
        oid = ObjectId(interview_id)
    except InvalidId:
        return jsonify({"error": "Invalid interview id"}), 400

    doc = interviews_col.find_one({"_id": oid, "clerk_id": clerk_id})
    if not doc:
        return jsonify({"error": "Interview not found"}), 404

    doc = _ensure_interview_job_title(doc, interviews_col=interviews_col)

    return jsonify({"item": _serialize_interview(doc)})


@app.route("/api/interviews/<interview_id>/upskill-plan", methods=["POST"])
@require_auth
def create_upskill_plan(interview_id):
    clerk_id = g.user.get("sub")
    interviews_col = get_db()["interviews"]

    try:
        oid = ObjectId(interview_id)
    except InvalidId:
        return jsonify({"error": "Invalid interview id"}), 400

    doc = interviews_col.find_one({"_id": oid, "clerk_id": clerk_id})
    if not doc:
        return jsonify({"error": "Interview not found"}), 404

    body = request.get_json(silent=True) or {}
    force = bool(body.get("force"))

    existing_eval = doc.get("ai_evaluation") if isinstance(doc.get("ai_evaluation"), dict) else {}
    existing_topics = existing_eval.get("upskill_topics") if isinstance(existing_eval, dict) else []
    if existing_topics and not force:
        return jsonify({"item": _serialize_interview(doc), "generated": False})

    questions = [q for q in (doc.get("questions") or []) if isinstance(q, str) and q.strip()]
    answers = [a for a in (doc.get("answers") or []) if isinstance(a, str)]
    job_title = (doc.get("job_title") or "").strip()
    if not job_title:
        job_title = _resolve_job_title(doc.get("job_id") or "")

    if not questions:
        return jsonify({"error": "No interview questions found"}), 400

    user = get_user_by_clerk_id(clerk_id) or {}

    try:
        ai_evaluation = evaluate_interview_payload(
            questions=questions,
            answers=answers,
            job_title=job_title,
            user_skills=user.get("skills", []),
        )
    except Exception as e:
        return jsonify({"error": "evaluation_failed", "message": str(e)}), 503

    overall_score = _safe_float(ai_evaluation.get("overall_score"), 0.0)
    if overall_score <= 0:
        per_question = ai_evaluation.get("per_question") or []
        if per_question:
            overall_score = round(
                sum(_safe_float(x.get("score"), 0.0) for x in per_question)
                / len(per_question),
                1,
            )

    interviews_col.update_one(
        {"_id": oid, "clerk_id": clerk_id},
        {
            "$set": {
                "ai_evaluation": ai_evaluation,
                "score": round(overall_score, 1),
                "job_title": job_title,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )

    updated = interviews_col.find_one({"_id": oid, "clerk_id": clerk_id})
    updated = _ensure_interview_job_title(updated, interviews_col=interviews_col)
    return jsonify({"item": _serialize_interview(updated), "generated": True})


# ── Question Generation Functions ──────────────────────────────────────────
# Two interchangeable functions for generating interview questions.
# Generates 100 questions in 4 batches (easy → medium → hard → expert),
# based on both resume skills AND job description.
# Swap the function called in the /api/ask route below to switch providers.

DIFFICULTY_BATCHES = [
    {
        "level": "easy",
        "batch_size": 25,
        "description": "basic and foundational",
        "category_mix": "10 CS Fundamentals (OOP concepts, DBMS basics, OS basics, CN basics), 15 technical skills & frameworks (definitions, syntax, basic usage, simple comparisons)",
    },
    {
        "level": "medium",
        "batch_size": 25,
        "description": "intermediate",
        "category_mix": "8 CS Fundamentals (algorithms, data structures, design patterns, normalization, indexing), 17 technical skills & frameworks (how things work internally, comparisons, trade-offs, middleware, state management)",
    },
    {
        "level": "hard",
        "batch_size": 25,
        "description": "advanced and in-depth",
        "category_mix": "7 CS Fundamentals (system design, concurrency, advanced OS/networking, memory management), 18 technical skills & frameworks (deep internals, optimization, edge cases, advanced patterns, caching, security)",
    },
    {
        "level": "expert",
        "batch_size": 25,
        "description": "expert-level and challenging",
        "category_mix": "7 CS Fundamentals (distributed systems, advanced algorithms, CAP theorem, consensus protocols, security), 18 technical skills & frameworks (architecture decisions, performance tuning, cutting-edge features, scaling strategies, low-level internals)",
    },
]


def _build_batch_question_prompt(skills_str, job_description, batch):
    """Build a question-generation prompt for a specific difficulty batch."""
    jd_section = f"\nJOB DESCRIPTION:\n{job_description[:3000]}" if job_description else ""

    return f"""You are an expert technical interviewer conducting a comprehensive interview.
Generate EXACTLY {batch['batch_size']} {batch['description']} interview questions.

The questions should be {batch['level']}-level difficulty.

Category distribution for this batch:
{batch['category_mix']}

RULES:
- ALL questions must be purely TECHNICAL — about concepts, theory, code, and implementation
- Do NOT generate any behavioral, scenario-based, situational, or personality questions
- Do NOT ask questions like "Tell me about yourself", "Describe a time when...", "How do you handle..."
- Questions must be relevant to the candidate's skills AND the job description
- Questions should be clear, concise, and answerable in 1-3 minutes each
- Order questions from slightly easier to slightly harder WITHIN this batch
- Cover DIFFERENT topics — do not repeat the same concept across questions
- Be specific (e.g., "Explain how React's reconciliation algorithm works" NOT "Tell me about React")
- OUTPUT ONLY A VALID JSON ARRAY of exactly {batch['batch_size']} question strings, with no extra text before or after

CANDIDATE SKILLS: {skills_str}
{jd_section}

OUTPUT FORMAT:
["Question 1?", "Question 2?", ..., "Question {batch['batch_size']}?"]"""


def _call_gemini_for_batch(prompt, gemini_api_key):
    """Make a single Gemini API call and return parsed questions list."""
    last_error = None
    for model in GEMINI_MODELS:
        try:
            response = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={gemini_api_key}",
                headers={"Content-Type": "application/json"},
                json={
                    "contents": [{
                        "role": "user",
                        "parts": [{"text": prompt}],
                    }],
                    "generationConfig": {
                        "temperature": 0.4,
                        "responseMimeType": "application/json",
                    },
                },
                timeout=60,
            )

            if response.status_code in (429, 500, 503):
                try:
                    err_msg = (
                        response.json().get("error", {}).get("message")
                        or response.text
                    )
                except Exception:
                    err_msg = response.text
                last_error = f"model unavailable: {model} - {str(err_msg)[:200]}"
                continue

            if response.status_code != 200:
                last_error = response.text
                continue

            response_data = response.json()
            candidates = response_data.get("candidates") or []
            if not candidates:
                last_error = "No candidates in Gemini response"
                continue

            parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
            content = "".join(
                str(part.get("text", "")) for part in parts if isinstance(part, dict)
            ).strip()

            if not content:
                last_error = "Empty Gemini response"
                continue

            match = re.search(r"\[.*\]", content, re.S)
            if not match:
                last_error = "No JSON array in Gemini response"
                continue

            questions = json.loads(match.group())
            if not isinstance(questions, list) or len(questions) == 0:
                last_error = "Invalid question format from Gemini"
                continue

            return questions

        except Exception as e:
            last_error = str(e)
            continue

    raise RuntimeError(last_error or "All Gemini models unavailable for batch")


def _call_openrouter_for_batch(prompt, api_key):
    """Make a single OpenRouter API call and return parsed questions list."""
    last_error = None
    for model in FREE_MODELS:
        try:
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "HTTP-Referer": "http://localhost:3000",
                    "X-Title": "SkillsBridge",
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.4,
                    "max_tokens": 4000,
                },
                timeout=90,
            )

            if response.status_code == 429:
                last_error = "rate_limited"
                continue

            if response.status_code != 200:
                last_error = response.text
                continue

            content = response.json()["choices"][0]["message"]["content"].strip()

            match = re.search(r"\[.*\]", content, re.S)
            if not match:
                last_error = "No JSON array in OpenRouter response"
                continue

            questions = json.loads(match.group())
            if not isinstance(questions, list) or len(questions) == 0:
                last_error = "Invalid question format from OpenRouter"
                continue

            return questions

        except Exception as e:
            last_error = str(e)
            continue

    raise RuntimeError(last_error or "All OpenRouter models unavailable for batch")


def generate_questions_gemini(skills_str, job_description=""):
    """Generate ~100 interview questions using Google Gemini API in 4 difficulty batches."""
    gemini_api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY (or GOOGLE_API_KEY) not configured")

    print("[QuestionGen] Gemini: starting 4-batch generation (100 questions)")

    all_questions = []
    for i, batch in enumerate(DIFFICULTY_BATCHES):
        print(f"[QuestionGen] Gemini: generating batch {i + 1}/4 ({batch['level']})...")
        prompt = _build_batch_question_prompt(skills_str, job_description, batch)
        try:
            batch_questions = _call_gemini_for_batch(prompt, gemini_api_key)
            # Ensure we only take strings
            batch_questions = [str(q) for q in batch_questions if isinstance(q, str) and q.strip()]
            all_questions.extend(batch_questions[:batch["batch_size"]])
            print(f"[QuestionGen] Gemini: batch {i + 1} returned {len(batch_questions)} questions")
        except Exception as e:
            print(f"[QuestionGen] Gemini: batch {i + 1} ({batch['level']}) failed: {e}")
            # Continue with other batches even if one fails
            continue

    print("[QuestionGen] Gemini: final questions:", all_questions)

    if not all_questions:
        raise RuntimeError("All Gemini question generation batches failed")

    print(f"[QuestionGen] Gemini: total questions generated = {len(all_questions)}")
    return all_questions


def generate_questions_openrouter(skills_str, job_description=""):
    """Generate ~100 interview questions using OpenRouter API in 4 difficulty batches."""
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY not configured")

    print("[QuestionGen] OpenRouter: starting 4-batch generation (100 questions)")

    all_questions = []
    for i, batch in enumerate(DIFFICULTY_BATCHES):
        print(f"[QuestionGen] OpenRouter: generating batch {i + 1}/4 ({batch['level']})...")
        prompt = _build_batch_question_prompt(skills_str, job_description, batch)
        try:
            batch_questions = _call_openrouter_for_batch(prompt, api_key)
            batch_questions = [str(q) for q in batch_questions if isinstance(q, str) and q.strip()]
            all_questions.extend(batch_questions[:batch["batch_size"]])
            print(f"[QuestionGen] OpenRouter: batch {i + 1} returned {len(batch_questions)} questions")
        except Exception as e:
            print(f"[QuestionGen] OpenRouter: batch {i + 1} ({batch['level']}) failed: {e}")
            continue

    if not all_questions:
        raise RuntimeError("All OpenRouter question generation batches failed")

    print(f"[QuestionGen] OpenRouter: total questions generated = {len(all_questions)}")
    return all_questions


def generateTmp():
    """Return a random question list from question_data.py."""
    import random
    from question_data import data
    idx = random.randint(0, len(data) - 1)
    return data[idx]


# ── Generate Interview Questions Endpoint ──────────────────────────────────
@app.route("/api/ask", methods=["POST", "OPTIONS"])
@require_auth
def ask_gemma():
    # ── CORS preflight ─────────────────────────────────────────────────────
    if request.method == "OPTIONS":
        return "", 204

    # ── Fetch User ─────────────────────────────────────────────────────────
    clerk_id = g.user.get("sub")
    user = get_user_by_clerk_id(clerk_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    skills = user.get("skills", [])
    if not skills:
        return jsonify(
            {"error": "No skills found. Please upload your resume first."}
        ), 400

    skills_str = ", ".join(skills)

    # ── Fetch job description from MongoDB ─────────────────────────────────
    body = request.get_json(silent=True) or {}
    job_id = (body.get("job_id") or "").strip()
    job_description = ""

    if job_id:
        jobs_col = get_db()["jobs"]
        decoded_id = unquote(job_id)
        candidates = [job_id]
        if decoded_id and decoded_id != job_id:
            candidates.append(decoded_id)

        job_doc = jobs_col.find_one(
            {"job_id": {"$in": candidates}},
            {"description": 1, "title": 1},
        )
        if job_doc:
            job_description = job_doc.get("description", "")

    # ── Generate questions ─────────────────────────────────────────────────
    # 🔧 Quick-test: uncomment the line below to use predefined questions from data.txt
    # ✅ SWAP HERE: change to generate_questions_openrouter(skills_str, job_description)
    #    to use OpenRouter instead of Gemini.
    try:
        questions = generateTmp()
        #questions = generate_questions_gemini(skills_str, job_description)
        return jsonify({"questions": questions, "total": len(questions)})
    except Exception as e:
        return jsonify(
            {"error": "generation_failed", "message": str(e)}
        ), 503


# ── Run Server ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)
