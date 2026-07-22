"use client";

// Imports locally-selected files into the workspace's virtual FS.

import { useCallback } from "react";
import { useCocodeIDEStore } from "@/store/cocode-ide-store";

export function useWorkspaceUpload() {
  const importFiles = useCocodeIDEStore((s) => s.importFiles);

  return useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (!files.length) return;
      const loaded = await Promise.all(files.map(async (f) => ({ path: f.name, content: await f.text() })));
      importFiles(loaded);
    },
    [importFiles],
  );
}
