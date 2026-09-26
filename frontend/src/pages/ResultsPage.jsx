import { useMemo } from "react";
import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Header from "../components/navigation/Header";
import Metric from "../components/results/Metric";
import { demoResult } from "../data/research";
import { toRealArxivUrl } from "../utils/arxiv";

export default function ResultsPage() {
  const navigate = useNavigate();
  const result = useMemo(() => {
    try {
      return (
        JSON.parse(sessionStorage.getItem("patcheck-result")) || demoResult
      );
    } catch {
      return demoResult;
    }
  }, []);
  const novelty = Math.round((result.overallNoveltyScore ?? 0.5) * 100);
  const top =
    result.chunks?.flatMap((chunk) => chunk.topMatches || []).slice(0, 5) || [];
  const recommendation = result.recommendation;
  const improvements = recommendation?.recommendations || [
    "Review the closest source matches before submitting.",
    "State your differentiator clearly in the abstract.",
  ];
  return (
    <>
      <Header />
      <main className="results">
        <div className="result-heading">
          <div>
            <p className="eyebrow">Analysis complete</p>
            <h1>Here’s what your corpus suggests.</h1>
            <p>
              Use these signals to guide your research review, then read the
              linked sources.
            </p>
          </div>
          <button
            className="button secondary"
            onClick={() => navigate("/dashboard")}
          >
            New analysis
          </button>
        </div>
        <div className="metric-grid">
          <Metric
            label="Novelty signal"
            value={novelty}
            detail="Corpus-relative"
          />
          <Metric
            label="Closest similarity"
            value={Math.round((top[0]?.similarity || 0) * 100)}
            detail="Top matched source"
          />
        </div>
        <section className="insight-card">
          <div>
            <p className="eyebrow">Grounded summary</p>
            <h2>
              {recommendation?.noveltyVerdict || "Recommendation pending"}
            </h2>
            <p>
              {recommendation?.summary ||
                result.recommendationError ||
                "Your comparison completed. Review the sources below for the strongest evidence."}
            </p>
          </div>
          <Sparkles size={28} />
        </section>
        <div className="result-columns">
          <section className="panel">
            <h2>Suggested improvements</h2>
            {improvements.map((item, index) => (
              <p className="recommendation" key={index}>
                <CheckCircle2 size={18} />
                {item}
              </p>
            ))}
          </section>
          <section className="panel">
            <h2>Related source material</h2>
            {top.length ? (
              top.map((match, index) => (
                <a
                  className="source"
                  key={`${match.arxivId || index}-${index}`}
                  target="_blank"
                  rel="noreferrer"
                  href={
                    match.arxivId
                      ? toRealArxivUrl(match.arxivId)
                      : "https://arxiv.org/"
                  }
                >
                  <span>{index + 1}</span>
                  <div>
                    <b>{match.paperTitle || "Indexed research source"}</b>
                    <small>{match.arxivId || "Open source record"}</small>
                  </div>
                  <ArrowRight size={17} />
                </a>
              ))
            ) : (
              <p className="muted">
                No source metadata was returned by the current corpus.
              </p>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
