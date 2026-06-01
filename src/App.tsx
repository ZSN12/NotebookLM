import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { isAuthenticated } from "@/services/auth";
import Dashboard from "@/pages/Dashboard";
import ChapterList from "@/pages/ChapterList";
import NoteDetail from "@/pages/NoteDetail";
import Login from "@/pages/Login";
import SharePage from "@/pages/SharePage";
import Profile from "@/pages/Profile";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/share/:sessionId" element={<SharePage />} />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/subject/:id" element={<ProtectedRoute><ChapterList /></ProtectedRoute>} />
        <Route path="/subject/:id/session/:sessionId" element={<ProtectedRoute><NoteDetail /></ProtectedRoute>} />
        <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      </Routes>
    </Router>
  );
}