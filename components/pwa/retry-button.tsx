"use client";

export function RetryButton() {
  return (
    <button
      onClick={() => location.reload()}
      className="mt-8 inline-flex items-center gap-2 rounded-full bg-ink text-white px-6 py-3 text-sm tracking-wide hover:opacity-90 transition"
    >
      Try again
    </button>
  );
}
