const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface JoinResponse {
  token: string;
  username: string;
  created: boolean;
}

export async function joinAsUser(username: string): Promise<JoinResponse> {
  const res = await fetch(`${API_URL}/api/auth/join/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.username?.[0] ?? "Failed to join");
  }

  return res.json();
}
