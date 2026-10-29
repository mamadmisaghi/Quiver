// Brand lockup from Juno's kit (/workspace/brand/quiver/lockup/quiver-lockup-horizontal.svg, copied to public/brand).
export default function Logo({ h = 22 }: { h?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/quiver-lockup-horizontal.svg" alt="Quiver" height={h} width={Math.round(h * 779.28 / 189)} style={{ height: h, width: "auto" }} className="block" />;
}
