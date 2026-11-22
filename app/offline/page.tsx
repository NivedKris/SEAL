import type { Metadata } from "next";
import { RetryButton } from "@/components/pwa/retry-button";

export const metadata: Metadata = { title: "Offline" };

/** Shown by the app when there is no connection. Patient and claim data is never kept on the device. */
export default function Offline() {
  return (
    <main className="min-h-[80vh] flex items-center justify-center px-6">
      <div className="card max-w-md w-full p-10 text-center">
        <p className="eyebrow">No connection</p>
        <h1 className="display text-4xl mt-3 text-ink">SEAL is offline.</h1>
        <p className="mt-4 text-ink/70 leading-relaxed">
          Patient and claim details are never stored on this device, so SEAL needs the hospital network to show them.
          Your work is safe: everything you sent is already saved.
        </p>
        <RetryButton />
      </div>
    </main>
  );
}
