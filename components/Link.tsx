"use client";

import {
  forwardRef,
  useTransition,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | "auto" | null;
};

/**
 * The hosted Vinext build loses the named navigation export that next/link
 * dynamically imports. Use the public router directly so links work in the
 * production bundle as well as development. Keep real anchor semantics for
 * new tabs, downloads, external URLs and same-page section links.
 */
const Link = forwardRef<HTMLAnchorElement, Props>(function Link(
  {
    href,
    replace,
    scroll,
    prefetch,
    onClick,
    onPointerEnter,
    onFocus,
    ...props
  },
  ref,
) {
  const router = useRouter();

  const [pending, startTransition] = useTransition();
  const warm = () => {
    if (!window.crypto?.subtle) return;
    if (prefetch === false || !href.startsWith("/app") || href.startsWith("//"))
      return;
    if (
      (navigator as Navigator & { connection?: { saveData?: boolean } })
        .connection?.saveData
    )
      return;
    router.prefetch(href);
  };
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    const anchor = event.currentTarget;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      anchor.hasAttribute("download") ||
      (anchor.target && anchor.target !== "_self")
    )
      return;

    const target = new URL(anchor.href);
    if (target.origin !== window.location.origin) return;
    if (
      target.pathname === window.location.pathname &&
      target.search === window.location.search &&
      target.hash
    )
      return;

    event.preventDefault();
    const path = target.pathname + target.search + target.hash;
    startTransition(() => {
      if (replace) router.replace(path, { scroll });
      else router.push(path, { scroll });
    });
  };

  return (
    <a
      {...props}
      ref={ref}
      href={href}
      data-route-pending={pending || undefined}
      onPointerEnter={(e) => {
        onPointerEnter?.(e);
        if (e.pointerType !== "touch") warm();
      }}
      onFocus={(e) => {
        onFocus?.(e);
        warm();
      }}
      onClick={navigate}
    />
  );
});

export default Link;
