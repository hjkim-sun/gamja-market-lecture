import SearchableRequestGrid from "@/features/requests/components/SearchableRequestGrid";
import { mockRequests } from "@/features/requests/data/mock-requests";

export default function Home() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <SearchableRequestGrid requests={mockRequests} />
    </div>
  );
}
