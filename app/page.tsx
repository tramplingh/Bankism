import Console from "./components/Console";
import ContainmentHero from "./components/ContainmentHero";
import SiteHeader from "./components/SiteHeader";
import { headlineStats } from "@/lib/evalStats";

// Server component: the containment story renders as static HTML before any JavaScript runs.
export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="wrap">
        <ContainmentHero stats={headlineStats()} />
        <Console />
      </main>
    </>
  );
}
