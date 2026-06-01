import { API_BASE } from '@/config';

const TOKEN_KEY = "nootbook_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

async function authFetch(path: string, body: object): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return res;
  } catch (err: any) {
    if (err.name === "AbortError") {
      throw new Error("请求超时，请检查后端是否在 8003 端口运行");
    }
    throw new Error(`无法连接到服务器 (${API_BASE})，请确认后端已启动`);
  } finally {
    clearTimeout(timeout);
  }
}

export async function login(email: string, password: string): Promise<string> {
  const res = await authFetch("/api/auth/login", { email, password });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "登录失败" }));
    throw new Error(err.detail || "登录失败");
  }
  const data = await res.json();
  setToken(data.access_token);
  return data.access_token;
}

export async function register(username: string, email: string, password: string): Promise<void> {
  const res = await authFetch("/api/auth/register", { username, email, password });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "注册失败" }));
    throw new Error(err.detail || "注册失败");
  }
}

export function logout(): void {
  clearToken();
  window.location.href = "/login";
}

export async function resetPassword(email: string, newPassword: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, new_password: newPassword }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "密码重置失败" }));
    throw new Error(err.detail || "密码重置失败");
  }
}
