import Link from "next/link";

export default function Home() {
  return (
    <main style={{ padding: 32 }}>
      <h1>Rendering Perf Test Pages</h1>
      <ul>
        <li><Link href="/excessive-rerenders">Excessive Re-renders</Link></li>
        <li><Link href="/prop-drilling">Prop Drilling (memo defeated)</Link></li>
        <li><Link href="/context-thrash">Context Thrashing</Link></li>
        <li><Link href="/realistic">Realistic Dashboard (multi-file, non-obvious)</Link></li>
        <li><Link href="/tricky">Tricky Dashboard (red herrings, hidden bottleneck)</Link></li>
      </ul>
    </main>
  );
}
