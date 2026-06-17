"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface AnimatedContentProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export function AnimatedContent({ children, className, delay = 0 }: AnimatedContentProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setMounted(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={cn(
        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        mounted ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100",
        className,
      )}
    >
      {children}
    </div>
  );
}
