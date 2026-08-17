import SearchableRequestGrid from "@/features/requests/components/SearchableRequestGrid";
import { getRequests } from "@/features/requests/data/requests-api";

export default async function Home() {
  const requests = await getRequests();

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
      <SearchableRequestGrid requests={requests} />
    </div>
  );
}
