"use client";

// Completes the GitHub OAuth connect flow: on return from /api/github's OAuth
// redirect (?github=connected), fetches the authenticated user and marks the
// workspace's github state connected.

import { useEffect } from "react";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";

export function useGithubOAuthCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected") {
      window.history.replaceState({}, "", window.location.pathname);
      fetch("/api/github?path=/user")
        .then((r) => r.json())
        .then((user: { login?: string; name?: string; avatar_url?: string }) => {
          if (user.login) {
            useCocodeIDEStore.setState((s) => ({
              github: { ...s.github, connected: true, user: { login: user.login!, name: user.name ?? null, avatar_url: user.avatar_url ?? "" } },
            }));
          }
        })
        .catch(() => {});
    }
  }, []);
}
