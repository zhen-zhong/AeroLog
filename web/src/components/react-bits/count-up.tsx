"use client";

import { useEffect, useMemo, useState } from "react";

interface CountUpProps {
  value: number;
  duration?: number;
  formatter?: (value: number) => string;
}

export function CountUp({ value, duration = 450, formatter }: CountUpProps) {
  const [current, setCurrent] = useState(value);
  const format = useMemo(() => formatter || ((v: number) => Math.round(v).toLocaleString()), [formatter]);

  useEffect(() => {
    const startValue = current;
    const delta = value - startValue;
    if (delta === 0) return;

    let frame = 0;
    let start = 0;
    const step = (timestamp: number) => {
      if (!start) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      setCurrent(startValue + delta * eased);
      if (progress < 1) {
        frame = window.requestAnimationFrame(step);
      }
    };

    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <span>{format(current)}</span>;
}
