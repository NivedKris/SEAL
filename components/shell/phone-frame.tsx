import { cn } from "@/lib/utils";

/**
 * Fixed 390 x 844 device frame centred on desktop; on a real phone (<= 430px)
 * the frame disappears and the content fills the screen (plan §4).
 */
export function PhoneFrame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-h-[calc(100dvh-3rem)] items-center justify-center bg-secondary py-10 max-[430px]:block max-[430px]:min-h-dvh max-[430px]:bg-background max-[430px]:py-0">
      <div
        className={cn(
          "relative h-[844px] w-[390px] overflow-hidden rounded-[56px] border-[10px] border-black bg-background shadow-[0_30px_80px_-20px_rgba(0,0,0,0.35)]",
          "max-[430px]:h-dvh max-[430px]:w-full max-[430px]:rounded-none max-[430px]:border-0 max-[430px]:shadow-none",
          className,
        )}
      >
        <div className="pointer-events-none absolute left-1/2 top-2 z-20 h-[30px] w-[110px] -translate-x-1/2 rounded-full bg-black max-[430px]:hidden" />
        <div className="h-full overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
