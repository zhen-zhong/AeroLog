"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
const SelectValue = ({ className, ...props }: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Value>) => (
  <SelectPrimitive.Value className={cn("min-w-0 flex-1 truncate text-left", className)} {...props} />
);

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 min-w-0 w-full items-center justify-between overflow-hidden rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", style, ...props }, ref) => {
  const contentRef = React.useRef<React.ElementRef<typeof SelectPrimitive.Content> | null>(null);
  const [query, setQuery] = React.useState("");
  const [hasMatch, setHasMatch] = React.useState(true);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const items = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('[role="option"]') || []);
      const normalizedQuery = query.trim().toLocaleLowerCase();
      let matches = 0;

      items.forEach((item) => {
        const text = item.textContent?.trim().toLocaleLowerCase() || "";
        const visible = !normalizedQuery || fuzzyMatch(text, normalizedQuery);
        item.hidden = !visible;
        item.setAttribute("aria-hidden", String(!visible));
        if (visible) matches += 1;
      });
      setHasMatch(matches > 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [children, query]);

  const setRefs = (node: React.ElementRef<typeof SelectPrimitive.Content> | null) => {
    contentRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={setRefs}
        className={cn(
          "relative z-50 min-w-32 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border bg-card text-card-foreground sm:max-w-lg",
          position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        style={{ maxWidth: "min(32rem, calc(100vw - 2rem))", ...style }}
        {...props}
      >
        <div className="border-b p-1.5" onPointerDown={(event) => event.stopPropagation()}>
          <div className="flex h-8 items-center gap-2 rounded-sm border bg-background px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              aria-label="搜索下拉选项"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") event.stopPropagation();
              }}
              placeholder="搜索…"
              value={query}
            />
          </div>
        </div>
        <SelectPrimitive.Viewport
          className={cn(
            "max-h-[min(20rem,var(--radix-select-content-available-height))] overflow-x-auto overflow-y-auto overscroll-contain overscroll-x-contain p-1 scroll-py-1",
            position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          {children}
          {query && !hasMatch ? <p className="px-2 py-3 text-center text-sm text-muted-foreground">无匹配选项</p> : null}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});
SelectContent.displayName = SelectPrimitive.Content.displayName;

function fuzzyMatch(text: string, query: string) {
  let cursor = 0;
  for (const char of query) {
    cursor = text.indexOf(char, cursor);
    if (cursor < 0) return false;
    cursor += 1;
  }
  return true;
}

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex min-w-full w-max cursor-default select-none items-center whitespace-nowrap rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
