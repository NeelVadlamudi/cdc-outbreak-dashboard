/** Named empty / error state so blank charts never look like “no disease.” */
export default function ChartEmpty({ title, detail, onRetry }) {
  return (
    <div className="chart-empty" role="status">
      <strong>{title}</strong>
      <p>{detail}</p>
      {onRetry ? (
        <button type="button" className="retry-btn" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
