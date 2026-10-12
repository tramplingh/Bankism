import Link from "next/link";
import ThemeToggle from "./ThemeToggle";

export default function SiteHeader() {
  return (
    <header className="site-header">
      <div className="wrap site-header-inner">
        <Link href="/" className="brand">
          <span aria-hidden="true" className="brand-mark">◆</span> Bankism
        </Link>
        <nav aria-label="Primary">
          <ul className="nav">
            <li><Link href="/">Firewall</Link></li>
            <li><Link href="/eval">Eval results</Link></li>
            <li><a href="https://github.com/tramplingh/bankism">Source on GitHub</a></li>
          </ul>
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
