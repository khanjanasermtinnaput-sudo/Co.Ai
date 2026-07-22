import { redirect } from "next/navigation";

// "/" IS the chat surface — this legacy route exists only so old bookmarks
// and deep links keep working.
export default function ChatPage() {
  redirect("/");
}
