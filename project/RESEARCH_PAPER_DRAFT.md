# SkillsBridge: An AI-Driven Multimodal Platform for Interview Preparation, Job Matching, and Personalized Upskilling

## Abstract

The transition from education to employment is increasingly constrained by a persistent mismatch between candidate readiness and market expectations. Existing preparation ecosystems are fragmented across resume tools, coding practice portals, interview simulators, and job boards, requiring users to coordinate disconnected workflows with limited feedback continuity. This paper presents SkillsBridge, an integrated AI-driven platform that unifies resume understanding, semantic job matching, multimodal mock interview simulation, automated performance evaluation, and personalized upskilling plan generation. SkillsBridge combines a Next.js-based user interface with a Flask backend, leveraging MongoDB for transactional data, Qdrant for vector similarity search, SentenceTransformers for embedding generation, SkillNer for skill extraction, Faster-Whisper for speech transcription, and large language models for question generation and interview assessment. We describe the full system architecture, implementation decisions, and operational pipeline, including fallback strategies for model availability and transcription robustness. We further propose a quantitative and user-centered evaluation framework covering recommendation quality, assessment agreement, usability, and latency. By closing the loop from candidate profile to feedback-driven skill development, SkillsBridge demonstrates a practical blueprint for intelligent career-preparation systems and motivates future work on reliability, fairness, and longitudinal outcome validation.

Keywords: AI in education, interview preparation, semantic job matching, multimodal interaction, speech-to-text, large language models, upskilling recommendation.

## 1. Introduction

Career preparation for students and early-career professionals has become both data-rich and decision-complex. Candidates are expected to optimize resumes for relevance, discover suitable opportunities, master domain-specific interview patterns, communicate clearly under time pressure, and continuously acquire market-relevant skills. In practice, these activities are often managed through independent platforms with weak interoperability, resulting in repeated context setup, duplicated effort, and inconsistent performance tracking.

This fragmentation creates three core challenges:
1. Discoverability challenge: candidates struggle to identify opportunities aligned with their current skill profile.
2. Readiness challenge: candidates lack realistic, iterative interview practice with actionable feedback.
3. Progression challenge: candidates do not receive grounded recommendations that connect observed interview weaknesses to concrete upskilling actions.

SkillsBridge is designed to address these challenges through a unified architecture that combines profile-derived intelligence, voice-based interview simulation, AI-generated assessment, and evidence-linked learning recommendations. Instead of treating job discovery and interview preparation as separate tasks, the platform models them as a closed improvement loop.

### 1.1 Contributions

This work makes the following contributions:
1. End-to-end integration: a single production-oriented workflow spanning resume parsing, skill extraction, semantic job retrieval, mock interviews, automated evaluation, and upskill planning.
2. Multimodal interview orchestration: a voice-first interview experience using text-to-speech for question delivery and speech-to-text for answer capture.
3. Retrieval + assessment synergy: coupling vector-based job matching with AI evaluation outputs to generate targeted skill-gap insights.
4. Practical system blueprint: a modular architecture with explicit API boundaries, persistence strategy, and fallback logic suitable for academic and engineering replication.

## 2. Related Work

Research relevant to SkillsBridge spans five domains:
1. AI-assisted career guidance and employability systems.
2. Information retrieval and semantic matching for resumes and job descriptions.
3. Intelligent tutoring and formative feedback systems.
4. Multimodal conversational agents and speech interfaces.
5. LLM-based automated assessment and recommendation generation.

Prior work in job recommendation has shown that semantic representations outperform pure keyword matching in sparse and heterogeneous textual settings. Similarly, AI tutoring literature emphasizes the importance of immediate, actionable, and specific feedback for learning gains. Interview-preparation tools have evolved from static question banks to interactive simulators, but many remain limited by either non-personalized prompts or weak post-interview diagnostics. SkillsBridge advances this space by integrating semantic retrieval, multimodal interaction, and personalized recommendation generation within a single persistence-aware pipeline.

## 3. Problem Formulation

Let a user profile be represented by $u = (r, s)$, where $r$ is resume text and $s$ is extracted skill set. Let the job corpus be $J = \{j_1, j_2, \dots, j_n\}$, each with textual description $d_i$ and skill set $s_i$. The system seeks to:

1. Retrieve top-$k$ jobs maximizing semantic relevance:
$$
\operatorname*{arg\,topk}_{j_i \in J} \; \cos(\phi(r), \phi(d_i))
$$
where $\phi(\cdot)$ is the embedding function.

2. Conduct interview simulation with generated question set $Q = \{q_1, \dots, q_m\}$ and captured answers $A = \{a_1, \dots, a_m\}$.

3. Produce evaluation tuple:
$$
E = (\text{overall\_score}, \text{per\_question\_scores}, \text{strengths}, \text{weaknesses}, \text{upskill\_topics})
$$

4. Compute interpretable skill-gap indicators:
$$
\Delta_i = s_i \setminus s
$$
for matched job $j_i$.

## 4. System Overview

SkillsBridge is implemented as a two-tier web system with specialized intelligence services:

1. Frontend (Next.js 15, React 19): user interaction, interview flow orchestration, dashboard visualization.
2. Backend (Flask): authenticated API layer, AI orchestration, persistence, and job ingestion.
3. Data services:
   - MongoDB for users, interviews, and job metadata.
   - Qdrant for resume and job vectors.
4. AI services:
   - SentenceTransformers for embeddings.
   - SkillNer + spaCy for skill extraction.
   - OpenRouter-hosted models for question generation.
   - Gemini models for interview evaluation and upskilling output.
   - Edge TTS and Faster-Whisper for audio interaction.

## 5. Architecture and Implementation

### 5.1 Authentication and Access Control

Authentication is handled through Clerk on the frontend. Protected dashboard routes are enforced at middleware level. The backend validates bearer tokens using Clerk JWKS and issuer checks, then attaches decoded claims to request context for route-level authorization.

### 5.2 Data Model

The platform uses three primary persistent entities:

1. Users:
   - identity fields (clerk_id, email), profile metadata, resume reference, extracted skills.
2. Jobs:
   - job metadata, description, extracted job skills, source links.
3. Interviews:
   - linked user and job, generated questions, answer transcripts, AI evaluation payload, score.

Vector collections in Qdrant:
1. resumes: one vector per user profile.
2. jobs: one vector per ingested job description.

### 5.3 Resume Intelligence Pipeline

When a resume is uploaded:
1. PDF validation and parsing via pdfminer.
2. Skill extraction using SkillNer.
3. Embedding generation using all-MiniLM-L6-v2 (384-dim).
4. Cloudinary upload for file storage.
5. MongoDB user update + Qdrant vector upsert.

This pipeline provides both symbolic skills and dense semantic representation.

### 5.4 Job Ingestion and Semantic Matching

A scheduled job-fetch process retrieves fresher-oriented positions from JSearch, deduplicates by job_id, stores metadata in MongoDB, extracts job skills, and creates vector embeddings in Qdrant. Retrieval for users proceeds by querying Qdrant with resume vector and then hydrating matched IDs with MongoDB metadata.

To improve user interpretability, each recommendation includes:
1. Match score from vector similarity.
2. Missing skills computed through set difference with user skill profile.

### 5.5 Interview Simulation Engine

Interview generation and execution involve:
1. Question synthesis from user skills through an LLM prompt enforcing fixed JSON output.
2. TTS playback of each question for conversational pacing.
3. Browser microphone recording of user response.
4. STT transcription using Faster-Whisper with ffmpeg preprocessing.
5. Per-question progression and final aggregation.

The frontend supports recording-state transitions, mute controls, and transcript fallback behavior for robust completion.

### 5.6 AI Evaluation and Upskilling Generation

After interview completion, a structured Q/A payload is sent for AI evaluation. The evaluator returns:
1. Overall score and rating.
2. Per-question scores and feedback.
3. Strength and weakness summaries.
4. Upskill topics with reason and suggested resources.

Evaluation output is validated and normalized before persistence. If evaluation is absent or outdated, upskill plans can be regenerated per interview.

### 5.7 Resilience and Fallback Strategy

The system employs several practical safeguards:
1. Multi-model fallback chains for question generation and evaluation.
2. Two-pass STT decoding when initial transcription is empty.
3. Graceful handling for missing resume, missing evaluations, and model unavailability.
4. Scheduler isolation via background jobs for job ingestion.

## 6. User Workflow and Product Loop

The platform operationalizes a closed-loop learning cycle:
1. User authenticates and syncs profile.
2. User uploads resume and receives extracted skills.
3. User views semantically matched jobs with skill gaps.
4. User starts voice-based mock interview for a selected role.
5. User receives AI feedback and upskill recommendations.
6. User revisits practice with improved profile and responses.

This loop aligns recommendation, assessment, and skill development into a continuous progression process.

## 7. Experimental Design for Evaluation

To evaluate system efficacy rigorously, we propose a mixed-method framework.

### 7.1 Offline Retrieval Evaluation

Objective: assess job recommendation quality.

Metrics:
1. Precision@K
2. Recall@K
3. NDCG@K

Setup:
1. Construct candidate-job relevance labels through expert annotation or user interaction logs.
2. Compare semantic retrieval baseline against keyword matching baseline.

### 7.2 Interview Assessment Agreement Study

Objective: measure alignment between AI and human evaluators.

Metrics:
1. Mean absolute error between AI and human scores.
2. Cohen’s kappa or weighted kappa for rating category agreement.
3. Spearman correlation for ranking consistency.

Setup:
1. Sample completed mock interviews across varied skill levels.
2. Obtain independent scoring from domain experts.
3. Compare AI-generated scores and feedback labels.

### 7.3 Upskilling Recommendation Quality

Objective: test actionability and relevance of generated plans.

Metrics:
1. Relevance rating (Likert scale).
2. Actionability rating.
3. Coverage of observed weaknesses.

Setup:
1. Present interview transcripts and generated plans to evaluators.
2. Collect structured quality judgments.

### 7.4 Usability and Learning Impact Study

Objective: evaluate user-perceived utility and short-term learning gains.

Design:
1. Pre-test/post-test interview confidence and performance.
2. A/B comparison between integrated workflow and fragmented baseline tools.

Metrics:
1. SUS (System Usability Scale)
2. Task completion time
3. Improvement in mock interview scores across sessions

## 8. Results Reporting Template

For publication, report:
1. System latency table by endpoint category (jobs retrieval, STT, evaluation).
2. Retrieval performance table comparing baselines.
3. Agreement metrics for AI vs human evaluation.
4. User-study outcomes with confidence intervals and significance tests.
5. Qualitative insights from participant feedback.

Recommended statistical tests:
1. Paired t-test or Wilcoxon signed-rank for pre/post comparisons.
2. Mann-Whitney U or independent t-test for group differences.
3. Bootstrap confidence intervals for ranking metrics.

## 9. Security, Privacy, and Ethics

### 9.1 Security Posture

Implemented controls:
1. JWT verification with issuer and claim checks.
2. Route-level authorization for user-owned interview records.
3. Basic input validation and file-type checks.

Recommended enhancements:
1. API rate limiting for AI and audio endpoints.
2. Structured audit logging for sensitive operations.
3. Strict origin management and secret-rotation policy.

### 9.2 Privacy Considerations

Sensitive data includes resumes, transcripts, and profile metadata. A production deployment should define:
1. Data retention and deletion policy.
2. Explicit consent for AI processing.
3. Pseudonymization for research datasets.

### 9.3 Ethical Risks

Potential concerns:
1. Model bias in scoring language and recommendations.
2. Overconfidence in automated feedback.
3. Uneven performance across accents and speaking styles.

Mitigations:
1. Human-in-the-loop review pathways.
2. Confidence indicators and transparency messaging.
3. Periodic fairness audits by subgroup.

## 10. Limitations

Current limitations of the implemented prototype include:
1. Dependence on third-party model availability and quotas.
2. Limited formal benchmark datasets integrated in pipeline.
3. Minimal automated end-to-end testing suite.
4. Settings module currently serves primarily as UI scaffold.
5. No long-term placement outcome tracking yet.

## 11. Future Work

Promising extensions include:
1. Domain-adaptive question generation per role family.
2. Confidence-calibrated scoring with uncertainty estimates.
3. Multilingual interview support and accent-robust STT tuning.
4. Retrieval augmentation over curated learning-resource corpora.
5. Longitudinal studies linking platform usage with placement outcomes.
6. Fully reproducible evaluation harness with CI-integrated benchmarks.

## 12. Conclusion

SkillsBridge demonstrates that interview preparation, job relevance estimation, and personalized upskilling can be effectively unified in a single AI-enabled system. The platform combines symbolic and semantic profile understanding, multimodal interaction, and structured AI assessment to provide a coherent candidate development loop. While additional validation and hardening are required for full-scale deployment and publication-grade evidence, the implemented architecture offers a robust and extensible foundation for research at the intersection of intelligent tutoring, employability systems, and human-AI interaction.

## References (Draft and To-Be-Verified)

1. Reimers, N., and Gurevych, I. Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks. EMNLP-IJCNLP, 2019.
2. OpenAI et al. Advances in large language model-based assessment and dialogue systems. Various proceedings, 2022-2025.
3. Radford, A. et al. Robust Speech Recognition via Large-Scale Weak Supervision (Whisper). arXiv, 2022.
4. Devlin, J. et al. BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding. NAACL, 2019.
5. Manning, C. D. et al. Foundations of Statistical NLP and modern semantic retrieval extensions.
6. Brooke, J. SUS: A quick and dirty usability scale. In Usability Evaluation in Industry, 1996.
7. Järvelin, K., and Kekäläinen, J. Cumulated gain-based evaluation of IR techniques. ACM TOIS, 2002.
8. Cohen, J. A coefficient of agreement for nominal scales. Educational and Psychological Measurement, 1960.

Note: Replace generic or broad references with exact bibliographic entries according to your target venue format (IEEE/ACM/Springer).

## Appendix A: Implementation Stack Summary

Frontend:
1. Next.js 15, React 19, TypeScript
2. Clerk auth
3. Tailwind + Radix-based UI

Backend:
1. Flask, Flask-CORS, PyJWT
2. MongoDB + pymongo
3. Qdrant vector database
4. SentenceTransformers (all-MiniLM-L6-v2)
5. SkillNer + spaCy
6. Faster-Whisper + ffmpeg
7. Edge TTS
8. APScheduler

External APIs:
1. JSearch (job ingestion)
2. OpenRouter (question generation)
3. Gemini API (evaluation and upskill planning)
4. Cloudinary (resume storage)
