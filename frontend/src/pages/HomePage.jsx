import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Lightbulb,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router-dom";
import Header from "../components/navigation/Header.jsx";
import Footer from "../components/layout/Footer.jsx";

const steps = [
  [
    "01",
    "Add your abstract",
    "Paste an abstract or upload a PDF, DOCX, or TXT file.",
  ],
  [
    "02",
    "Review the signals",
    "See semantic similarity and a corpus-relative novelty signal.",
  ],
  [
    "03",
    "Act on the evidence",
    "Open source links and use grounded recommendations to strengthen your work.",
  ],
];
export default function HomePage({ user, onLogout }) {
  return (
    <>
      <Header user={user} onLogout={onLogout} />
      <main>
        <section className="hero">
          <div className="hero-copy">
            <motion.p
              className="eyebrow"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
            >
              Research clarity, before you submit
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
            >
              Know where your idea stands in the literature.
            </motion.h1>
            <motion.p
              className="lede"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16 }}
            >
              Patcheck compares your abstract with relevant research, surfaces
              meaningful overlap, and gives grounded next steps.
            </motion.p>
            <motion.div
              className="hero-actions"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24 }}
            >
              <Link className="button" to={user ? "/dashboard" : "/signup"}>
                Get started <ArrowRight size={18} />
              </Link>
              <a className="text-action" href="#how">
                See how it works
              </a>
            </motion.div>
            <p className="fine">
              Decision support, not a patentability or legal opinion.
            </p>
          </div>
          <motion.div
            className="hero-visual"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.65 }}
          >
            <div className="orb orb-one" />
            <div className="orb orb-two" />
            <div className="analysis-card">
              <div className="card-top">
                <span>Abstract analysis</span>
                <span className="status">Ready</span>
              </div>
              <div className="lines">
                <i />
                <i />
                <i className="short" />
              </div>
              <div className="score-row">
                <div>
                  <small>Similarity</small>
                  <strong>
                    41<span>%</span>
                  </strong>
                </div>
                <div className="score-divider" />
                <div>
                  <small>Novelty signal</small>
                  <strong>
                    72<span>%</span>
                  </strong>
                </div>
              </div>
              <div className="match">
                <span className="match-icon">
                  <Sparkles size={16} />
                </span>
                <div>
                  <small>Closest research match</small>
                  <b>Retrieval-Augmented Evaluation</b>
                </div>
                <ArrowRight size={16} />
              </div>
            </div>
          </motion.div>
        </section>
        <section className="trust-strip" id="trust">
          <span>
            <ShieldCheck /> Grounded in your indexed corpus
          </span>
          <span>
            <BookOpen /> Linked source matches
          </span>
          <span>
            <Lightbulb /> Actionable recommendations
          </span>
        </section>
        <section className="how" id="how">
          <p className="eyebrow">A focused research workflow</p>
          <h2>From abstract to a clearer next move.</h2>
          <div className="steps">
            {steps.map(([number, title, copy], index) => (
              <motion.article
                key={number}
                initial={{ opacity: 0, y: 36, scale: 0.94 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ delay: index * 0.18, type: "spring", stiffness: 180, damping: 18 }}
              >
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </motion.article>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
