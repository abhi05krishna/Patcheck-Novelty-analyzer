import re
from app.services.embedding_service import embed_texts

BREAKPOINT_THRESHOLD = 0.65
MIN_CHUNK_SENTENCES = 2
MAX_CHUNK_SENTENCES = 12


def _split_into_sentences(text):
    text = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text)
    return [p for p in parts if p]


def _cosine(a, b):
    return sum(x * y for x, y in zip(a, b))


def semantic_chunk(text):
    sentences = _split_into_sentences(text)

    if len(sentences) == 0:
        return []
    if len(sentences) == 1:
        return [{"chunk": sentences[0], "sentence_count": 1}]

    sentence_embeddings = embed_texts(sentences)
    boundaries = [0]

    for i in range(len(sentences) - 1):
        sim = _cosine(sentence_embeddings[i], sentence_embeddings[i + 1])
        sentences_since_last = (i + 1) - boundaries[-1]

        below_threshold = sim < BREAKPOINT_THRESHOLD
        forced_by_max = sentences_since_last >= MAX_CHUNK_SENTENCES
        blocked_by_min = sentences_since_last < MIN_CHUNK_SENTENCES

        if (below_threshold or forced_by_max) and not blocked_by_min:
            boundaries.append(i + 1)

    chunks = []
    for idx, start in enumerate(boundaries):
        end = boundaries[idx + 1] if idx + 1 < len(boundaries) else len(sentences)
        chunk_sentences = sentences[start:end]
        chunks.append({
            "chunk": " ".join(chunk_sentences),
            "sentence_count": len(chunk_sentences),
        })

    return chunks