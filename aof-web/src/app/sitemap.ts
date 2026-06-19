import type { MetadataRoute } from "next";

const BASE = "https://coagentix.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE,               lastModified: now, changeFrequency: "weekly",  priority: 1.0 },
    { url: `${BASE}/about`,    lastModified: now, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE}/blog`,     lastModified: now, changeFrequency: "weekly",  priority: 0.8 },
    { url: `${BASE}/contact`,  lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/privacy`,  lastModified: now, changeFrequency: "yearly",  priority: 0.4 },
    { url: `${BASE}/terms`,    lastModified: now, changeFrequency: "yearly",  priority: 0.4 },
    { url: `${BASE}/cookies`,  lastModified: now, changeFrequency: "yearly",  priority: 0.3 },
    { url: `${BASE}/login`,    lastModified: now, changeFrequency: "monthly", priority: 0.5 },
  ];

  return staticRoutes;
}
