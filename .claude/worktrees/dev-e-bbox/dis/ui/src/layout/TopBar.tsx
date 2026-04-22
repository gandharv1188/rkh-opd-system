export default function TopBar() {
  return (
    <header data-testid="topbar" className="topbar">
      <span className="topbar__title">DIS — Document Ingestion Service</span>
      <span className="topbar__user" aria-label="user badge">user</span>
    </header>
  );
}
