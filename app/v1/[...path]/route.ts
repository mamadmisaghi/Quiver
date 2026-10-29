import { proxyApi } from "@/lib/api-proxy";

type RouteContext = { params: Promise<{ path: string[] }> };
const handle = async (request: Request, context: RouteContext) => proxyApi(request, (await context.params).path, process.env.QUIVER_API_INTERNAL);
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS, handle as HEAD };
