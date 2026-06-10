import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, register, resetPassword } from "@/services/auth";
import { BookOpen, Loader2, X } from "lucide-react";

export default function Login() {
  const navigate = useNavigate();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isRegister) {
        await register(username, email, password);
      }
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  const closeResetModal = () => {
    setShowResetModal(false);
    setResetEmail("");
    setResetNewPassword("");
    setResetMessage("");
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetMessage("");
    setError("");
    setResetLoading(true);

    try {
      await resetPassword(resetEmail, resetNewPassword);
      setResetMessage("密码已重置，请登录");
      setTimeout(closeResetModal, 2000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '密码重置失败');
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-500 mb-4">
            <BookOpen className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">AI Notebook</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {isRegister ? "创建账号开始使用" : "登录你的账号"}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-4"
        >
          {isRegister && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                用户名
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-base focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 min-h-[48px]"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              账号
            </label>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-base focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 min-h-[48px]"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              密码
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-base focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 min-h-[48px]"
            />
          </div>

          {!isRegister && (
            <div className="text-right">
              <button
                type="button"
                onClick={() => {
                  setShowResetModal(true);
                  setError("");
                }}
                className="text-xs text-blue-500 hover:text-blue-600 font-medium cursor-pointer"
              >
                忘记密码？
              </button>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-medium text-base hover:from-blue-600 hover:to-violet-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer min-h-[48px]"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {isRegister ? "注册并登录" : "登录"}
          </button>

          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            {isRegister ? "已有账号？" : "没有账号？"}
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError("");
              }}
              className="ml-1 text-blue-500 hover:text-blue-600 font-medium cursor-pointer"
            >
              {isRegister ? "去登录" : "注册"}
            </button>
          </p>
        </form>
      </div>

      {showResetModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={closeResetModal}
        >
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-200">重置密码</h3>
              <button onClick={closeResetModal} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"><X className="w-4 h-4" /></button>
            </div>

            {resetMessage && (
              <div className="mb-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-sm text-green-600 dark:text-green-400">
                {resetMessage}
              </div>
            )}

            <form onSubmit={handleResetPassword} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  账号
                </label>
                <input
                  type="text"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 min-h-[48px]"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  新密码
                </label>
                <input
                  type="password"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-600 min-h-[48px]"
                />
              </div>

              <button
                type="submit"
                disabled={resetLoading}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-medium text-base hover:from-blue-600 hover:to-violet-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer min-h-[48px]"
              >
                {resetLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                重置密码
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
