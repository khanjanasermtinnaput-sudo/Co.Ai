"use client";

import { useEffect, useState } from "react";

/** True only after the component has mounted on the client. Guards against
 *  hydration mismatches for theme- and storage-dependent UI. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
