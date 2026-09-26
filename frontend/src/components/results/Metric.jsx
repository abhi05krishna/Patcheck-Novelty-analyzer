export default function Metric({ label, value, detail }) {
  const signal =
    value >= 70
      ? "Higher signal"
      : value >= 40
        ? "Moderate overlap"
        : "Lower overlap";
  return (
    <article className="metric">
      <div
        className="ring"
        style={{ "--value": `${Math.max(0, Math.min(100, value))}%` }}
      >
        <b>{value}%</b>
      </div>
      <div>
        <small>{label}</small>
        <h2>{signal}</h2>
        <p>{detail}</p>
      </div>
    </article>
  );
}
