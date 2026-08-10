import TopBar from './layout/TopBar';
import Sidebar from './layout/Sidebar';
import MainContent from './layout/MainContent';

export default function App() {
  return (
    <div className="app-root">
      <TopBar />
      <div className="app-body">
        <Sidebar />
        <MainContent />
      </div>
    </div>
  );
}
