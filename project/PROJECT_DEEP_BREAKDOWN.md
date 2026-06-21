# SkillsBridge Project Deep Breakdown

## 1. Executive Summary

SkillsBridge is an AI-assisted interview preparation and career alignment platform. It combines:
- Resume parsing and skill extraction
- AI-generated mock interview questions
- Voice-based interview simulation (text-to-speech + speech-to-text)
- AI evaluation and feedback of interview answers
- Personalized upskilling recommendations
- Resume-to-job semantic matching using vector search

The system is implemented as:
- Frontend: Next.js 15 + React 19 + Clerk authentication + Tailwind UI
- Backend: Flask APIs + MongoDB + Qdrant vector database + external AI APIs

The target user is a student or early-career candidate who wants to improve interview performance and discover better-fit jobs.

## 2. Problem Statement

Candidates often face three disconnected challenges:
- They do not know which jobs fit their profile.
- They lack realistic interview practice with feedback.
- They do not have a clear, data-driven upskilling path.

SkillsBridge addresses this by integrating all three challenges into one product workflow.

## 3. Core Objectives

- Build a profile-grounded interview preparation pipeline.
- Generate interview questions from candidate skills.
- Capture spoken answers and transcribe them reliably.
- Evaluate interview quality with LLM-based scoring and feedback.
- Store interview history for progress tracking.
- Match users with relevant jobs using semantic embeddings.
- Highlight missing skills and suggest upskilling topics/resources.

## 4. System Architecture

### 4.1 High-Level Layers

- Presentation Layer (Frontend)
  - Landing, auth, dashboard modules, profile, jobs, interview, analytics, upskilling.
- Application Layer (Backend Flask)
  - Auth verification, profile management, resume parsing, interview orchestration, evaluation, persistence.
- Data Layer
  - MongoDB for user, job, and interview documents.
  - Qdrant for vector similarity search.
- Intelligence Layer
  - Skill extraction (spaCy + SkillNer)
  - Embeddings (SentenceTransformers all-MiniLM-L6-v2)
  - AI question generation (OpenRouter models)
  - AI evaluation/upskilling generation (Gemini models)
  - STT (Faster-Whisper)
  - TTS (Edge TTS)

### 4.2 Main Runtime Components

- Backend app entry: `Backend/app.py`
- Auth decorator and JWT validation: `Backend/auth.py`
- User model/service helpers: `Backend/models/user.py`
- Job ingestion pipeline: `Backend/utils/job_fetcher.py`
- Scheduler for daily ingestion: `Backend/utils/scheduler.py`
- Embedding generation: `Backend/utils/embedding.py`
- Vector operations: `Backend/utils/qdrant_store.py`
- Resume NLP extraction: `Backend/utils/nlp.py`
- STT service: `Backend/utils/stt_service.py`
- TTS service: `Backend/utils/tts_service.py`
- Frontend routing root: `Frontend/app`

## 5. End-to-End User Workflows

### 5.1 Onboarding and Identity

1. User signs up/signs in via Clerk.
2. Protected dashboard routes are enforced through middleware.
3. Frontend `UserSync` component calls `/api/auth/sync` to mirror Clerk identity in MongoDB.

### 5.2 Resume Upload and Skill Extraction

1. User uploads PDF resume from profile page.
2. Backend validates file and parses text using `pdfminer.six`.
3. SkillNer extracts skills from resume content.
4. Resume is uploaded to Cloudinary.
5. Resume embedding is generated and stored in Qdrant (`resumes` collection).
6. User profile is updated with `resume_url`, `resume_public_id`, and extracted skills.

### 5.3 Job Matching

1. Frontend requests `/api/jobs` with auth token.
2. Backend fetches user resume embedding from Qdrant.
3. Semantic similarity query is executed against job vectors (`jobs` collection).
4. Matching job metadata is fetched from MongoDB.
5. Missing skills are computed as set difference:
   - missing = job_skills - user_skills
6. User sees ranked jobs with match score and missing skills.

### 5.4 AI Mock Interview Session

1. User starts interview from a matched job card.
2. Frontend calls `/api/ask` to generate 5 interview questions from user skills.
3. For each question:
   - Backend TTS endpoint speaks question.
   - User answers by voice.
   - Frontend records audio and sends to STT endpoint.
   - Transcript is shown and retained.
4. On completion:
   - Frontend calls `/api/evaluate-interview`.
   - Evaluation is saved through `/api/interviews`.
5. User receives score, rating, strengths, weaknesses, and upskill topics.

### 5.5 Analytics and Upskilling

1. Analytics page loads interview history from `/api/interviews`.
2. It visualizes score/rating plus strengths and weaknesses.
3. Upskilling page lists interview-specific plans derived from `upskill_topics`.
4. If plan is missing/incomplete, user can force regeneration via `/api/interviews/<id>/upskill-plan`.

## 6. Feature Inventory (Comprehensive)

### 6.1 Authentication and Access Control

- Clerk-based authentication on frontend.
- Protected dashboard route enforcement in middleware.
- Backend JWT verification against Clerk JWKS.
- Issuer and token claim validation (`exp`, `iss`, `sub`).

### 6.2 User Profile Management

- Sync Clerk identity to internal user record.
- Get and update profile data (`/api/me`).
- Update user skills independently (`/api/skills`).
- Profile page with editable personal and career fields.

### 6.3 Resume Handling

- PDF-only resume upload with size/type validation.
- Resume text extraction and skill extraction.
- Cloudinary storage with old-resume cleanup.
- Resume URL management and direct view from UI.

### 6.4 AI Interview Engine

- Dynamic question generation from candidate skill profile.
- Fixed interview structure (5 questions).
- Voice interview UX with AI speaker state and progress indicators.
- Live audio recording controls (mute/pause/resume).
- Automatic transcription fallback behavior.

### 6.5 AI Evaluation and Feedback

- Per-question scoring (1-10) and concise feedback.
- Overall score/rating generation.
- Summary generation.
- Strength and weakness extraction.
- Upskill topic recommendations with suggested resources.

### 6.6 Job Recommendation Engine

- Daily refreshed fresher-oriented job ingestion from JSearch.
- Deduplication and structured metadata persistence in MongoDB.
- Job embeddings in Qdrant.
- Semantic resume-to-job ranking.
- Match percentage display.
- Missing skill recommendation per job.
- Pagination with workaround for vector DB offset behavior.

### 6.7 Interview and Learning History

- Persist completed interview sessions.
- Interview detail fetch by ID.
- Interview list retrieval with newest-first ordering.
- Lazy hydration of `job_title` for historical records.

### 6.8 Dashboard Experience

- Modular sections:
  - Dashboard Home
  - Interviews
  - AI Feedback
  - Jobs
  - Upskilling
  - Profile
  - Settings (UI scaffold)
- Sidebar navigation with active states.
- Theme toggling.
- Toast notifications and loading/error states.

### 6.9 Operational and Diagnostic Utilities

- `run_fetch.py`: manual job ingestion trigger.
- `diag_interview.py`: checks ffmpeg, whisper import/model, basic transcription path.
- `diag_qdrant.py`: checks vector DB + Mongo counts.
- `test_db.py`, `test_jsearch.py`: quick connectivity/API probes.

## 7. Backend API Catalog

### 7.1 Public/General

- `GET /`
  - Health/basic response.

- `POST /api/tts/speak`
  - Input: `{ text }`
  - Output: audio/mpeg bytes

- `POST /api/stt/transcribe`
  - Input: multipart audio file (`audio`)
  - Output: `{ transcript }`

### 7.2 Authenticated APIs

- `GET /api/jobs`
  - Returns semantic job matches and missing skills.

- `POST /api/auth/sync`
  - Upserts user identity from Clerk data.

- `GET /api/me`
  - Fetch user profile.

- `PUT /api/me`
  - Update profile fields.

- `PUT /api/skills`
  - Replace user skills list.

- `POST /api/parse-resume`
  - Parse/upload resume, extract skills, update vectors.

- `POST /api/evaluate-interview`
  - Evaluates Q/A payload using Gemini.

- `GET /api/interviews`
  - Returns interview history.

- `POST /api/interviews`
  - Creates and persists interview session and evaluation.

- `GET /api/interviews/<interview_id>`
  - Returns interview detail.

- `POST /api/interviews/<interview_id>/upskill-plan`
  - Regenerates upskill plan.

- `POST /api/ask`
  - Generates interview question set.

## 8. Data Model Breakdown

### 8.1 Users Collection (MongoDB)

Key fields:
- `clerk_id` (unique)
- `email` (unique)
- profile fields: first_name, last_name, phone, location, job_title, bio
- `resume_url`, `resume_public_id`
- `skills` (array)
- audit fields: `created_at`, `updated_at`

Indexes:
- `clerk_id` unique
- `email` unique

### 8.2 Jobs Collection (MongoDB)

Key fields:
- `job_id`
- title/company/location/country
- full `description`
- `apply_link`
- `employment_type`
- `posted_at`
- extracted `skills`

### 8.3 Interviews Collection (MongoDB)

Key fields:
- `clerk_id`
- `job_id`, `job_title`
- `questions[]`, `answers[]`
- `ai_evaluation` object
- numeric `score`
- timestamps

Indexes:
- `(clerk_id, created_at desc)`
- `job_id`

### 8.4 Vector Collections (Qdrant)

- `resumes`
  - id from stable hash of `clerk_id`
  - vector length 384
  - payload includes `clerk_id`

- `jobs`
  - id from stable hash of `job_id`
  - vector length 384
  - payload includes job metadata (`job_id`, title)

Distance metric:
- Cosine similarity

## 9. AI/ML Logic Details

### 9.1 Embeddings

- Model: `all-MiniLM-L6-v2`
- Output dimension: 384
- Used for:
  - Resume semantic representation
  - Job description semantic representation

### 9.2 Skill Extraction

- NLP stack:
  - spaCy `en_core_web_lg`
  - SkillNer with phrase matching
- Applied to:
  - Resume content
  - Job descriptions (during ingestion)

### 9.3 Question Generation

- Endpoint: `/api/ask`
- Provider: OpenRouter (free model fallback list)
- Prompt strategy:
  - asks for exactly 5 JSON questions
  - mixes CS fundamentals and technical skills

### 9.4 Interview Evaluation

- Endpoint: `/api/evaluate-interview` and embedded call in `/api/interviews`
- Provider: Gemini model fallback list
- Output schema enforced:
  - overall score/rating
  - per-question scoring and feedback
  - strengths, weaknesses
  - upskill topics/resources

### 9.5 Speech Stack

- TTS:
  - Edge TTS voice synthesis
  - streams MP3 bytes

- STT:
  - Faster-Whisper local inference
  - ffmpeg pre-processing (mono, 16kHz, filtering)
  - two-pass decode fallback when transcript is empty

## 10. Frontend Module Breakdown

### 10.1 Public Pages

- Landing page: product positioning and feature highlights
- Login and signup: Clerk components

### 10.2 Dashboard Pages

- Home dashboard: entry cards to all core modules
- Interviews list:
  - fetches matched jobs
  - starts interview sessions per job
- Interview session page (`/dashboard/interviews/[id]`):
  - question fetch, TTS playback, voice recording, STT, save/evaluate
- Analytics page:
  - displays historical interview feedback and ratings
- Jobs page:
  - matched jobs and direct apply links
- Upskilling list/detail:
  - shows interview-derived learning plans
  - supports force regeneration
- Profile page:
  - resume upload, skill editing, user profile management
- Settings page:
  - currently UI scaffold (non-persistent controls)

## 11. Reliability and Fallback Design

- AI model fallback lists for question generation and evaluation.
- Resume skill extraction fallback for older jobs without precomputed skills.
- STT retry pass when first decode returns empty transcript.
- Graceful handling of missing resume/profile/evaluation states in UI.
- Interview persistence still proceeds when initial evaluation call fails (backend can re-evaluate on save path).

## 12. Security and Privacy Posture

Implemented:
- JWT bearer auth validation with Clerk JWKS.
- Route-level authorization checks on protected resources.
- Interview ownership checks by `clerk_id` for detail/upskill endpoints.
- Input validations for arrays, IDs, required fields.

To strengthen for production/research discussion:
- Restrict CORS origins strictly by environment.
- Add request rate limiting (especially STT/TTS and LLM endpoints).
- Add content-security and upload malware scanning pipeline.
- Add structured audit logging for sensitive actions.
- Add PII retention/deletion policy and consent management.

## 13. Performance Considerations

- Vector search scales better than lexical matching for semantic relevance.
- Lazy model loading avoids startup overhead.
- Daily job refresh keeps recommendations current.
- Qdrant pagination workaround implemented by over-fetch + slice.

Potential bottlenecks:
- STT on CPU for long answers.
- LLM response latency and quota/rate limits.
- Resume parsing and NLP extraction under burst uploads.

## 14. Current Gaps and Product Maturity Notes

- Settings page controls are mostly UI-only (not fully wired to backend).
- No explicit test suite automation shown (mostly diagnostic scripts).
- No explicit retry queue/circuit breaker around external AI providers.
- No multi-language interview pipeline yet.
- No formal evaluation dashboard for model quality metrics.

## 15. Research Contribution Angles

You can position this project as a practical AI system that fuses:
- Retrieval-based job matching (vector similarity)
- Interactive multimodal interview simulation (voice + text)
- LLM-based formative assessment
- Personalized upskill planning from interview evidence

Novelty can be framed as a closed learning loop:
- Profile -> matched opportunities -> interview simulation -> AI diagnosis -> upskill plan -> reattempt cycle

## 16. Suggested Research Paper Structure

1. Abstract
2. Introduction and Motivation
3. Related Work
4. System Design and Architecture
5. Methods
6. Implementation Details
7. Experimental Setup
8. Results and Analysis
9. Limitations and Threats to Validity
10. Conclusion and Future Work

## 17. Suggested Experimental Evaluation Plan

### 17.1 Datasets and Inputs

- Candidate resumes (anonymized)
- Job descriptions collected through JSearch
- Interview transcripts from mock sessions

### 17.2 Metrics

- Job recommendation relevance
  - Precision@K, Recall@K, NDCG@K (if ground truth labels exist)
- Interview evaluation utility
  - Human expert agreement with AI score/rating
  - Inter-rater reliability between evaluators and AI
- Upskilling plan quality
  - Actionability rating from users/mentors
  - Topic relevance to observed weaknesses
- System performance
  - API latency per endpoint
  - STT average processing time
  - End-to-end interview completion time

### 17.3 User Study Option

- Two groups:
  - Group A: traditional prep resources
  - Group B: SkillsBridge workflow
- Compare confidence, mock interview score improvements, and placement outcomes over time.

## 18. Reproducibility Notes

### 18.1 Backend Dependencies

Main packages include Flask, PyJWT, pymongo, qdrant-client, sentence-transformers, spaCy, skillNer, faster-whisper, edge-tts.

### 18.2 Frontend Dependencies

Main packages include Next.js 15, React 19, Clerk, Radix UI, Tailwind, Sonner, Lucide.

### 18.3 External Services/Keys Required

- Clerk JWKS/issuer settings
- MongoDB URI
- Qdrant URL/API key
- Cloudinary credentials
- JSearch API key
- OpenRouter API key
- Gemini API key

## 19. Project Status Summary

This is a strong prototype-to-preproduction level system with:
- Real user auth
- Real vector retrieval
- Real multimodal interview pipeline
- Persisted analytics and upskill outputs

The highest-impact next steps for publication-quality rigor are:
- Add formal quantitative evaluation pipeline
- Add robust automated tests
- Add production hardening (rate limits, retries, observability)
- Add outcome validation through user study
