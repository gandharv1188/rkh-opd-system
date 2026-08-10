export default function Sidebar() {
  return (
    <nav data-testid="sidebar" className="sidebar" aria-label="primary">
      <ul>
        <li><a href="#queue">Queue</a></li>
        <li><a href="#settings">Settings</a></li>
      </ul>
    </nav>
  );
}
