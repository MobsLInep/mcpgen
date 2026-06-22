import Link from "next/link";

export default function NotFound() {
  return (
    <div style={{ padding: "4rem 1rem", textAlign: "center" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 700 }}>
        404 — Page not found
      </h1>
      <p style={{ marginTop: "1rem", opacity: 0.7 }}>
        That page doesn&apos;t exist (yet).
      </p>
      <p style={{ marginTop: "1.5rem" }}>
        <Link href="/" style={{ textDecoration: "underline" }}>
          Back to the docs home →
        </Link>
      </p>
    </div>
  );
}
