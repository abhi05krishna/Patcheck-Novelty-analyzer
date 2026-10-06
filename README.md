# PatCheck — Patent & Research Novelty Analyzer

**Live app:** `https://patcheck-novelty-analyzer.vercel.app/`
**Backend API:** Hosted on Render
**ML/Retrieval service:** Hosted on Google Cloud Run
**Database:** MongoDB Atlas
**LLM provider:** Groq (OpenAI open-weight `gpt-oss-20b`)

---

## 1. What This Project Is

PatCheck is an AI-powered tool that helps researchers, students, and patent applicants answer one question honestly: **"Does this idea already exist, and if so, how closely?"**

A user submits a research abstract or patent draft — either pasted as text or uploaded as a PDF/DOCX file. The system:

1. Breaks the submission into semantically meaningful chunks
2. Searches a corpus of 190,000+ research papers using both meaning-based and keyword-based retrieval
3. Re-ranks the results for precision
4. Computes a weighted **novelty score** using semantic similarity, technical relevance, and citation-graph signals
5. Sends the already-computed evidence to an LLM, which explains the result in plain English and suggests concrete improvements — without ever being allowed to invent or judge similarity on its own
6. Verifies every citation the LLM produces against the real retrieved documents, filtering out anything unverifiable

The goal is to give a researcher the same kind of signal a thorough literature review would give, but in seconds rather than days — and to be explicit and honest about *why* something scores the way it does, not just hand back an opaque number.

---

## 2. The Idea, From Scratch

The project began from a simple observation: students and early-career researchers often invest weeks or months into a research direction before discovering — sometimes at the peer-review stage — that the core idea isn't novel, or that a knowledge gap they assumed was unexplored is already well-studied. Patent applicants face the same problem with prior art. PatCheck's purpose is to move that discovery earlier, cheaply, and with explainable reasoning rather than a black-box score.

Early design decisions that shaped everything downstream:
- **Retrieval-grounded, not generative-only.** The system never asks an LLM "is this novel?" - that invites hallucination. Instead, retrieval and scoring happen first, using real, computable signals, and the LLM is only ever asked to *explain* evidence it's handed.
- **Multiple signals, not one.** Relying purely on embedding similarity misses cases where wording differs but the idea is identical, or where terminology overlaps but the contribution doesn't. Combining dense retrieval, sparse (keyword) retrieval, reranking, and citation signals compensates for each method's individual blind spots.
- **Everything measured, nothing assumed.** Several points in this build involved assumptions that turned out to be wrong once tested against real data (e.g., whether reranking actually helps, whether quantizing the vector index degrades results). A recurring theme of this project is building the tooling to measure a claim before trusting it.

---

## 3. System Architecture

```
┌─────────────┐       ┌──────────────────┐         ┌──────────────────┐
│   Frontend  │─────▶ │   Node/Express   │─────▶  │  Python/FastAPI  │
│   (React)   │       │   Backend (API)  │         |    ML/Retrieval  |
│   Vercel    │◀─────│   Render         │◀─────   |   Service        │
└─────────────┘       └─────────┬────────┘         │ Google Cloud Run │
                                │                  └──────────┬──────-┘
                      ┌─────────▼─────────┐                  │
                      │   MongoDB Atlas   │       ┌───────────▼─────────┐
                      │ (papers, chunks,  │       │   FAISS Index       │
                      │  users, citations)│       │ (193,870 vectors,   │
                      └───────────────────┘       |  8-bit quantized)   │
                                │                   ─────────────────── ┘
                      ┌─────────▼─────────┐
                      │    Groq API       │
                      │ (gpt-oss-20b LLM) │
                      └───────────────────┘
```

**Why two backend services instead of one.** The Node service owns business logic, auth, orchestration, and anything that's cheap, synchronous, pure computation (scoring math, citation lookups). The Python service owns anything that genuinely needs a model runtime — embeddings, reranking, vector search. This split let each service be optimized, scaled, and deployed independently, and kept the Node side free of heavy ML dependencies entirely.

---

## 4. Tech Stack

**Languages & Runtimes**
- JavaScript (Node.js 20+) — backend and frontend
- Python 3.11 — ML/retrieval microservice

**Backend**
- Express.js — REST API framework
- Mongoose — MongoDB object modeling
- JWT (access tokens) + rotating refresh tokens (httpOnly cookies) — authentication
- Multer, pdf-parse, mammoth — file upload and text extraction (PDF/DOCX)
- node-cron — scheduled background jobs
- express-rate-limit — API abuse protection

**ML / Retrieval Service**
- FastAPI — Python web framework
- FAISS (`IndexIDMap2` wrapping `IndexScalarQuantizer`, 8-bit) — vector similarity search
- fastembed (ONNX Runtime-based) — text embedding generation, replacing an earlier `sentence-transformers`/PyTorch implementation to cut memory footprint roughly 3x
- fastembed `TextCrossEncoder` — reranking (ONNX port of `ms-marco-MiniLM-L-6-v2`)

**Data & Storage**
- MongoDB Atlas — primary database (papers, chunks, users, citation metadata)
- Git LFS — version-controlled storage for the ~76MB quantized FAISS index

**External APIs**
- arXiv API — ongoing paper corpus ingestion
- Semantic Scholar API — citation count enrichment
- Groq API (`openai/gpt-oss-20b`) — LLM-generated recommendations with JSON-schema-constrained structured output

**Frontend**
- React 19 + Vite
- Tailwind CSS
- Framer Motion — animation
- React Router

**Infrastructure & DevOps**
- Docker — containerization of all three services
- Google Cloud Run — ML service hosting (chosen for its generous free-tier RAM, essential once memory profiling showed the service needed ~1.1GB, beyond what smaller free tiers like Render's 512MB cap could offer)
- Render — backend API and static frontend hosting
- Vercel — frontend hosting (primary)
- GitHub + Git LFS — version control and large-file handling

---

## 5. Core Methods & Concepts

### 5.1 Hybrid Retrieval
Combines two retrieval strategies that fail in different, complementary ways:
- **Dense retrieval** — submitted text and corpus chunks are embedded into vectors; FAISS finds nearest neighbors by cosine similarity (via inner product on normalized vectors). Captures semantic/conceptual similarity even with different wording.
- **Sparse retrieval** — a MongoDB text index performs TF-IDF-style keyword matching. Captures exact terminology and acronym overlap that embeddings sometimes under-weight.
- **Reciprocal Rank Fusion (RRF)** — combines the two rankings using rank position rather than raw scores (which are on incompatible scales), avoiding the need for score normalization.

Measured impact (via a self-built evaluation harness, described below): recall@10 improved from 0.66 (dense-only) to 0.98 (hybrid) on a held-out evaluation set.

### 5.2 Cross-Encoder Reranking
After retrieval narrows the corpus down to a small candidate set, a cross-encoder scores each (query, candidate) pair **jointly** in a single forward pass — a fundamentally more accurate but more expensive comparison than independent embedding similarity. Only run on the top ~20 candidates, never the full corpus, to keep it computationally feasible.

A real bug caught during development: raw cross-encoder output is an **unbounded logit**, not a [0,1] probability. An earlier version silently clamped values above 1 down to a flat 1.0, destroying ranking signal between confidently-relevant candidates. Fixed by applying a sigmoid transform at the source.

### 5.3 Novelty Scoring
A weighted formula combining three independent signals:
```
novelty_score = w1 × (1 - best_semantic_similarity)
              + w2 × (1 - cross_encoder_relevance)
              + w3 × graph_novelty_score
```
- **Semantic similarity** — how close the submission is to its nearest match in meaning
- **Technical relevance** — the cross-encoder's joint-comparison judgment
- **Graph novelty** — derived from citation counts (via Semantic Scholar); a submission whose closest matches are heavily-cited, well-established work suggests a more "trodden" area than one whose matches are obscure or uncited

### 5.4 Retrieval Evaluation (self-supervised, no manual labeling)
Built an evaluation harness that needs no hand-labeled ground truth: it takes a short, non-trivial snippet from the *middle* of a real paper's abstract (not the easy, generic opening sentence) as a query, and checks whether the system correctly retrieves that paper's own full record. This gives real recall@k and MRR numbers for comparing retrieval configurations honestly.

This harness was used to validate every major retrieval change in this project before shipping it — including confirming that scalar quantization of the FAISS index (see below) produced **zero measurable degradation** in recall or MRR, rather than assuming it based on theory alone.

### 5.5 Vector Index Quantization
The FAISS index was originally `IndexFlatIP` (full 32-bit float precision) — ~299MB for 193,870 vectors. To fit within memory-constrained deployment environments, it was migrated to `IndexScalarQuantizer` (8-bit), cutting the index to ~76MB (~4x reduction) with **verified zero loss** in retrieval quality on the evaluation harness, likely because the downstream reranker absorbs any residual precision noise.

### 5.6 Grounded LLM Generation (RAG with verification)
The LLM is given only the already-computed scores and matched documents — never asked to judge similarity or novelty itself — and produces a structured JSON response (schema-enforced via Groq's `json_schema` response format) containing a summary, verdict, recommendations, and cited sources.

A **grounding check** runs after every LLM response: every cited `arxivId` is checked against the actual retrieved matches. Any citation that doesn't correspond to a real match is stripped out and logged as a caught hallucination — never silently trusted or shown to the user.

### 5.7 Incremental Corpus Ingestion
The paper corpus is not a static, one-time snapshot. A scheduled weekly job (`node-cron`) pulls new papers from the arXiv API (date-filtered since the last successful run), feeding them through the same validated ingestion → chunking → embedding → citation-enrichment pipeline used for the original corpus, with full resumability if interrupted.

---

## 6. Key Terminology Glossary

| Term | Meaning in this project |
|---|---|
| **Chunk** | A semantically coherent segment of a paper's abstract, produced via embedding-similarity boundary detection rather than fixed character/word counts |
| **Embedding** | A fixed-length numeric vector representing the meaning of a piece of text |
| **Cosine similarity** | A measure of how similar two vectors' directions are, used as the dense-retrieval relevance score |
| **Reranking** | Re-scoring an initial set of retrieved candidates with a more expensive, more accurate model |
| **RRF (Reciprocal Rank Fusion)** | A rank-based method for combining multiple ranked lists without needing comparable raw scores |
| **Grounding** | Verifying that an LLM's output only references facts/sources it was actually given, catching fabricated claims |
| **Quantization** | Reducing numeric precision (e.g., 32-bit float → 8-bit integer) to save memory, at a small, measurable accuracy cost |
| **Novelty score** | The project's core output: a 0–1 value where lower means heavier overlap with existing work |

---

## 7. How to Use PatCheck

1. **Visit** the live app and create an account (or log in)
2. **Submit your work** — either paste an abstract directly, or upload a PDF/DOCX file
3. **Review the results**:
   - **Overall novelty score** (0 = heavily overlapping with existing work, 1 = highly novel)
   - **Per-section breakdown**, if your submission split into multiple chunks
   - **Top matched papers**, each with a similarity score, a relevance (rerank) score, and a direct link to the real source on arXiv
   - **AI-generated summary and recommendations** — a plain-English explanation of the score, with concrete suggestions for differentiating your work further
4. **Interpreting the score**:
   - A **low score** (closer to 0) means strong overlap was found — read the matched papers directly; your contribution may need to be reframed, narrowed, or more clearly differentiated from what already exists
   - A **high score** (closer to 1) means no strong overlap was found in the corpus — this is a positive signal, not a guarantee; the corpus, while large, is not exhaustive (see Limitations)
   - Pay attention to **which specific chunk** scored lowest — it often pinpoints exactly which claim or section overlaps with prior work, rather than requiring you to guess

---

## 8. Limitations (Honest, As of Now)

- **Corpus coverage is papers-only.** Patent data (via a static Kaggle-sourced dataset) exists in the schema but patent ingestion into the live, searchable corpus is not yet complete — this is the most significant gap relative to the project's original "patents and papers" scope.
- **Corpus is CS/AI-focused**, inherited from the original dataset's category scope; coverage outside this domain is weaker.
- **The corpus auto-updates weekly for papers only**; patents do not yet share this incremental pipeline.
- **The grounding check only verifies structured citations**, not every free-text claim in the LLM's summary — a subtle but real distinction from fully verified generation.

---

## 9. Future Scope: Toward a Live, Continuously-Updating Corpus

The long-term goal is a corpus that stays current automatically, across both papers and patents, without manual re-ingestion. Concrete next steps, roughly in priority order:

1. **Real, incremental patent ingestion.** The current patent data is a one-time static snapshot. The next step is integrating a genuinely live, incrementally-updatable patent source (the project evaluated USPTO's Open Data Portal, Google Patents via BigQuery, and EPO's Open Patent Services during development — each has real tradeoffs around authentication friction, billing-account requirements, and query complexity that need to be weighed against the project's constraints before committing).

2. **Unified scheduling.** Extend the existing `node-cron`-based weekly paper sync to also drive patent ingestion once a suitable source is selected, so both corpora update on the same reliable, resumable, checkpointed cadence already proven for papers.

3. **Citation-depth expansion.** Currently citation signal is depth-0 (a paper's own citation count). A natural extension is depth-1 citation-graph traversal — incorporating not just how cited a matched paper is, but what *it* cites — for a richer "is this a trodden research path" signal.

4. **Domain-specific embedding fine-tuning.** Evaluate a scientific-literature-specific embedding model (e.g., SPECTER2) against the current general-purpose model, using the existing evaluation harness to make the comparison with real numbers rather than assumption — and only adopt it if it demonstrably improves retrieval quality on this corpus.

5. **Sparse retrieval upgrade.** The current sparse retrieval uses MongoDB's built-in TF-IDF-style text index; BM25 (the field-standard sparse-retrieval scoring function) is a natural, measurable upgrade once there's bandwidth to stand up and evaluate it.

6. **Rate limiting and cost control hardening.** As usage grows, the `/api/compare` endpoint (which calls a paid LLM API) needs production-grade rate limiting and response caching for duplicate/near-duplicate submissions, to keep operating costs predictable.

7. **Automated regression testing**, anchored to the evaluation harness, so future retrieval or scoring changes are validated against the same recall/MRR baseline automatically rather than manually, catching regressions before they reach production.

---

## 10. Project Structure

```
patcheck/
├── frontend/              # React + Vite application
│   └── src/
│       ├── pages/          # Route-level views (Home, Auth, Dashboard, Results)
│       ├── components/     # Reusable UI components
│       ├── utils/           # Helper functions (e.g., arXiv link normalization)
│       └── api.js           # Centralized API request helper
├── server/                # Node/Express backend
│   └── src/
│       ├── models/          # Mongoose schemas (Paper, Chunk, Patent, User)
│       ├── services/        # Business logic (compare, hybrid retrieval, graph novelty, LLM)
│       ├── controllers/     # Request handlers
│       ├── routes/          # API route definitions
│       └── scripts/         # Ingestion, embedding generation, evaluation, scheduler
└── patcheck-ml-service/   # Python/FastAPI retrieval microservice
    └── app/
        ├── services/        # Embedding, FAISS indexing, reranking, chunking
        └── main.py           # API endpoints
```

---

## 11. Acknowledgments & Data Sources

- Research paper corpus sourced from **arXiv** (via its public API and bulk metadata)
- Citation enrichment via the **Semantic Scholar Academic Graph API**
- Patent reference dataset sourced from a public Kaggle mirror of USPTO patent records (Attribution-NonCommercial license — used here for non-commercial, educational/portfolio purposes only)
