import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import Header from "../components/navigation/Header.jsx";
import { request, setAccessToken } from "../api";

export default function AuthPage({ mode, onAuth }) {
  const navigate = useNavigate();
  const signup = mode === "signup";
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await request(`/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      setAccessToken(data.accessToken);
      onAuth(data.user);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <Header />
      <motion.form
        className="auth-card"
        onSubmit={submit}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <p className="eyebrow">{signup ? "Start exploring" : "Welcome back"}</p>
        <h1>{signup ? "Create your workspace" : "Log in to Patcheck"}</h1>
        <p>
          {signup
            ? "Keep a private history of your literature comparisons."
            : "Continue your research review."}
        </p>
        {signup && (
          <label>
            Name
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Your name"
            />
          </label>
        )}
        <label>
          Email
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="you@example.com"
          />
        </label>
        <label>
          Password
          <input
            required
            minLength="8"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="At least 8 characters"
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="button full" disabled={busy}>
          {busy ? "Please wait…" : signup ? "Create account" : "Log in"}
          <ArrowRight size={17} />
        </button>
        <p className="switch">
          {signup ? "Already have an account?" : "New to Patcheck?"}{" "}
          <Link to={signup ? "/login" : "/signup"}>
            {signup ? "Log in" : "Create one"}
          </Link>
        </p>
      </motion.form>
    </div>
  );
}
