import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { request, setAccessToken } from "./api.js";
import HomePage from "./pages/HomePage.jsx";
import AuthPage from "./pages/AuthPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import ResultsPage from "./pages/ResultsPage.jsx";
import "./App.css";

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    request("/auth/refresh", { method: "POST" })
      .then(({ accessToken, user: sessionUser }) => {
        setAccessToken(accessToken);
        setUser(sessionUser);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  const logout = async () => {
    try {
      await request("/auth/logout", { method: "POST" });
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  };
  if (!ready)
    return (
      <div className="boot">
        <Sparkles size={24} /> Loading Patcheck
      </div>
    );
  return (
    <Routes>
      <Route path="/" element={<HomePage user={user} onLogout={logout} />} />
      <Route
        path="/login"
        element={<AuthPage mode="login" onAuth={setUser} />}
      />
      <Route
        path="/signup"
        element={<AuthPage mode="signup" onAuth={setUser} />}
      />
      <Route
        path="/dashboard"
        element={
          user ? (
            <DashboardPage user={user} onLogout={logout} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/results"
        element={user ? <ResultsPage /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
