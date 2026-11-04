import { previewJson } from "@/lib/preview/server";
export async function GET() {
  return previewJson({
    webhookUrl: null,
    signingSecretSet: false,
    provider: "webhook",
    providerStatus: "not_configured",
    deliveries: [],
  });
}
export async function PUT() {
  return previewJson(
    {
      message: "Private webhook delivery requires a connected Quiver account.",
    },
    403,
  );
}
export const POST = PUT;
