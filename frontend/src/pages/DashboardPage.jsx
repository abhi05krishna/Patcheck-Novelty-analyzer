import { useEffect, useState } from "react";
import {
  ArrowRight,
  Clock3,
  FileText,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import Header from "../components/navigation/Header";
import { request } from "../api";
import { researchLinks } from "../data/research";

function DashboardSidebar({ history, openResult, onDelete }) {
  return (
    <aside>
      <div className="side-label">Research desk</div>
      <Link className="active-side" to="/dashboard">
        <FileText size={17} /> New analysis
      </Link>
      <div className="side-section">
        <h3>New papers</h3>
        {researchLinks.map((item) => (
          <a key={item.title} href={item.url} target="_blank" rel="noreferrer">
            {item.title}
            <ArrowRight size={14} />
          </a>
        ))}
      </div>
      <div className="side-section" id="history">
        <h3>Recent analyses</h3>
        {history.length ? (
          history.slice(0, 4).map((item) => (
            <div className="history-item" key={item._id}>
              <button className="history-open" onClick={() => openResult(item.result)}>
                <Clock3 size={14} />
                {item.title}
              </button>
              <button className="history-delete" aria-label={`Delete ${item.title}`} title="Delete analysis" onClick={() => onDelete(item._id)}>
                <Trash2 size={14} />
              </button>
            </div>
          ))
        ) : (
          <p className="muted">Your saved analyses will appear here.</p>
        )}
      </div>
    </aside>
  );
}
function AnalysisForm({ onAnalysis }) {
  const [text, setText] = useState("");
  const [file, setFile] = useState(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function analyse(event) {
    event.preventDefault();
    setError("");
    if (!file && text.trim().length < 50)
      return setError(
        "Add at least 50 characters, or select a PDF, DOCX, or TXT file.",
      );
    setBusy(true);
    try {
      let result;
      if (file) {
        const body = new FormData();
        body.append("file", file);
        if (filter) body.append("sourceTypeFilter", filter);
        result = await request("/compare/upload", { method: "POST", body });
      } else {
        result = await request("/compare", {
          method: "POST",
          body: JSON.stringify({ text, sourceTypeFilter: filter || undefined }),
        });
      }
      onAnalysis(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="analyse-form" onSubmit={analyse}>
      <div className="editor-toolbar">
        <span>Abstract</span>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="">Papers & patents</option>
          <option value="paper">Papers only</option>
          <option value="patent">Patents only</option>
        </select>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste your abstract here. Include the problem, approach, and key result for a more useful comparison…"
      />
      <div className="upload-row">
        <label className="file-pick">
          <Upload size={17} />
          <span>{file ? file.name : "Upload PDF, DOCX, or TXT"}</span>
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </label>
        <span>Max 10 MB</span>
      </div>
      {error && <p className="form-error">{error}</p>}
      <button className="button" disabled={busy}>
        {busy ? "Analyzing your abstract…" : "Analyze research"}
        <ArrowRight size={17} />
      </button>
    </form>
  );
}
export default function DashboardPage({ user, onLogout }) {
  const navigate = useNavigate();
  const [history, setHistory] = useState([]);
  useEffect(() => {
    request("/history")
      .then((data) => setHistory(data.items || []))
      .catch(() => {});
  }, []);
  const openResult = (result) => {
    sessionStorage.setItem("patcheck-result", JSON.stringify(result));
    navigate("/results");
  };
  const deleteHistoryItem = async (id) => {
    if (!window.confirm("Delete this analysis from your history? This cannot be undone.")) return;
    try {
      await request(`/history/${id}`, { method: "DELETE" });
      setHistory((items) => items.filter((item) => item._id !== id));
    } catch (err) {
      window.alert(err.message);
    }
  };
  return (
    <>
      <Header user={user} onLogout={onLogout} />
      <main className="dashboard">
        <DashboardSidebar history={history} openResult={openResult} onDelete={deleteHistoryItem} />
        <section className="workspace">
          <p className="eyebrow">New analysis</p>
          <h1>Check your research direction.</h1>
          <p className="workspace-copy">
            Add an abstract to compare it with papers and patents in your
            current index.
          </p>
          <AnalysisForm onAnalysis={openResult} />
          <div className="note">
            <ShieldCheck size={18} />
            <div>
              <b>How to read the result</b>
              <p>
                Similarity reflects overlap with your indexed corpus. Novelty is
                a corpus-relative signal, not a legal conclusion.
              </p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
