import { previewJson } from "@/lib/preview/server";
export async function GET() {
  return previewJson({
    items: [],
    vault: "unavailable",
    authenticated: false,
    shared: {
      ai: !!process.env.OPENROUTER_API_KEY,
      stocks: !!process.env.TIINGO_API_KEY,
    },
  });
}
export async function PUT() {
  return previewJson(
    {
      message:
        "Personal connections are available in your connected Quiver account.",
    },
    403,
  );
}
export const DELETE = PUT;
