import dynamic from "next/dynamic";

const TrainerDashboard = dynamic(
  () => import("./page-content").then((m) => ({ default: m.TrainerDashboard })),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-sm opacity-50">Loading...</div>
      </div>
    ),
  }
);

export default function AdminPage() {
  return <TrainerDashboard />;
}
